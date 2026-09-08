import 'dotenv/config';
import { resolve } from 'node:path';
import { cliRunner } from '../src/payments/binance.js';
import { buyCmcOnce } from '../src/payments/cmc-demo.js';

// Chính người chạy xác nhận khoản mua cố định qua flag. Không thay .env hoặc
// bật quyền thanh toán chung của dashboard. Không in header ký ra terminal.
if (process.argv.slice(2).join(' ') !== '--confirm-0.01-usdc') {
  console.log('Mua 1 lan du lieu ETH tu CoinMarketCap, gia 0.01 USDC tren Base.');
  console.log('De dong y va thanh toan: npm run wallet:buy:cmc -- --confirm-0.01-usdc');
  console.log('Chua ky hoac thanh toan.');
} else {
  try {
    const result = await buyCmcOnce({
      confirmed: true,
      run: cliRunner(process.env.BAW_CLI_JS ?? ''),
      directory: resolve('data'),
    });
    console.log('Da nhan du lieu ETH va bien nhan thanh toan tu CoinMarketCap.');
    console.log('Transaction: ' + result.transaction);
    console.log('Explorer: https://basescan.org/tx/' + result.transaction);
    console.log('Data: ' + result.dataPath);
    console.log('Audit: ' + result.journalPath);
    console.log('Bien nhan do merchant bao; can doi chieu giao dich tren chain.');
  } catch (error) {
    console.error(
      error instanceof Error &&
        !(error instanceof SyntaxError) &&
        /^[A-Z0-9_]+$/.test(error.message)
        ? error.message
        : 'CMC_PURCHASE_FAILED',
    );
    console.error(
      'Neu da co data/cmc-first-payment.jsonl, giu nguyen file va kiem tra truoc khi mua lai.',
    );
    process.exitCode = 1;
  }
}
