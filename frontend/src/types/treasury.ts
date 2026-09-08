export type SourceStatus =
  | 'verified'
  | 'partial'
  | 'unavailable'
  | 'not configured'
  | 'not requested'
  | 'approval required'
  | 'available via task flow';

export interface TreasuryAsset {
  symbol: string;
  balance: number;
  priceUsd: number | null;
  valueUsd: number;
  stable: boolean;
  source: string;
}

export interface TreasuryRisk {
  level: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
}

export interface TreasuryTransaction {
  hash: string;
  time: string;
  direction: string;
  asset: string;
  amount: number;
  valueUsd: number;
  counterparty: string;
}

export interface TreasuryResult {
  reportId: string;
  reportHash: string;
  markdownReport: string;
  observedAt: string;
  walletAddress: string;
  chain: { name: string; nativeSymbol: string };
  assets: TreasuryAsset[];
  transactions: TreasuryTransaction[];
  metrics: {
    totalValueUsd: number;
    stableValueUsd: number;
    netFlowUsd: number;
    burnMonthlyUsd: number;
    runwayMonths: number | null;
    concentrationPct: number;
    riskScore: string;
  };
  risks: TreasuryRisk[];
  dataSources: Array<{ name: string; status: SourceStatus }>;
  brief: string;
  workflowDraft: string;
  premiumData: {
    requested: boolean;
    status: string;
    taskId: string | null;
    note: string;
  };
}

export interface ReportSummary {
  id: string;
  walletAddress: string;
  chainId: number;
  createdAt: string;
  summary: string;
}

export interface AuditEvent {
  type: string;
  at: string;
  detail: string;
}
