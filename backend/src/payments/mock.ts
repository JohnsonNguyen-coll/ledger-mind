import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Payment, Service } from '../types.js';
import type { PaymentAdapter, Quote, Authorization } from './adapter.js';

export const mockChallenge = z.object({
  protocol: z.literal('ledgermind-mock-v1'),
  serviceId: z.string(),
  resource: z.string().url(),
  amount: z.number().int().positive(),
  currency: z.literal('DEMO_USD'),
  expiresAt: z.number().int(),
});
const receiptSchema = z.object({
  paymentId: z.string().uuid(),
  taskId: z.string().uuid(),
  resource: z.string(),
  serviceId: z.string(),
  amount: z.number().int().positive(),
  expiresAt: z.number(),
});
export function signReceipt(value: z.infer<typeof receiptSchema>, secret: string) {
  const body = Buffer.from(JSON.stringify(value)).toString('base64url');
  return body + '.' + createHmac('sha256', secret).update(body).digest('base64url');
}
export function verifyReceipt(token: string, secret: string) {
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra) throw new Error('INVALID_RECEIPT');
  const wanted = createHmac('sha256', secret).update(body).digest();
  const received = Buffer.from(signature, 'base64url');
  if (received.length !== wanted.length || !timingSafeEqual(received, wanted))
    throw new Error('INVALID_RECEIPT');
  const receipt = receiptSchema.parse(JSON.parse(Buffer.from(body, 'base64url').toString()));
  if (receipt.expiresAt <= Date.now()) throw new Error('RECEIPT_EXPIRED');
  return receipt;
}
/** HMAC receipt is for local demo verification, NOT an on-chain x402 signature. */
export class MockPaymentAdapter implements PaymentAdapter {
  readonly mode = 'mock' as const;
  constructor(private readonly secret: string) {}
  async preview(challenge: unknown, service: Service, resource: string): Promise<Quote> {
    const c = mockChallenge.parse(challenge);
    if (
      c.resource !== resource ||
      c.serviceId !== service.id ||
      c.amount !== service.price ||
      c.expiresAt <= Date.now()
    )
      throw new Error('QUOTE_MISMATCH');
    return { resource, serviceId: service.id, amount: c.amount, provider: c };
  }
  async authorize(quote: Quote, payment: Payment): Promise<Authorization> {
    const receiptId = `mock:${payment.id}`;
    const token = signReceipt(
      {
        paymentId: payment.id,
        taskId: payment.taskId,
        resource: quote.resource,
        serviceId: quote.serviceId,
        amount: quote.amount,
        expiresAt: Date.now() + 300_000,
      },
      this.secret,
    );
    return {
      headers: { 'X-LedgerMind-Receipt': token, 'X-LedgerMind-Task': payment.taskId },
      receiptId,
      settled: true,
    };
  }
  settlement(): { receiptId: string } {
    throw new Error('MOCK_ALREADY_SETTLED');
  }
}
