import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { GeminiProvider } from '../src/agent/gemini.js';
import { checkModel } from '../src/agent/check-model.js';
import { readConfig } from '../src/config.js';
import { startSystem } from '../src/system.js';
import { testConfig } from './helpers.js';
import type { Task } from '../src/types.js';

const task: Task = {
  id: 'test',
  requestKey: randomUUID(),
  symbol: 'ETH',
  budget: 0,
  prompt: 'Read free data',
  status: 'running',
  createdAt: new Date().toISOString(),
  result: null,
  error: null,
};
const reply = (parts: unknown[], finishReason = 'STOP') =>
  Response.json({
    candidates: [{ finishReason, content: { role: 'model', parts } }],
    usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3, thoughtsTokenCount: 2 },
  });

test('Gemini native tool loop preserves signatures and call IDs without leaking private thoughts', async () => {
  const bodies: any[] = [];
  const provider = new GeminiProvider(task, 'TEST_KEY', 'gemini-2.5-flash', async (url, init) => {
    assert.equal(
      url,
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    );
    assert.equal(new Headers(init?.headers).get('x-goog-api-key'), 'TEST_KEY');
    assert.equal(init?.redirect, 'error');
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    assert.ok(!JSON.stringify(body).includes('TEST_KEY'));
    assert.ok(body.tools[0].functionDeclarations.some((f: any) => f.name === 'get_market'));
    return bodies.length === 1
      ? reply([
          { thought: true, text: 'PRIVATE_THOUGHT', thoughtSignature: 'OPAQUE_SIGNATURE' },
          {
            functionCall: { id: 'google_call_1', name: 'get_market', args: {} },
            thoughtSignature: 'CALL_SIGNATURE',
          },
        ])
      : reply([{ text: 'READY' }]);
  });
  const first = await provider.next([]);
  assert.equal(first.calls[0]!.name, 'get_market');
  assert.deepEqual(first.usage, { input: 7, output: 5 });
  assert.ok(!JSON.stringify(first).includes('PRIVATE_THOUGHT'));
  assert.ok(!JSON.stringify(first).includes('SIGNATURE'));
  const obs = [{ call: first.calls[0]!, output: { status: 'READY' } }];
  assert.equal((await provider.next(obs)).text, 'READY');
  assert.equal(bodies[1].contents[1].parts[1].thoughtSignature, 'CALL_SIGNATURE');
  assert.equal(bodies[1].contents[2].parts[0].functionResponse.id, 'google_call_1');
  await provider.next(obs);
  assert.equal(bodies[2].contents.filter((c: any) => c.parts[0].functionResponse).length, 1);
});

test('Gemini rejects truncated calls and redacts raw error bodies', async () => {
  const truncated = new GeminiProvider(task, 'k', 'gemini-2.5-flash', async () =>
    reply([{ functionCall: { name: 'buy_cmc_quote', args: {} } }], 'MAX_TOKENS'),
  );
  await assert.rejects(truncated.next([]), /GEMINI_INCOMPLETE_RESPONSE/);
  const denied = new GeminiProvider(
    task,
    'k',
    'gemini-2.5-flash',
    async () => new Response('SECRET UPSTREAM BODY', { status: 429 }),
  );
  await assert.rejects(denied.next([]), /^Error: GEMINI_HTTP_429$/);
});

test('Model check requires a complete tool round-trip and only exposes diagnostic tool', async () => {
  let calls = 0;
  const config = testConfig({ agentMode: 'gemini', geminiKey: 'test', model: 'gemini-2.5-flash' });
  await checkModel(config, async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(
      body.tools[0].functionDeclarations.map((t: any) => t.name),
      ['diagnostic_echo'],
    );
    return ++calls === 1
      ? reply([{ functionCall: { name: 'diagnostic_echo', args: {} } }])
      : reply([{ text: 'READY' }]);
  });
  assert.equal(calls, 2);
  await assert.rejects(
    checkModel(config, async () => reply([{ text: 'Hello' }])),
    /MODEL_TOOL_CHECK_FAILED/,
  );
});

test('Gemini config selects only its own key and validates model path', () => {
  const names = ['AGENT_MODE', 'GEMINI_API_KEY', 'GEMINI_MODEL'] as const;
  const old = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  try {
    process.env.AGENT_MODE = 'gemini';
    process.env.GEMINI_API_KEY = 'test-google';
    process.env.GEMINI_MODEL = 'gemini-2.5-flash';
    assert.equal(readConfig().geminiKey, 'test-google');
    assert.equal(readConfig().model, 'gemini-2.5-flash');
    process.env.GEMINI_API_KEY = '';
    assert.throws(() => readConfig(), /GEMINI_API_KEY_REQUIRED/);
    process.env.GEMINI_MODEL = '../other-host';
    assert.throws(() => readConfig(false));
  } finally {
    for (const name of names) {
      if (old[name] === undefined) delete process.env[name];
      else process.env[name] = old[name];
    }
  }
});

test('Comparison and spending review execute free tools, record activity and make no purchases', async () => {
  const system = await startSystem(testConfig());
  try {
    for (const [prompt, tool, evidence] of [
      ['Compare BTC, ETH and BNB', 'compare_markets', 'BTC'],
      ['Run a spending review', 'get_spending_summary', 'integrityValid'],
    ]) {
      const task = system.store.createTask({
        requestKey: randomUUID(),
        symbol: 'ETH',
        budget: 0,
        prompt: prompt!,
      }).task;
      system.runner.start(task);
      await system.runner.idle();
      assert.equal(system.store.getTask(task.id).status, 'completed');
      assert.ok(system.store.getTask(task.id).result?.includes(evidence!));
      assert.ok(
        system.store
          .audit(task.id)
          .some((e) => e.type === 'tool.completed' && JSON.parse(e.detail).tool === tool),
      );
      assert.equal(system.store.payments(task.id).length, 0);
    }
  } finally {
    await system.close();
  }
});
