import { readConfig } from '../src/config.js';
import { lockFile } from '../src/system.js';
import { Store } from '../src/store.js';
import { cliRunner, BinancePaymentAdapter } from '../src/payments/binance.js';
import { PaymentGateway } from '../src/payments/gateway.js';
import { realServices, realPolicies } from '../src/services/registry.js';
import { errorCode } from '../src/agent/runner.js';

// Fixed request key: rerunning this diagnostic cannot create another purchase.
// Use the dashboard ledger and its existing limits; never reset uncertain funds.
const requestKey = 'd2493ca7-ec6a-4127-9495-1a05d5672e76';
let unlock: (() => void) | undefined;
let store: Store | undefined;
try {
  if (process.argv.slice(2).join(' ') !== '--confirm-0.01-usdc')
    throw new Error('EXPLICIT_0_01_USDC_CONFIRMATION_REQUIRED');
  const c = readConfig(false);
  if (c.paymentMode !== 'binance' || !c.realEnabled)
    throw new Error('REAL_PAYMENTS_NOT_ENABLED');
  if (c.maxTaskBudget < 10000) throw new Error('MAX_TASK_BUDGET_EXCEEDED');
  const run = cliRunner(c.bawCliJs);
  const status = await run(['wallet', 'status']) as {success?: boolean; data?: {status?: string}};
  if (!status.success || status.data?.status !== 'CONNECTED')
    throw new Error('WALLET_NOT_CONNECTED');
  unlock = lockFile(c.databasePath);
  store = new Store(c.databasePath, {wallet: c.wallet, maxPayment: c.maxPayment, dailyBudget: c.dailyBudget});
  const {task, created} = store.createTask({requestKey, prompt: 'One authorized ETH CMC payment diagnostic, maximum 0.01 USDC, no retry.', symbol: 'ETH', budget: 10000});
  console.log('Task: ' + task.id);
  if (!created) throw new Error('DIAGNOSTIC_ALREADY_ATTEMPTED_NO_RETRY');
  store.event(task.id, 'payment.consent', {source:'diagnostic', budget:10000, token:'USDC', network:'eip155:8453', services:['cmc_quote']});
  try {
    const gateway = new PaymentGateway(store, new BinancePaymentAdapter(run, realPolicies, true));
    const data = await gateway.purchase(task, realServices[0]!);
    store.finish(task.id, JSON.stringify(data));
    console.log('CMC data received. Settlement must be checked below.');
  } catch (e) {
    const code = errorCode(e);
    store.finish(task.id, 'Payment diagnostic failed: ' + code, code);
    console.log('Result: ' + code);
    process.exitCode = 1;
  }
  for (const event of store.audit(task.id)) {
    if (event.type.startsWith('payment.')) console.log(JSON.stringify(event));
  }
  console.log('Task totals (microUSD): ' + JSON.stringify(store.totals(task.id)));
  console.log('No retry performed. Held amounts are local reservations, not proof of a wallet debit.');
} catch (e) {
  console.log('Stopped: ' + errorCode(e));
  process.exitCode = 1;
} finally {
  store?.close();
  unlock?.();
}
