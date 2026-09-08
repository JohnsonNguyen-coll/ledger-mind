import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OpenRouterProvider } from '../src/agent/openrouter.js';
import { toolsForServices } from '../src/agent/provider.js';
import { realServices } from '../src/services/registry.js';
import { readConfig } from '../src/config.js';
import type { Task } from '../src/types.js';

const task: Task = {
  id: 'test',
  requestKey: 'test',
  prompt: 'Research ETH',
  symbol: 'ETH',
  budget: 10000,
  status: 'running',
  createdAt: new Date().toISOString(),
  result: null,
  error: null,
};
test('OpenRouter free: proper endpoint, chat tool schema and multi-step result history without exposed reasoning', async () => {
  const requests: Record<string, any>[] = [];
  const provider = new OpenRouterProvider(
    task,
    'TEST_OR_KEY',
    'openrouter/free',
    async (url, init) => {
      assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer TEST_OR_KEY');
      assert.equal(init?.redirect, 'error');
      const body = JSON.parse(String(init?.body));
      requests.push(body);
      assert.equal(body.model, 'openrouter/free');
      assert.ok(!body.models); // Không tự chọn fallback trả phí.
      assert.deepEqual(
        body.tools.map((t: any) => t.function.name),
        ['get_market', 'get_budget', 'compare_markets', 'get_spending_summary', 'buy_cmc_quote'],
      );
      return Response.json({
        choices: [
          {
            finish_reason: requests.length === 1 ? 'tool_calls' : 'stop',
            message:
              requests.length === 1
                ? {
                    role: 'assistant',
                    content: null,
                    reasoning_details: [{ type: 'reasoning.encrypted', data: 'OPAQUE_TEST' }],
                    tool_calls: [
                      {
                        id: 'call_cmc',
                        type: 'function',
                        function: { name: 'buy_cmc_quote', arguments: '{}' },
                      },
                    ],
                  }
                : { role: 'assistant', content: 'Báo cáo ETH.' },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      });
    },
    toolsForServices(realServices),
  );
  const first = await provider.next([]);
  assert.equal(first.calls[0]!.name, 'buy_cmc_quote');
  assert.ok(!JSON.stringify(first).includes('OPAQUE_TEST'));
  const observation = { call: first.calls[0]!, output: { data: { symbol: 'ETH' } } };
  assert.equal((await provider.next([observation])).text, 'Báo cáo ETH.');
  await provider.next([observation]);
  assert.equal(requests[2]!.messages.filter((m: any) => m.role === 'tool').length, 1);
  assert.equal(requests[1]!.messages.find((m: any) => m.role === 'tool').tool_call_id, 'call_cmc');
  assert.ok(!JSON.stringify(requests).includes('TEST_OR_KEY'));
});
test('OpenRouter: HTTP errors and truncated calls never reach the executor', async () => {
  const failed = new OpenRouterProvider(
    task,
    'test',
    'openrouter/free',
    async () => new Response('secret body', { status: 429 }),
  );
  await assert.rejects(failed.next([]), /^Error: OPENROUTER_HTTP_429$/);
  const truncated = new OpenRouterProvider(task, 'test', 'openrouter/free', async () =>
    Response.json({
      choices: [
        {
          finish_reason: 'length',
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'partial',
                type: 'function',
                function: { name: 'buy_cmc_quote', arguments: '{' },
              },
            ],
          },
        },
      ],
    }),
  );
  await assert.rejects(truncated.next([]), /OPENROUTER_INCOMPLETE_RESPONSE/);
});
test('OpenRouter config chooses its own key/model; direct OpenAI rejects a misplaced router key', () => {
  const names = ['AGENT_MODE', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'OPENROUTER_MODEL'] as const;
  const old = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  try {
    process.env.AGENT_MODE = 'openrouter';
    process.env.OPENROUTER_API_KEY = 'test-router';
    process.env.OPENROUTER_MODEL = 'openrouter/free';
    process.env.OPENAI_API_KEY = 'sk-or-test';
    assert.equal(readConfig().model, 'openrouter/free');
    assert.equal(readConfig().openrouterKey, 'test-router');
    process.env.OPENROUTER_API_KEY = '';
    assert.throws(() => readConfig(), /OPENROUTER_API_KEY_REQUIRED/);
    process.env.AGENT_MODE = 'openai';
    assert.throws(() => readConfig(), /OPENROUTER_KEY_REQUIRES_OPENROUTER_MODE/);
  } finally {
    for (const name of names) {
      if (old[name] === undefined) delete process.env[name];
      else process.env[name] = old[name];
    }
  }
});
