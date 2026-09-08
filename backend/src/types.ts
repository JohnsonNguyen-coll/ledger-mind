export type MockServiceId = 'whale' | 'sentiment' | 'risk';
export type ServiceId = MockServiceId | 'cmc_quote';
export type Symbol = string;
export interface Task {
  id: string;
  requestKey: string;
  prompt: string;
  symbol: Symbol;
  budget: number;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  createdAt: string;
  result: string | null;
  error: string | null;
}
export interface Payment {
  id: string;
  taskId: string;
  serviceId: string;
  resource: string;
  amount: number;
  state: 'reserved' | 'settled' | 'released' | 'unknown';
  day: string;
  receiptId: string | null;
  data: string | null;
}
export interface AuditEvent {
  seq: number;
  taskId: string | null;
  type: string;
  detail: string;
  at: string;
  prevHash: string;
  hash: string;
}
export interface Service {
  id: ServiceId;
  title: string;
  description: string;
  price: number;
  baseUrl: string;
  protocol: 'mock' | 'x402';
}
export interface DataResult {
  source: string;
  fixture: boolean;
  symbol: Symbol;
  summary: string;
  metrics: Record<string, string | number>;
  observedAt: string;
}
