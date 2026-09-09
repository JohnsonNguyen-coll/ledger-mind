import type { Payment, Service } from '../types.js';

export interface Quote {
  resource: string;
  serviceId: string;
  amount: number;
  /** Provider data lives only in memory, never exposed to prompt/audit/UI. */
  provider: unknown;
}
export interface Authorization {
  /** Fixed diagnostic code only; never put signatures or wallet data here. */
  diagnostic?: string;
  headers: Record<string, string>;
  receiptId: string;
  settled: boolean;
}
export interface PaymentAdapter {
  readonly mode: 'mock' | 'binance';
  preview(challenge: unknown, service: Service, resource: string): Promise<Quote>;
  authorize(quote: Quote, payment: Payment): Promise<Authorization>;
  settlement(response: Response, quote: Quote): { receiptId: string };
}
/** Only throw when certain that no signature was generated and no side effects occurred.
 * Other errors are treated as ambiguous and reserves transition to unknown without refund. */
export class DefinitelyUnpaidError extends Error {}
