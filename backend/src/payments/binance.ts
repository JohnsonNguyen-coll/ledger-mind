import { execFile } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { usdCeiling } from '../money.js';
import { completeX402Envelope } from './x402-envelope.js';
import type { Payment, Service } from '../types.js';
import {
  DefinitelyUnpaidError,
  type Authorization,
  type PaymentAdapter,
  type Quote,
} from './adapter.js';

export interface MerchantPolicy {
  serviceId: string;
  origin: string;
  network: string;
  asset: string;
  payTo: string;
  tokenAmount: string;
  maxUsd: number;
  /** Only pinned endpoints may return resource URLs without queries. */
  resourcePath?: string;
  /** Fixed USDC budget nominal 1 USDC = 1 USD, independent of wallet spot estimate. */
  fixedBudgetAmount?: number;
  transferMethod?: string;
  tokenName?: string;
  tokenVersion?: string;
}
export type BawRunner = (args: string[]) => Promise<unknown>;

/** Only allowlisted codes leave the CLI boundary; never expose stderr, session
 * credentials or signature-bearing stdout. NOT_LOGGED_IN is a local preflight
 * failure in the installed CLI, before it invokes the signing API.
 */
export function bawCommandError(error: { killed?: boolean; code?: string | number | null } | null, stdout: string): Error {
  if (error?.killed) return new Error('BAW_COMMAND_TIMED_OUT');
  if (error?.code === 'ENOENT') return new Error('BAW_CLI_NOT_FOUND');
  try {
    const value = JSON.parse(stdout);
    if (value.success === false) {
      const name = value.error?.name;
      if (name === 'NOT_LOGGED_IN' && value.error?.code === 10003000)
        return new DefinitelyUnpaidError('BAW_NOT_LOGGED_IN');
      const allowed = ['SESSION_EXPIRED', 'SESSION_NOT_FOUND', 'SESSION_READ_FAILED', 'SESSION_WRITE_FAILED', 'UNAUTHORIZED', 'WALLET_NOT_EXIST', 'WALLET_CREATING', 'WALLET_STATUS_ERROR', 'WALLET_API_ERROR', 'BALANCE_API_ERROR', 'INSUFFICIENT_BALANCE', 'INSUFFICIENT_GAS', 'APP_CONFIRMATION_REQUIRED', 'QUOTE_API_ERROR', 'QUOTE_EXPIRED', 'SIGN_FAILED', 'REQUEST_TIMEOUT', 'SERVICE_UNAVAILABLE', 'NETWORK_ERROR'];
      if (allowed.includes(name)) return new Error(`BAW_${name}`);
    }
  } catch { /* Non-JSON bodies are intentionally discarded. */ }
  return new Error('BAW_COMMAND_FAILED');
}
/** Windows: runs CLI Node entry using execFile(shell:false).
 * Never inject merchant JSON into PowerShell/cmd or concatenated strings. */
export function cliRunner(entry: string): BawRunner {
  if (!isAbsolute(entry) || !/\.(c|m)?js$/i.test(entry))
    throw new Error('BAW_CLI_JS_MUST_BE_ABSOLUTE_JS_PATH');
  let lastX402Call = 0;
  return async (args) => {
    const isX402 = args.length > 0 && args[0] === 'x402-payment';
    const maxAttempts = isX402 ? 3 : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (isX402) {
        const elapsed = Date.now() - lastX402Call;
        if (elapsed < 3500) {
          await new Promise((r) => setTimeout(r, 3500 - elapsed));
        }
      }
      lastX402Call = Date.now();

      try {
        const result = await new Promise((resolve, reject) => {
          execFile(
            process.execPath,
            [entry, ...args, '--json'],
            { shell: false, windowsHide: true, timeout: 60_000, maxBuffer: 256_000 },
            (error, stdout) => {
              // Never log stdout/stderr as CLI output may contain private keys or session tokens.
              if (error) return reject(bawCommandError(error, stdout));
              try {
                const value = JSON.parse(stdout);
                if (value?.success === false) return reject(bawCommandError(null, stdout));
                resolve(value);
              } catch {
                reject(new Error('BAW_INVALID_JSON'));
              }
            },
          );
        });
        return result;
      } catch (err: any) {
        const isWafReset =
          err.message === 'BAW_COMMAND_FAILED' ||
          err.message === 'BAW_NETWORK_ERROR' ||
          err.message === 'BAW_SERVICE_UNAVAILABLE';
        if (isX402 && attempt < maxAttempts && isWafReset) {
          await new Promise((r) => setTimeout(r, 4000));
          continue;
        }
        throw err;
      }
    }
  };
}
const acceptSchema = z
  .object({
    scheme: z.literal('exact'),
    network: z.string(),
    asset: z.string(),
    amount: z.string().regex(/^\d+$/),
    payTo: z.string(),
  })
  .passthrough();
