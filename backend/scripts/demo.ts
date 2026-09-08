import { startSystem } from '../src/system.js';
import { money } from '../src/money.js';
import { testConfig } from '../tests/helpers.js';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

// Demo tự chứa, dùng port tự cấp và DB trong memory. Không gọi OpenAI/Binance.
const system = await startSystem(testConfig());
try {
  console.log('LedgerMind · reproducible local payment demo\n');
  for (const [budget, expected] of [
    [200_000, 60_000],
    [40_000, 40_000],
    [0, 0],
  ] as const) {
    const { task } = system.store.createTask({
      requestKey: randomUUID(),
      prompt: 'Nghiên cứu ETH: whale, sentiment, risk.',
      symbol: 'ETH',
      budget,
    });
    system.runner.start(task);
    await system.runner.idle();
    const totals = system.store.totals(task.id);
    assert.equal(system.store.getTask(task.id).status, 'completed');
    assert.equal(totals.spent, expected);
    console.log(
      `Budget $${money(budget)} | spent $${money(totals.spent)} | remaining $${money(budget - totals.committed)} | ${system.store.audit(task.id).filter((e) => e.type === 'payment.blocked').length} blocked`,
    );
  }
  assert.ok(system.store.verifyAudit());
  console.log('\nPASS: all demo scenarios, budgets, and audit integrity. No real payments.');
} finally {
  await system.close();
}
