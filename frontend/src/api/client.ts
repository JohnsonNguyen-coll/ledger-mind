import type { TreasuryResult, ReportSummary, AuditEvent } from '../types/treasury.js';

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String((json as { error?: string }).error ?? response.statusText));
  return json as T;
}

export async function analyzeTreasury(params: {
  walletAddress: string;
  chainId: number;
  timeframeDays: number;
  usePremiumData: boolean;
  authorizePremiumPayment: boolean;
}): Promise<TreasuryResult> {
  return api<TreasuryResult>('/api/treasury/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

export async function fetchReports(): Promise<{ reports: ReportSummary[] }> {
  return api<{ reports: ReportSummary[] }>('/api/reports');
}

export async function fetchReportById(id: string): Promise<{ report: TreasuryResult }> {
  return api<{ report: TreasuryResult }>(`/api/reports/${id}`);
}

export async function fetchAuditLog(reportId: string): Promise<{ integrityValid: boolean; events: AuditEvent[] }> {
  return api<{ integrityValid: boolean; events: AuditEvent[] }>(`/api/reports/${reportId}/audit`);
}

export async function askAgentQuestion(reportId: string, question: string): Promise<{ answer: string }> {
  return api<{ answer: string }>('/api/agent/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reportId, question }),
  });
}
