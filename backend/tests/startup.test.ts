import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { startSystem } from '../src/system.js';
import { databaseIdentity, findRunningInstance } from '../src/instance.js';
import { testConfig } from './helpers.js';

test('repeated startup finds the same DB and preserves running tasks and reservations', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ledgermind-startup-'));
  const config = testConfig({ databasePath: join(dir, 'demo.sqlite') });
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
    await assert.rejects(startSystem(runningConfig), /DATABASE_ALREADY_IN_USE/);
    assert.equal(await findRunningInstance(runningConfig), system.url);
    assert.equal(system.store.getTask(task.id).status, 'running');
    assert.equal(system.store.payments()[0]?.state, 'reserved');
    assert.equal(system.store.totals().held, 30_000);
    const health = (await (await fetch(system.url + '/api/health')).json()) as Record<
      string,
      unknown
    >;
    assert.equal(health.databaseId, databaseIdentity(config.databasePath));
    assert.equal(JSON.stringify(health).includes(dir), false);
  } finally {
    await system.close();
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('unrelated DB, mismatched lock PID and unreachable server are not reused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ledgermind-startup-'));
  const config = testConfig({ databasePath: join(dir, 'demo.sqlite') });
  const system = await startSystem(config);
  const port = Number(new URL(system.url).port);
  try {
    const otherPath = join(dir, 'other.sqlite');
    writeFileSync(otherPath + '.lock', String(process.pid));
    assert.equal(await findRunningInstance({ databasePath: otherPath, port }), null);
    // Tạm thay PID trong lock của DB test để chứng minh probe không nhận nhầm.
    writeFileSync(config.databasePath + '.lock', String(process.pid + 1));
    assert.equal(await findRunningInstance({ databasePath: config.databasePath, port }), null);
    writeFileSync(config.databasePath + '.lock', String(process.pid));
    assert.equal(await findRunningInstance({ databasePath: config.databasePath, port: 0 }), null);
  } finally {
    await system.close();
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    rmSync(dir, { recursive: true, force: true });
  }
});