const requiredSchema = z
  .object({
    x402Version: z.literal(2),
    resource: z.object({ url: z.string().url() }).passthrough(),
    accepts: z.array(acceptSchema).min(1).max(20),
  })
  .passthrough();
const previewSchema = z.object({
  success: z.literal(true),
  data: z.object({
    paymentId: z.string().uuid(),
    options: z.array(
      z.object({
        index: z.number().int().positive(),
        status: z.string(),
        needApproveFirst: z.boolean().optional(),
        amountUsd: z.string().optional(),
        originalAccept: acceptSchema.optional(),
        assetTransferMethod: z.string().optional(),
        binanceChainId: z.string().optional(),
        tokenAddress: z.string().optional(),
        payTo: z.string().optional(),
      }),
    ),
  }),
});
const signedSchema = z.object({
  success: z.literal(true),
  data: z.object({
    paymentHeaderName: z.literal('PAYMENT-SIGNATURE'),
    paymentHeaderValue: z.string().min(1).max(32_000),
    approveTxHash: z.string().nullable(),
    signatureExpiresAt: z.number().int(),
  }),
});
interface PreviewData {
  paymentId: string;
  index: number;
  network: string;
  accepted: Record<string, unknown>;
}

/** Real buyer adapter per Binance x402 v2 specifications. Merchants must be pinned
 * in advance by operator; model has no tool to alter URL, token, or payTo.
 * Preview can run independently. Authorize defaults to disabled (enabled=false). */
