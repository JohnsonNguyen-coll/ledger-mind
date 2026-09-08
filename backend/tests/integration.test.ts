import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startSystem } from '../src/system.js';
import { testConfig } from './helpers.js';
import { PaymentGateway } from '../src/payments/gateway.js';
import { MockPaymentAdapter } from '../src/payments/mock.js';
import { DefinitelyUnpaidError, type PaymentAdapter } from '../src/payments/adapter.js';
import { AgentRunner } from '../src/agent/runner.js';
import type { Provider } from '../src/agent/provider.js';

test('HTTP demo: 402, $0.06 full research, $0.04 limit, $0 free, export and idempotency', async () => {
  const system = await startSystem(testConfig());
  try {
    const configuration = (await (await fetch(system.url + '/api/config')).json()) as {
      csrfToken: string;
    };
    const headers = {
      'Content-Type': 'application/json',
      'X-AlphaMesh-Token': configuration.csrfToken,
    };
    assert.equal((await fetch(system.services[0]!.baseUrl + '/data/ETH')).status, 402);
    for (const [budget, expected] of [
      ['0.20', 60_000],
      ['0.04', 40_000],
      ['0', 0],
    ] as const) {
      const request = {
        requestKey: randomUUID(),
        prompt: 'Research ETH',
        symbol: 'ETH',
        budgetUsd: budget,
      };
      const post = await fetch(system.url + '/api/tasks', {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
      });
      assert.equal(post.status, 202);
      const { taskId } = (await post.json()) as { taskId: string };
      await system.runner.idle();
      const task = system.store.getTask(taskId);
      assert.equal(task.status, 'completed');
      assert.equal(system.store.totals(taskId).spent, expected);
      assert.ok(task.result?.includes('fixture'));
      const replay = await fetch(system.url + '/api/tasks', {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
      });
      assert.equal(replay.status, 200);
      assert.deepEqual(await replay.json(), { taskId });
      if (budget === '0.04')
        assert.ok(system.store.audit(taskId).some((e) => e.type === 'payment.blocked'));
    }
    assert.equal(system.store.tasks().length, 3);
    assert.equal(system.store.totals().spent, 100_000);
    const audit = (await (await fetch(system.url + '/api/audit/export')).json()) as {
      integrityValid: boolean;
      events: unknown[];
    };
    assert.ok(audit.integrityValid);
    assert.ok(audit.events.length > 10);
    assert.ok(!JSON.stringify(audit).includes('X-AlphaMesh-Receipt'));
  } finally {
    await system.close();
  }
});
test('HTTP guards: missing token, hostile origin, malformed input, budget cap and unknown task', async () => {
  const s = await startSystem(testConfig());
  try {
    const c = (await (await fetch(s.url + '/api/config')).json()) as { csrfToken: string };
    const body = JSON.stringify({
      requestKey: randomUUID(),
      prompt: 'Research ETH',
      symbol: 'ETH',
      budgetUsd: '0.2',
    });
    assert.equal(
      (
        await fetch(s.url + '/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        })
      ).status,
      403,
    );
    assert.equal(
      (await fetch(s.url + '/api/config', { headers: { Origin: 'https://evil.example' } })).status,
      403,
    );
    for (const budget of ['-1', 'NaN', '2', '0.0000001'])
      assert.equal(
        (
          await fetch(s.url + '/api/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-AlphaMesh-Token': c.csrfToken },
            body: JSON.stringify({
              requestKey: randomUUID(),
              prompt: 'Research ETH',
              symbol: 'ETH',
              budgetUsd: budget,
            }),
          })
        ).status,
        400,
      );
    assert.equal((await fetch(s.url + '/api/tasks/missing')).status, 404);
  } finally {
    await s.close();
  }
});
test('parallel calls: same tool charged once; competing tasks cannot exceed shared daily budget', async () => {
  const s = await startSystem(testConfig({ dailyBudget: 50_000 }));
  try {
    const make = () =>
      s.store.createTask({
        requestKey: randomUUID(),
        prompt: 'Research',
        symbol: 'ETH',
        budget: 200_000,
      }).task;
    const t = make(),
      service = s.services[0]!;
    const [a, b] = await Promise.all([
      s.gateway.purchase(t, service),
      s.gateway.purchase(t, service),
    ]);
    assert.deepEqual(a, b);
    assert.equal(s.store.payments(t.id).length, 1);
    await s.gateway.purchase(t, service);
    assert.equal(s.store.totals().spent, 30_000);
    const results = await Promise.allSettled([
      s.gateway.purchase(make(), s.services[1]!),
      s.gateway.purchase(make(), s.services[1]!),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(s.store.totals().spent, 50_000);
  } finally {
    await s.close();
  }
});
test('failure after mock charge does not refund or recharge', async () => {
  const s = await startSystem(testConfig());
  try {
    const t = s.store.createTask({
      requestKey: randomUUID(),
      prompt: 'Research',
      symbol: 'ETH',
      budget: 200_000,
    }).task;
    // Signed mock proof is deliberately for a different seller secret: seller rejects delivery.
    const gateway = new PaymentGateway(s.store, new MockPaymentAdapter('different-secret'));
    await assert.rejects(gateway.purchase(t, s.services[0]!), /PAID_SERVICE_HTTP_403/);
    assert.equal(s.store.totals().spent, 30_000);
    await assert.rejects(gateway.purchase(t, s.services[0]!), /PAID_DATA_UNAVAILABLE_NO_RECHARGE/);
    assert.equal(s.store.totals().spent, 30_000);
  } finally {
    await s.close();
  }
});
test('unknown signing errors hold funds; known unpaid errors release', async () => {
  for (const definite of [false, true]) {
    const s = await startSystem(testConfig());
    try {
      const mock = new MockPaymentAdapter('test');
      const adapter: PaymentAdapter = {
        mode: 'binance',
        preview: mock.preview.bind(mock),
        settlement: () => {
          throw Error('unused');
        },
        authorize: async () => {
          throw definite ? new DefinitelyUnpaidError('DISABLED') : new Error('TIMEOUT');
        },
      };
      const gateway = new PaymentGateway(s.store, adapter);
      const task = s.store.createTask({
        requestKey: randomUUID(),
        prompt: 'Research',
        symbol: 'ETH',
        budget: 200_000,
      }).task;
      await assert.rejects(gateway.purchase(task, s.services[0]!));
      assert.equal(s.store.payments()[0]?.state, definite ? 'released' : 'unknown');
      assert.equal(s.store.totals().held, definite ? 0 : 30_000);
    } finally {
      await s.close();
    }
  }
});
test('agent rejects invented tools/arguments and enforces iteration limit', async () => {
  const cfg = testConfig({ maxSteps: 2 });
  const s = await startSystem(cfg);
  try {
    const task = s.store.createTask({
      requestKey: randomUUID(),
      prompt: 'Research',
      symbol: 'ETH',
      budget: 200_000,
    }).task;
    const provider: Provider = {
      next: async () => ({
        calls: [
          { id: randomUUID(), name: 'transfer_all_funds', arguments: '{}' },
          { id: randomUUID(), name: 'buy_whale', arguments: '{"recipient":"evil"}' },
        ],
      }),
    };
    const runner = new AgentRunner(cfg, s.store, s.gateway, s.services);
    runner.start(task, provider);
    await runner.idle();
    assert.equal(s.store.getTask(task.id).error, 'AGENT_STEP_LIMIT');
    assert.equal(s.store.payments().length, 0);
  } finally {
    await s.close();
  }
});
