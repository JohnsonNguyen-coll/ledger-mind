import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startSystem } from '../src/system.js';
import { databaseIdentity, findRunningInstance } from '../src/instance.js';
import { testConfig } from './helpers.js';

test('startup initializes in-memory store and preserves running tasks and reservations', async () => {
  const config = testConfig();
  const system = await startSystem(config);
  try {
    const { task } = system.store.createTask({
      requestKey: randomUUID(),
      prompt: 'Research ETH',
      symbol: 'ETH',
      budget: 100_000,
    });
    system.store.reserve(task.id, 'whale', 'resource', 30_000);
    const runningConfig = { ...config, port: Number(new URL(system.url).port) };
    assert.equal(await findRunningInstance(runningConfig), system.url);
    assert.equal(system.store.getTask(task.id).status, 'running');
    assert.equal(system.store.payments()[0]?.state, 'reserved');
    assert.equal(system.store.totals().held, 30_000);
    const health = (await (await fetch(system.url + '/api/health')).json()) as Record<
      string,
      unknown
    >;
    assert.equal(health.databaseId, databaseIdentity(config.databasePath));
    assert.equal(health.ok, true);
  } finally {
    await system.close();
  }
});

test('unreachable server or mismatched port returns null for findRunningInstance', async () => {
  const config = testConfig();
  const system = await startSystem(config);
  const port = Number(new URL(system.url).port);
  try {
    assert.equal(await findRunningInstance({ port: port + 9999 }), null);
    assert.equal(await findRunningInstance({ port: 0 }), null);
  } finally {
    await system.close();
  }
});
