import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { cliRunner } from '../src/payments/binance.js';
import { errorCode } from '../src/agent/runner.js';

/** Read-only helper. File requirements lấy từ merchant đã xác minh.
 * Không nhận private key/seed. Không gọi sign. Chỉ xuất trường công khai của
 * báo giá, không in raw stdout, wallet session hoặc payment-header value. */
try {
  const file = process.argv[2];
  if (!file) throw new Error('USAGE_NPM_RUN_WALLET_PREVIEW_REQUIREMENTS_JSON');
  const text = await readFile(file, 'utf8');
  if (Buffer.byteLength(text, 'utf8') > 16_000) throw new Error('REQUIREMENTS_TOO_LARGE');
  const parsed = JSON.parse(text);
  if (parsed.x402Version !== 2) throw new Error('ONLY_X402_V2_SUPPORTED');
  const run = cliRunner(process.env.BAW_CLI_JS ?? '');
  const status = (await run(['wallet', 'status'])) as {
    success?: boolean;
    data?: { status?: string };
  };
  if (!status.success || status.data?.status !== 'CONNECTED')
    throw new Error('CONNECT_BINANCE_AGENTIC_WALLET_FIRST');
  const preview = (await run([
    'x402-payment',
    'preview',
    '--paymentRequirements',
    Buffer.from(text).toString('base64'),
  ])) as { success?: boolean; data?: { options?: Record<string, unknown>[] } };
  if (!preview.success || !preview.data?.options) throw new Error('BINANCE_PREVIEW_FAILED');
  console.table(
    preview.data.options.map((o) => ({
      index: o.index,
      status: o.status,
      token: o.tokenSymbol,
      chain: o.binanceChainId,
      amount: o.amount,
      usd: o.amountUsd,
      balance: o.currentBalance,
      payTo: o.payTo,
      needApproveFirst: o.needApproveFirst,
    })),
  );
  // reasons là mã/giải thích của wallet, giúp phân biệt thiếu tiền, thiếu
  // allowance và mạng không được hỗ trợ. Không in paymentId hoặc chữ ký.
  for (const option of preview.data.options) {
    if (option.reasons)
      console.log(JSON.stringify({ index: option.index, reasons: option.reasons }));
  }
  console.log('Preview only. No payment signed or submitted.');
} catch (error) {
  console.error(errorCode(error));
  process.exitCode = 1;
}
