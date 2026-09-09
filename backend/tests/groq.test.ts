import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GroqProvider } from '../src/agent/groq.js';
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

test('Groq: proper endpoint, tool calling schema, and multi-step tool execution', async () => {
  const requests: Record<string, any>[] = [];
  const provider = new GroqProvider(
    task,
    'TEST_GROQ_KEY',
    'llama-3.3-70b-versatile',
    async (url, init) => {
      assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer TEST_GROQ_KEY');
      assert.equal(init?.redirect, 'error');
      const body = JSON.parse(String(init?.body));
      requests.push(body);
      assert.equal(body.model, 'llama-3.3-70b-versatile');
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
                    tool_calls: [
                      {
                        id: 'call_cmc',
                        type: 'function',
                        function: { name: 'buy_cmc_quote', arguments: '{}' },
                      },
                    ],
                  }
                : { role: 'assistant', content: 'ETH Treasury Report.' },
          },
        ],
        usage: { prompt_tokens: 15, completion_tokens: 30 },
      });
    },
    toolsForServices(realServices),
  );

  const first = await provider.next([]);
  assert.equal(first.calls[0]!.name, 'buy_cmc_quote');
  const observation = { call: first.calls[0]!, output: { data: { symbol: 'ETH' } } };
  const second = await provider.next([observation]);
  assert.equal(second.text, 'ETH Treasury Report.');
  assert.equal(requests[1]!.messages.find((m: any) => m.role === 'tool').tool_call_id, 'call_cmc');
  assert.ok(!JSON.stringify(requests).includes('TEST_GROQ_KEY'));
});

test('Groq: HTTP errors and truncated calls throw appropriate errors', async () => {
  const failed = new GroqProvider(
    task,
    'test',
    'llama-3.3-70b-versatile',
    async () => new Response('rate limit', { status: 429 }),
  );
  await assert.rejects(failed.next([]), /GROQ_RATE_LIMITED|GROQ_HTTP_429/);

  const truncated = new GroqProvider(task, 'test', 'llama-3.3-70b-versatile', async () =>
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
  await assert.rejects(truncated.next([]), /GROQ_INCOMPLETE_RESPONSE/);
});

test('Groq config: validates Groq key when AGENT_MODE=groq', () => {
  const names = ['AGENT_MODE', 'GROQ_API_KEY', 'GROQ_MODEL'] as const;
  const old = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  try {
    process.env.AGENT_MODE = 'groq';
    process.env.GROQ_API_KEY = 'gsk_test';
    process.env.GROQ_MODEL = 'llama-3.3-70b-versatile';
    assert.equal(readConfig().model, 'llama-3.3-70b-versatile');
    assert.equal(readConfig().groqKey, 'gsk_test');
    process.env.GROQ_API_KEY = '';
    assert.throws(() => readConfig(), /GROQ_API_KEY_REQUIRED/);
  } finally {
    for (const name of names) {
      if (old[name] === undefined) delete process.env[name];
      else process.env[name] = old[name];
    }
  }
});