export class BinancePaymentAdapter implements PaymentAdapter {
  readonly mode = 'binance' as const;
  constructor(
    private run: BawRunner,
    private policies: MerchantPolicy[],
    private enabled = false,
  ) {
    for (const p of policies) {
      if (
        !['eip155:56', 'eip155:8453'].includes(p.network) ||
        !/^0x[0-9a-fA-F]{40}$/.test(p.asset) ||
        !/^0x[0-9a-fA-F]{40}$/.test(p.payTo) ||
        !/^\d+$/.test(p.tokenAmount) ||
        (p.fixedBudgetAmount !== undefined &&
          (!Number.isSafeInteger(p.fixedBudgetAmount) || p.fixedBudgetAmount <= 0)) ||
        new URL(p.origin).protocol !== 'https:'
      )
        throw new Error('INVALID_MERCHANT_POLICY');
    }
  }
  async preview(challenge: unknown, service: Service, resource: string): Promise<Quote> {
    const requirements = requiredSchema.parse(challenge);
    const policy = this.policies.find((p) => p.serviceId === service.id);
    const requested = new URL(resource);
    const advertised = new URL(requirements.resource.url);
    const resourceMatches =
      requirements.resource.url === resource ||
      (policy?.resourcePath &&
        requested.pathname === policy.resourcePath &&
        advertised.pathname === policy.resourcePath &&
        requested.origin === advertised.origin &&
        !advertised.search &&
        !advertised.hash &&
        !advertised.username &&
        !advertised.password);
    if (
      !policy ||
      new URL(resource).protocol !== 'https:' ||
      new URL(resource).origin !== policy.origin ||
      !resourceMatches
    )
      throw new Error('MERCHANT_NOT_ALLOWED');
    const matches = (a: z.infer<typeof acceptSchema>) =>
      a.network === policy.network &&
      a.asset.toLowerCase() === policy.asset.toLowerCase() &&
      a.payTo.toLowerCase() === policy.payTo.toLowerCase() &&
      a.amount === policy.tokenAmount &&
      (!policy.tokenName ||
        (a.extra as Record<string, unknown> | undefined)?.name === policy.tokenName) &&
      (!policy.tokenVersion ||
        (a.extra as Record<string, unknown> | undefined)?.version === policy.tokenVersion);
    if (!requirements.accepts.some(matches)) throw new Error('PAYMENT_REQUIREMENTS_NOT_ALLOWED');
    // CLI receive original full envelope, including extensions required by merchant.
    const encoded = Buffer.from(JSON.stringify(requirements)).toString('base64');
    if (encoded.length > 24_000) throw new Error('PAYMENT_REQUIREMENTS_TOO_LARGE_FOR_CLI');
    const result = previewSchema.parse(
      await this.run(['x402-payment', 'preview', '--paymentRequirements', encoded]),
    );
    const option = result.data.options.find(
      (o) =>
        o.status === 'READY_TO_SIGN' &&
        o.needApproveFirst === false &&
        (!policy.transferMethod ||
          (o.assetTransferMethod === policy.transferMethod &&
            o.binanceChainId === policy.network.split(':')[1] &&
            o.tokenAddress?.toLowerCase() === policy.asset.toLowerCase() &&
            o.payTo?.toLowerCase() === policy.payTo.toLowerCase())) &&
        o.originalAccept &&
        matches(o.originalAccept),
    );
    if (!option || !option.amountUsd) throw new Error('NO_SAFE_PAYMENT_OPTION');
    // Validate reference price format, but CMC policy records exact 0.01 USDC
    // nominal budget; do not replace token amount with floating wallet spot rates.
    const estimated = usdCeiling(option.amountUsd);
    const amount = policy.fixedBudgetAmount ?? estimated;
    if (amount <= 0 || amount > policy.maxUsd || amount > service.price)
      throw new Error('REAL_PRICE_EXCEEDS_POLICY');
    return {
      serviceId: service.id,
      resource,
      amount,
      provider: {
        paymentId: result.data.paymentId,
        index: option.index,
        network: policy.network,
        accepted: option.originalAccept!,
      } satisfies PreviewData,
    };
  }
  async authorize(quote: Quote, _payment: Payment): Promise<Authorization> {
    if (!this.enabled) throw new DefinitelyUnpaidError('REAL_PAYMENTS_DISABLED');
    const p = quote.provider as PreviewData;
    const result = signedSchema.parse(
      await this.run([
        'x402-payment',
        'sign',
        '--paymentId',
        p.paymentId,
        '--selectedIndex',
        String(p.index),
      ]),
    );
    // Do not run token approvals automatically. If provider returns approval, hold reserve.
    if (result.data.approveTxHash) throw new Error('UNEXPECTED_APPROVAL_REQUIRES_RECONCILIATION');
    if (result.data.signatureExpiresAt * 1000 <= Date.now()) throw new Error('SIGNATURE_EXPIRED');
    const envelope = completeX402Envelope(result.data.paymentHeaderValue, p.accepted);
    return {
      headers: { [result.data.paymentHeaderName]: envelope.header },
      diagnostic: envelope.diagnostic,
      receiptId: p.paymentId,
      settled: false,
    };
  }
  settlement(response: Response, quote: Quote) {
    const header = response.headers.get('PAYMENT-RESPONSE');
    if (!header || header.length > 16_000) throw new Error('MISSING_SETTLEMENT_PROOF');
    const value = z
      .object({
        success: z.literal(true),
        network: z.string().optional(),
        networkId: z.string().optional(),
        transaction: z.string().optional(),
        txHash: z.string().optional(),
      })
      .parse(JSON.parse(Buffer.from(header, 'base64').toString()));
    const tx = value.transaction || value.txHash;
    const network = value.network || value.networkId;
    if (
      !tx ||
      !/^0x[0-9a-fA-F]{64}$/.test(tx) ||
      (quote.provider as PreviewData).network !== network
    )
      throw new Error('INVALID_SETTLEMENT_PROOF');
    // Settlement receipt reported by merchant; not independent on-chain RPC proof.
    return { receiptId: tx };
  }
}
