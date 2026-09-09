import 'dotenv/config';
import { resolve } from 'node:path';
import { cliRunner } from '../src/payments/binance.js';
import { buyCmcOnce } from '../src/payments/cmc-demo.js';

// Explicit one-time purchase confirmation via CLI flag. Does not alter .env or
// enable generic dashboard payment permissions. Never prints signing headers to terminal.
if (process.argv.slice(2).join(' ') !== '--confirm-0.01-usdc') {
  console.log('Purchase 1-time ETH data snapshot from CoinMarketCap for 0.01 USDC on Base.');
  console.log('To confirm and pay: npm run wallet:buy:cmc -- --confirm-0.01-usdc');
  console.log('Not yet signed or paid.');
} else {
  try {
    const result = await buyCmcOnce({
      confirmed: true,
      run: cliRunner(process.env.BAW_CLI_JS ?? ''),
      directory: resolve('data'),
    });
    console.log('Received ETH market data and payment receipt from CoinMarketCap.');
    console.log('Transaction: ' + result.transaction);
    console.log('Explorer: https://basescan.org/tx/' + result.transaction);
    console.log('Data: ' + result.dataPath);
    console.log('Audit: ' + result.journalPath);
    console.log('Receipt reported by merchant; verify on-chain settlement on explorer.');
  } catch (error) {
    console.error(
      error instanceof Error &&
        !(error instanceof SyntaxError) &&
        /^[A-Z0-9_]+$/.test(error.message)
        ? error.message
        : 'CMC_PURCHASE_FAILED',
    );
    console.error(
      'If data/cmc-first-payment.jsonl exists, keep the file intact and inspect before retrying.',
    );
    process.exitCode = 1;
  }
}
