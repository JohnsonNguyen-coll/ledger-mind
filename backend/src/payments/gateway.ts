import { z } from 'zod';
import type { DataResult, Service, Task } from '../types.js';
import { Store } from '../store.js';
import { DefinitelyUnpaidError, type PaymentAdapter } from './adapter.js';
import { cmcData, cmcResource } from '../services/cmc.js';
import { merchantErrorCategory } from './merchant-error.js';

export const dataSchema = z.object({
  source: z.string().max(200),
  fixture: z.boolean(),
  symbol: z.string().regex(/^[A-Z0-9]{1,30}$/),
  summary: z.string().max(4000),
  metrics: z.record(z.string(), z.union([z.string().max(500), z.number().finite()])),
  observedAt: z.string().datetime(),
});
export async function boundedJson(response: Response, maxBytes = 256_000): Promise<unknown> {
  // Giới hạn cả response không có Content-Length / dùng chunked transfer.
  if (!response.body) throw new Error('EMPTY_RESPONSE');
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw new Error('RESPONSE_TOO_LARGE');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString());
  } finally {
    await reader.cancel();
  }
}

export class PaymentGateway {
  private inflight = new Map<string, Promise<DataResult>>();
  constructor(
    private store: Store,
    private adapter: PaymentAdapter,
    private fetcher: typeof fetch = fetch,
    private delayBeforeSubmissionMs = 0,
  ) {}
  purchase(task: Task, service: Service): Promise<DataResult> {
    const resource =
      service.id === 'cmc_quote'
        ? cmcResource(task.symbol)
        : `${service.baseUrl}/data/${task.symbol}`;
    const key = `${task.id}:${service.id}:${resource}`;
    const running = this.inflight.get(key);
    if (running) return running;
    const promise = this.execute(task, service, resource).finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }
  private async request(url: string, headers: Record<string, string> = {}) {
    return this.fetcher(url, { headers, redirect: 'error', signal: AbortSignal.timeout(30_000) });
  }
  private async execute(task: Task, service: Service, resource: string): Promise<DataResult> {
    const parseData = (raw: unknown) =>
      dataSchema.parse(service.id === 'cmc_quote' ? cmcData(raw, task.symbol) : raw);
    const old = this.store
      .payments(task.id)
      .find((p) => p.serviceId === service.id && p.resource === resource);
    if (old) {
      if (old.state === 'settled' && old.data) {
        this.store.event(task.id, 'data.cached', { serviceId: service.id });
        return dataSchema.parse(JSON.parse(old.data));
      }
      throw new Error(
        old.state === 'settled' ? 'PAID_DATA_UNAVAILABLE_NO_RECHARGE' : 'PAYMENT_ALREADY_ATTEMPTED',
      );
    }
    const initial = await this.request(resource);
    if (initial.ok) {
      const data = parseData(await boundedJson(initial));
      if (data.symbol !== task.symbol) throw new Error('DATA_SYMBOL_MISMATCH');
      this.store.event(task.id, 'data.free', { serviceId: service.id });
      return data;
    }
    if (initial.status !== 402) throw new Error(`SERVICE_HTTP_${initial.status}`);
    this.store.event(task.id, 'payment.required', { serviceId: service.id, httpStatus: 402 });
    const header = initial.headers.get('PAYMENT-REQUIRED');
    let challenge: unknown;
    if (header) {
      await initial.body?.cancel();
      if (header.length > 24_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(header))
        throw new Error('INVALID_PAYMENT_REQUIRED');
      challenge = JSON.parse(Buffer.from(header, 'base64').toString());
    } else challenge = await boundedJson(initial);
    const quote = await this.adapter.preview(challenge, service, resource);
    this.store.event(task.id, 'payment.previewed', {
      serviceId: service.id,
      amount: quote.amount,
      mode: this.adapter.mode,
      ...(service.id === 'cmc_quote'
        ? { token: 'USDC', tokenAmount: '0.01', network: 'eip155:8453', accounting: 'USDC_NOMINAL' }
        : {}),
    });
    let payment;
    try {
      payment = this.store.reserve(task.id, service.id, resource, quote.amount);
    } catch (error) {
      this.store.event(task.id, 'payment.blocked', {
        serviceId: service.id,
        reason: (error as Error).message,
      });
      throw error;
    }
    let settled = false;
    try {
      this.store.event(task.id, 'payment.authorizing', { serviceId: service.id });
      const authorization = await this.adapter.authorize(quote, payment);
      this.store.event(task.id, 'payment.authorized', { serviceId: service.id, envelope: authorization.diagnostic });
      if (authorization.settled) {
        this.store.transition(payment.id, 'settled', authorization.receiptId);
        settled = true;
      }
      if (this.delayBeforeSubmissionMs > 0 && service.id === 'cmc_quote') {
        await new Promise((resolve) => setTimeout(resolve, this.delayBeforeSubmissionMs));
      }
      // Một replay duy nhất. Không tự sign lại khi mạng lỗi hoặc merchant trả 402.
      const response = await this.request(resource, authorization.headers);
      this.store.event(task.id, 'payment.merchant_response', {
        serviceId: service.id, httpStatus: response.status,
        hasSettlementReceipt: response.headers.has('PAYMENT-RESPONSE'),
      });
      // A second 402 is a merchant rejection, not a successful response missing
      // a receipt. Keep the uncertain reservation; do not sign or send it again.
      if (!settled && !response.ok && !response.headers.has('PAYMENT-RESPONSE')) {
        let category = 'UNREADABLE_RESPONSE';
        try { category = merchantErrorCategory(await boundedJson(response)); } catch { /* No raw body in audit. */ }
        this.store.event(task.id, 'payment.merchant_rejected', {
          serviceId: service.id, httpStatus: response.status, category,
        });
        throw new Error(response.status === 402 ? 'MERCHANT_PAYMENT_REJECTED_402' : `MERCHANT_HTTP_${response.status}_SETTLEMENT_UNCONFIRMED`);
      }
      if (!authorization.settled) {
        const receipt = this.adapter.settlement(response, quote);
        this.store.transition(payment.id, 'settled', receipt.receiptId);
        settled = true;
      }
      if (!response.ok) throw new Error(`PAID_SERVICE_HTTP_${response.status}`);
      const data = parseData(await boundedJson(response));
      if (data.symbol !== task.symbol) throw new Error('DATA_SYMBOL_MISMATCH');
      this.store.saveData(payment.id, data);
      this.store.event(task.id, 'data.received', {
        serviceId: service.id,
        source: data.source,
        fixture: data.fixture,
      });
      return data;
    } catch (error) {
      if (!settled)
        this.store.transition(
          payment.id,
          error instanceof DefinitelyUnpaidError ? 'released' : 'unknown',
        );
      this.store.event(task.id, 'payment.delivery_failed', {
        serviceId: service.id,
        charged: settled ? true : error instanceof DefinitelyUnpaidError ? false : null,
        settlementStatus: settled ? 'settled' : error instanceof DefinitelyUnpaidError ? 'unpaid' : 'unconfirmed',
      });
      throw error;
    }
  }
}
