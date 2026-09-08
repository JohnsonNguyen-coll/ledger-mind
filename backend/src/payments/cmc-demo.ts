import { mkdir, open, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { BawRunner } from './binance.js';

// Một lần mua cố định đã được người dùng xem báo giá. Model không chọn URL,
// người nhận, token hay giá. Không tự đổi mạng/option khi phương án này lỗi.
export const cmcPurchase = {
  url: 'https://pro-api.coinmarketcap.com/x402/v3/cryptocurrency/quotes/latest?id=1027',
  network: 'eip155:8453',
  asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  payTo: '0x3C5f3a6cE224BB89D72f5EB4232ecC27F67B3eeA',
  amount: '10000',
} as const;
const acceptSchema = z
  .object({
    scheme: z.literal('exact'),
    network: z.string(),
    asset: z.string(),
    amount: z.string(),
    payTo: z.string(),
    extra: z.object({ name: z.literal('USD Coin'), version: z.literal('2') }).passthrough(),
  })
  .passthrough();
function matches(value: unknown): boolean {
  const result = acceptSchema.safeParse(value);
  return (
    result.success &&
    result.data.network === cmcPurchase.network &&
    result.data.asset.toLowerCase() === cmcPurchase.asset.toLowerCase() &&
    result.data.payTo.toLowerCase() === cmcPurchase.payTo.toLowerCase() &&
    result.data.amount === cmcPurchase.amount
  );
}

export function validateCmcChallenge(value: unknown) {
  const challenge = z
    .object({
      x402Version: z.literal(2),
      resource: z.object({ url: z.string() }).passthrough(),
      accepts: z.array(z.unknown()).min(1).max(50),
    })
    .passthrough()
    .parse(value);
  const target = new URL(cmcPurchase.url);
  const resource = new URL(challenge.resource.url, target);
  if (
    resource.origin !== target.origin ||
    resource.pathname !== target.pathname ||
    resource.username ||
    resource.password ||
    resource.hash ||
    (resource.search && resource.search !== target.search)
  )
    throw new Error('CMC_RESOURCE_CHANGED');
  if (!challenge.accepts.some(matches)) throw new Error('CMC_PRICE_TOKEN_OR_RECIPIENT_CHANGED');
  // Trả lại nguyên JSON: không làm mất extensions/extra hoặc sửa resource URL.
  return value;
}

export function selectCmcOption(value: unknown) {
  const preview = z
    .object({
      success: z.literal(true),
      data: z.object({
        paymentId: z.string().uuid(),
        options: z.array(z.unknown()).max(50),
      }),
    })
    .parse(value);
  const optionSchema = z.object({
    index: z.number().int().positive(),
    status: z.literal('READY_TO_SIGN'),
    needApproveFirst: z.literal(false),
    assetTransferMethod: z.literal('eip3009'),
    binanceChainId: z.literal('8453'),
    tokenAddress: z.string(),
    payTo: z.string(),
    amount: z.string().regex(/^0\.01(?:0*)$/),
    originalAccept: z.unknown(),
  });
  for (const candidate of preview.data.options) {
    const result = optionSchema.safeParse(candidate);
    if (
      result.success &&
      matches(result.data.originalAccept) &&
      result.data.tokenAddress.toLowerCase() === cmcPurchase.asset.toLowerCase() &&
      result.data.payTo.toLowerCase() === cmcPurchase.payTo.toLowerCase()
    ) {
      return { paymentId: preview.data.paymentId, index: result.data.index };
    }
  }
  throw new Error('NO_READY_BASE_USDC_OPTION');
}

async function bodyText(response: Response, max: number) {
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  if (!response.body) throw new Error('EMPTY_RESPONSE');
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > max) throw new Error('RESPONSE_TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Lệnh demo thật độc lập, tối đa một lần ký và một lần gửi header.
 * Nhật ký độc quyền được fsync TRƯỚC khi ký. Timeout/crash giữ nguyên nhật ký,
 * lần chạy sau bị chặn để không mua trùng. Không lưu signature/paymentId.
 * Kiểm thử truyền fetch/run giả; code production không nhận URL tùy ý.
 */
export async function buyCmcOnce(deps: {
  confirmed: boolean;
  run: BawRunner;
  directory: string;
  fetcher?: typeof fetch;
}) {
  if (!deps.confirmed) throw new Error('EXPLICIT_0_01_USDC_CONFIRMATION_REQUIRED');
  const fetcher = deps.fetcher ?? fetch;
  await mkdir(deps.directory, { recursive: true });
  const journalPath = resolve(deps.directory, 'cmc-first-payment.jsonl');
  // Chặn lần chạy lặp trước cả preview. open('wx') bên dưới vẫn xử lý race.
  try {
    const existing = await open(journalPath, 'r');
    await existing.close();
    throw new Error('PAYMENT_ATTEMPT_EXISTS_CHECK_AUDIT_DO_NOT_REPAY');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const status = z
    .object({
      success: z.literal(true),
      data: z.object({
        status: z.literal('CONNECTED'),
      }),
    })
    .safeParse(await deps.run(['wallet', 'status']));
  if (!status.success) throw new Error('WALLET_NOT_CONNECTED');
  const response = await fetcher(cmcPurchase.url, {
    headers: { Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status !== 402) {
    await response.body?.cancel();
    throw new Error(`EXPECTED_402_GOT_${response.status}`);
  }
  const header = response.headers.get('PAYMENT-REQUIRED');
  let raw: string;
  if (header) {
    await response.body?.cancel();
    if (header.length > 24_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(header))
      throw new Error('INVALID_PAYMENT_REQUIRED');
    raw = Buffer.from(header, 'base64').toString('utf8');
  } else raw = await bodyText(response, 16_000);
  if (Buffer.byteLength(raw) > 16_000) throw new Error('REQUIREMENTS_TOO_LARGE');
  const challenge = validateCmcChallenge(JSON.parse(raw));
  const encoded = Buffer.from(JSON.stringify(challenge)).toString('base64');
  if (encoded.length > 24_000) throw new Error('REQUIREMENTS_TOO_LARGE');
  const selected = selectCmcOption(
    await deps.run(['x402-payment', 'preview', '--paymentRequirements', encoded]),
  );

  const journal = await open(journalPath, 'wx');
  const record = async (event: string, details: Record<string, unknown> = {}) => {
    await journal.writeFile(
      JSON.stringify({ at: new Date().toISOString(), event, ...details }) + '\n',
    );
    await journal.sync();
  };
  let settled = false;
  try {
    await record('signing_started', { ...cmcPurchase, tokenAmount: '0.01', token: 'USDC' });
    const signed = z
      .object({
        success: z.literal(true),
        data: z.object({
          paymentHeaderName: z.literal('PAYMENT-SIGNATURE'),
          paymentHeaderValue: z
            .string()
            .min(1)
            .max(32_000)
            .regex(/^[A-Za-z0-9+/=_-]+$/),
          approveTxHash: z.null(),
          signatureExpiresAt: z.number().int(),
        }),
      })
      .parse(
        await deps.run([
          'x402-payment',
          'sign',
          '--paymentId',
          selected.paymentId,
          '--selectedIndex',
          String(selected.index),
        ]),
      );
    if (signed.data.signatureExpiresAt * 1000 <= Date.now()) throw new Error('SIGNATURE_EXPIRED');
    await record('submission_started');
    // Không redirect hoặc retry request đã có chữ ký, kể cả lỗi mạng.
    const paid = await fetcher(cmcPurchase.url, {
      headers: { Accept: 'application/json', 'PAYMENT-SIGNATURE': signed.data.paymentHeaderValue },
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    await record('merchant_response', { httpStatus: paid.status });
    let transaction: string | undefined;
    const proof = paid.headers.get('PAYMENT-RESPONSE');
    if (proof && proof.length <= 16_000) {
      try {
        const receipt = z
          .object({
            success: z.literal(true),
            network: z.literal('eip155:8453').optional(),
            networkId: z.literal('eip155:8453').optional(),
            transaction: z.string().optional(),
            txHash: z.string().optional(),
          })
          .parse(JSON.parse(Buffer.from(proof, 'base64').toString('utf8')));
        const tx = receipt.transaction || receipt.txHash;
        const net = receipt.network || receipt.networkId;
        if (tx && /^0x[0-9a-fA-F]{64}$/.test(tx) && net === 'eip155:8453') transaction = tx;
      } catch {
        /* Thiếu/sai receipt không đồng nghĩa chưa trả tiền. */
      }
    }
    if (transaction) {
      settled = true;
      await record('merchant_reported_settlement', { transaction, network: cmcPurchase.network });
    }
    const data = JSON.parse(await bodyText(paid, 1_000_000));
    const dataPath = resolve(deps.directory, 'cmc-eth-result.json');
    await writeFile(dataPath, JSON.stringify(data, null, 2), 'utf8');
    if (!paid.ok) throw new Error(`MERCHANT_HTTP_${paid.status}`);
    if (data?.status?.error_code !== 0 || !data?.data?.['1027'])
      throw new Error('CMC_ETH_DATA_SCHEMA_UNEXPECTED');
    if (!transaction) throw new Error('SETTLEMENT_UNCONFIRMED_CHECK_WALLET');
    await record('completed', { dataPath, transaction });
    return { transaction, dataPath, journalPath };
  } catch (error) {
    // Không log lỗi gốc từ merchant/CLI vì có thể kèm header hay session.
    await record(settled ? 'settlement_reported_data_incomplete' : 'outcome_unknown_check_wallet');
    throw new Error(
      settled
        ? 'PAYMENT_REPORTED_DATA_INCOMPLETE_CHECK_AUDIT'
        : 'PAYMENT_OUTCOME_UNKNOWN_CHECK_AUDIT_DO_NOT_REPAY',
    );
  } finally {
    await journal.close();
  }
}
