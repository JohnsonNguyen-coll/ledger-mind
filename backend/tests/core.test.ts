import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { usd, money } from '../src/money.js';
import { Store } from '../src/store.js';

const create = (s: Store, budget = 200_000, key = randomUUID()) =>
  s.createTask({ requestKey: key, prompt: 'Research ETH', symbol: 'ETH', budget }).task;
test('money: decimal exactness, micro precision, invalid and overflow inputs', () => {
  assert.equal(usd('0.1') + usd('0.2'), usd('0.3'));
  assert.equal(usd('0.000001'), 1);
  assert.equal(money(60_000), '0.06');
  for (const v of ['-1', 'NaN', 'Infinity', '1e3', '0.0000001', '', '1,00', '99999999999999'])
    assert.throws(() => usd(v));
});
test('budget: exact boundary; task, per-payment, wallet and daily limits', () => {
  const s = new Store(':memory:', { wallet: 60_000, maxPayment: 30_000, dailyBudget: 50_000 });
  try {
    const t = create(s, 40_000);
    s.reserve(t.id, 'whale', 'r1', 30_000);
    assert.throws(() => s.reserve(t.id, 'risk', 'r2', 20_000), /TASK_BUDGET_EXCEEDED/);
    s.reserve(t.id, 'risk', 'r2', 10_000);
    const t2 = create(s);
    assert.throws(() => s.reserve(t2.id, 'x', 'a', 40_000), /PER_PAYMENT_LIMIT/);
    s.reserve(t2.id, 'risk', 'r3', 10_000);
    assert.throws(() => s.reserve(t2.id, 'x', 'b', 1), /DAILY_BUDGET_EXCEEDED/);
    assert.equal(s.totals().committed, 50_000);
  } finally {
    s.close();
  }
  const w = new Store(':memory:', { wallet: 10_000, maxPayment: 30_000, dailyBudget: 100_000 });
  try {
    assert.throws(() => w.reserve(create(w).id, 'whale', 'r', 20_000), /WALLET_INSUFFICIENT/);
  } finally {
    w.close();
  }
});
test('idempotency: duplicate task, conflict, settled payment, and invalid transitions', () => {
  const s = new Store(':memory:', { wallet: 1e6, maxPayment: 1e5, dailyBudget: 1e6 });
  try {
    const key = randomUUID(),
      t = create(s, 200_000, key);
    assert.equal(create(s, 200_000, key).id, t.id);
    assert.throws(() => create(s, 100_000, key), /IDEMPOTENCY_CONFLICT/);
    const p = s.reserve(t.id, 'whale', 'resource', 30_000);
    assert.throws(() => s.reserve(t.id, 'whale', 'resource', 30_000), /PAYMENT_ALREADY_ATTEMPTED/);
    s.transition(p.id, 'settled', 'mock:test');
    assert.equal(s.reserve(t.id, 'whale', 'resource', 30_000).id, p.id);
    assert.equal(s.totals().spent, 30_000);
    assert.throws(() => s.transition(p.id, 'released'), /INVALID_PAYMENT_TRANSITION/);
    assert.throws(() => s.reserve(t.id, 'whale', 'resource', 40_000), /PRICE_CHANGED/);
  } finally {
    s.close();
  }
});
test('daily reset: unsettled holds remain across UTC midnight; settled usage resets', () => {
  let now = new Date('2026-09-01T23:59:00Z');
  const s = new Store(':memory:', { wallet: 1e6, maxPayment: 1e5, dailyBudget: 50_000 }, () => now);
  try {
    const t = create(s);
    const p = s.reserve(t.id, 'whale', 'a', 30_000);
    const q = s.reserve(t.id, 'risk', 'b', 20_000);
    s.transition(q.id, 'settled', 'mock:q');
    now = new Date('2026-09-02T00:01:00Z');
    assert.equal(s.overview().dailyRemaining, 20_000);
    s.transition(p.id, 'settled', 'mock:p');
    assert.equal(s.overview().dailyRemaining, 20_000);
  } finally {
    s.close();
  }
});
test('restart: unresolved reservation remains held and task interrupted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'alphamesh-test-'));
  const path = join(dir, 'db.sqlite');
  const limits = { wallet: 1e6, maxPayment: 1e5, dailyBudget: 1e6 };
  let s = new Store(path, limits);
  try {
    const t = create(s);
    s.reserve(t.id, 'whale', 'r', 30_000);
    s.close();
    s = new Store(path, limits);
    s.recover();
    assert.equal(s.getTask(t.id).status, 'interrupted');
    assert.equal(s.payments()[0]?.state, 'unknown');
    assert.equal(s.totals().held, 30_000);
    assert.ok(s.verifyAudit());
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('audit: append-only triggers and hash verification catch tampering', () => {
  const s = new Store(':memory:', { wallet: 1e6, maxPayment: 1e5, dailyBudget: 1e6 });
  try {
    create(s);
    assert.ok(s.verifyAudit());
    assert.throws(() => s.db.exec("UPDATE audit SET type='changed'"), /append only/);
    s.db.exec("DROP TRIGGER audit_no_update; UPDATE audit SET type='changed'");
    assert.equal(s.verifyAudit(), false);
  } finally {
    s.close();
  }
});
test('released funds are returned; unknown funds stay held', () => {
  const s = new Store(':memory:', { wallet: 1e6, maxPayment: 1e5, dailyBudget: 1e6 });
  try {
    const t = create(s);
    const p = s.reserve(t.id, 'a', 'a', 10_000);
    const q = s.reserve(t.id, 'b', 'b', 20_000);
    s.transition(p.id, 'released');
    s.transition(q.id, 'unknown');
    assert.deepEqual(s.totals(), { spent: 0, held: 20_000, committed: 20_000 });
  } finally {
    s.close();
  }
});
