import type { Payment, Service } from '../types.js';

export interface Quote {
  resource: string;
  serviceId: string;
  amount: number;
  /** Dữ liệu của provider chỉ sống trong memory, không gửi vào prompt/audit/UI. */
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
/** Chỉ dùng khi chắc chắn chưa tạo chữ ký/chưa có side effect. Các lỗi khác
 * được coi là ambiguous và khoản reserve chuyển sang unknown, không refund. */
export class DefinitelyUnpaidError extends Error {}
