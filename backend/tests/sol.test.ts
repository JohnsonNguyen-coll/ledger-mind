import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startSystem } from '../src/system.js';
import { testConfig } from './helpers.js';
import { cmcData, cmcResource } from '../src/services/cmc.js';
import { mismatchedTaskSymbol } from '../src/agent/task-symbol.js';

test('single-asset mismatch guard handles SOL aliases without confusing comparisons', () => {
  for (const prompt of ['Research SOL', 'nghiên cứu solana', 'SOLUSDT price']) {
    assert.equal(mismatchedTaskSymbol(prompt, 'ETH'), true);
    assert.equal(mismatchedTaskSymbol(prompt, 'SOL'), false);
  }
  assert.equal(mismatchedTaskSymbol('Compare ETH with SOL', 'ETH'), false);
  assert.equal(mismatchedTaskSymbol('Consolidate the report', 'ETH'), false);
});

test('SOL uses its own CMC ID and rejects an ETH response', () => {
  assert.ok(cmcResource('SOL').endsWith('?id=5426'));
  const body = { status: { error_code: 0 }, data: { '5426': {
    id: 5426, symbol: 'SOL', quote: { USD: { price: 150, last_updated: '2026-09-04T00:00:00.000Z' } },
  } } };
  assert.equal(cmcData(body, 'SOL').symbol, 'SOL');
  body.data['5426'].symbol = 'ETH';
  assert.throws(() => cmcData(body, 'SOL'));
});

test('SOL HTTP task receives SOL fixtures; mismatch creates no task or payment', async () => {
  const system = await startSystem(testConfig());
  try {
    const config = await (await fetch(system.url + '/api/config')).json() as { csrfToken: string };
    const post = (symbol: string) => fetch(system.url + '/api/tasks', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-AlphaMesh-Token': config.csrfToken },
      body: JSON.stringify({ requestKey: randomUUID(), prompt: 'Research SOL', symbol, budgetUsd: '0.20' }),
    });
    const mismatch = await post('ETH');
    assert.equal(mismatch.status, 400);
    assert.deepEqual(await mismatch.json(), { error: 'TASK_SYMBOL_MISMATCH' });
    assert.equal(system.store.tasks().length, 0);
    assert.equal(system.store.payments().length, 0);
    const result = await post('SOL');
    assert.equal(result.status, 202);
    const { taskId } = await result.json() as { taskId: string };
    await system.runner.idle();
    assert.equal(system.store.getTask(taskId).status, 'completed');
    assert.equal(system.store.getTask(taskId).symbol, 'SOL');
    assert.equal(system.store.totals(taskId).spent, 60000);
    for (const payment of system.store.payments(taskId)) assert.equal(JSON.parse(payment.data!).symbol, 'SOL');
    assert.ok(system.store.getTask(taskId).result?.includes('SOL'));
  } finally { await system.close(); }
});
