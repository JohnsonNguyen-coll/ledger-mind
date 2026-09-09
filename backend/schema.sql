-- ==========================================================
-- LedgerMind Supabase PostgreSQL Schema
-- Copy and execute this script in Supabase Dashboard -> SQL Editor
-- ==========================================================

CREATE TABLE IF NOT EXISTS treasury_reports (
  id TEXT PRIMARY KEY,
  "walletAddress" TEXT NOT NULL,
  "chainId" INTEGER NOT NULL,
  "createdAt" TEXT NOT NULL,
  summary TEXT NOT NULL,
  report TEXT NOT NULL,
  markdown TEXT NOT NULL,
  "reportHash" TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS browser_purchases (
  id TEXT PRIMARY KEY,
  "reportId" TEXT NOT NULL,
  payer TEXT NOT NULL,
  symbol TEXT NOT NULL,
  status TEXT NOT NULL,
  quote TEXT NOT NULL,
  result TEXT,
  "createdAt" TEXT NOT NULL,
  "submittedAt" TEXT,
  UNIQUE("reportId", payer, symbol)
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  "requestKey" TEXT NOT NULL UNIQUE,
  prompt TEXT NOT NULL,
  symbol TEXT NOT NULL,
  budget INTEGER NOT NULL CHECK(budget >= 0),
  status TEXT NOT NULL,
  "createdAt" TEXT NOT NULL,
  result TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  "taskId" TEXT NOT NULL REFERENCES tasks(id),
  "serviceId" TEXT NOT NULL,
  resource TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK(amount > 0),
  state TEXT NOT NULL,
  day TEXT NOT NULL,
  "receiptId" TEXT,
  data TEXT,
  UNIQUE("taskId", "serviceId", resource)
);

CREATE TABLE IF NOT EXISTS audit (
  seq BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "taskId" TEXT,
  type TEXT NOT NULL,
  detail TEXT NOT NULL,
  at TEXT NOT NULL,
  "prevHash" TEXT NOT NULL,
  hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS web_sessions (
  id TEXT PRIMARY KEY,
  "tokenHash" TEXT NOT NULL UNIQUE,
  wallet TEXT,
  "expiresAt" BIGINT NOT NULL,
  nonce TEXT,
  message TEXT,
  "nonceExpiresAt" BIGINT
);

CREATE TABLE IF NOT EXISTS report_owners (
  "reportId" TEXT PRIMARY KEY,
  "sessionId" TEXT NOT NULL,
  wallet TEXT
);
CREATE INDEX IF NOT EXISTS idx_report_owners_wallet ON report_owners(wallet);

ALTER TABLE treasury_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE browser_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE web_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_owners ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'service_role_all_treasury_reports') THEN
    CREATE POLICY service_role_all_treasury_reports ON treasury_reports FOR ALL USING (auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'service_role_all_browser_purchases') THEN
    CREATE POLICY service_role_all_browser_purchases ON browser_purchases FOR ALL USING (auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'service_role_all_tasks') THEN
    CREATE POLICY service_role_all_tasks ON tasks FOR ALL USING (auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'service_role_all_payments') THEN
    CREATE POLICY service_role_all_payments ON payments FOR ALL USING (auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'service_role_all_audit') THEN
    CREATE POLICY service_role_all_audit ON audit FOR ALL USING (auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'service_role_all_web_sessions') THEN
    CREATE POLICY service_role_all_web_sessions ON web_sessions FOR ALL USING (auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'service_role_all_report_owners') THEN
    CREATE POLICY service_role_all_report_owners ON report_owners FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;
