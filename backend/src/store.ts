import { createHash, randomUUID } from 'node:crypto';
import { positive } from './money.js';
import type { AuditEvent, Payment, Symbol, Task } from './types.js';

export interface Limits {
  wallet: number;
  maxPayment: number;
  dailyBudget: number;
}

export interface SupabaseConfig {
  url: string;
  key: string;
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex');

export class InMemoryDb {
  readonly tasks = new Map<string, any>();
  readonly payments = new Map<string, any>();
  readonly audit: any[] = [];
  readonly treasuryReports = new Map<string, any>();
  readonly browserPurchases = new Map<string, any>();
  readonly webSessions = new Map<string, any>();
  readonly reportOwners = new Map<string, any>();

  constructor(private sync?: (table: string, payload: unknown) => Promise<void>) {}

  exec(sql: string) {
    if (sql.includes("UPDATE browser_purchases SET status='unknown' WHERE status='submitting'")) {
      for (const b of this.browserPurchases.values()) {
        if (b.status === 'submitting') b.status = 'unknown';
      }
    }
    if (sql.includes("'global'")) {
      if (!this.treasuryReports.has('global')) {
        this.treasuryReports.set('global', {
          id: 'global',
          walletAddress: '0x0000000000000000000000000000000000000000',
          chainId: 8453,
          createdAt: new Date().toISOString(),
          summary: 'Global Market Snapshot',
          report: '{}',
          markdown: '',
          reportHash: 'global',
        });
      }
    }
  }

  prepare(sql: string) {
    const s = sql.trim().replace(/\s+/g, ' ');

    return {
      run: (...args: any[]) => {
        // --- TASKS ---
        if (s.startsWith('INSERT INTO tasks')) {
          const [id, requestKey, prompt, symbol, budget, status, createdAt, result, error] = args;
          const row = { id, requestKey, prompt, symbol, budget, status, createdAt, result: result ?? null, error: error ?? null };
          this.tasks.set(id, row);
          void this.sync?.('tasks', row);
          return { changes: 1 };
        }
        if (s.startsWith('UPDATE tasks SET status=?,result=?,error=? WHERE id=?')) {
          const [status, result, error, id] = args;
          const row = this.tasks.get(id);
          if (row) {
            row.status = status; row.result = result; row.error = error;
            void this.sync?.('tasks', row);
          }
          return { changes: row ? 1 : 0 };
        }
        if (s.includes("UPDATE tasks SET status='interrupted',error='PROCESS_RESTART' WHERE status='running'")) {
          let changes = 0;
          for (const row of this.tasks.values()) {
            if (row.status === 'running') {
              row.status = 'interrupted';
              row.error = 'PROCESS_RESTART';
              changes++;
              void this.sync?.('tasks', row);
            }
          }
          return { changes };
        }

        // --- PAYMENTS ---
        if (s.startsWith('INSERT INTO payments')) {
          const [id, taskId, serviceId, resource, amount, state, day, receiptId, data] = args;
          const row = { id, taskId, serviceId, resource, amount, state, day, receiptId: receiptId ?? null, data: data ?? null };
          this.payments.set(id, row);
          void this.sync?.('payments', row);
          return { changes: 1 };
        }
        if (s.startsWith('UPDATE payments SET state=?, receiptId=?, day=? WHERE id=?')) {
          const [state, receiptId, day, id] = args;
          const row = this.payments.get(id);
          if (row) {
            row.state = state; row.receiptId = receiptId; row.day = day;
            void this.sync?.('payments', row);
          }
          return { changes: row ? 1 : 0 };
        }
        if (s.startsWith("UPDATE payments SET data=? WHERE id=? AND state='settled'")) {
          const [data, id] = args;
          const row = this.payments.get(id);
          if (row && row.state === 'settled') {
            row.data = data;
            void this.sync?.('payments', row);
          }
          return { changes: row ? 1 : 0 };
        }
        if (s.includes("UPDATE payments SET state='unknown' WHERE id=?")) {
          const [id] = args;
          const row = this.payments.get(id);
          if (row) {
            row.state = 'unknown';
            void this.sync?.('payments', row);
          }
          return { changes: row ? 1 : 0 };
        }

        // --- AUDIT ---
        if (s.startsWith('INSERT INTO audit')) {
          const [taskId, type, detail, at, prevHash, h] = args;
          const seq = this.audit.length + 1;
          const row = { seq, taskId, type, detail, at, prevHash, hash: h };
          this.audit.push(row);
          void this.sync?.('audit', row);
          return { changes: 1 };
        }

        // --- TREASURY REPORTS ---
        if (s.startsWith('INSERT INTO treasury_reports') || s.startsWith('INSERT OR IGNORE INTO treasury_reports')) {
          const [id, walletAddress, chainId, createdAt, summary, report, markdown, reportHash] = args;
          const row = { id, walletAddress, chainId, createdAt, summary, report, markdown, reportHash };
          this.treasuryReports.set(id, row);
          void this.sync?.('treasury_reports', row);
          return { changes: 1 };
        }

        // --- BROWSER PURCHASES ---
        if (s.startsWith('INSERT INTO browser_purchases') || s.startsWith('INSERT OR IGNORE INTO browser_purchases')) {
          const [id, reportId, payer, symbol, status, quote, resultOrCreatedAt, maybeCreatedAt, maybeSubmittedAt] = args;
          let result: string | null = null;
          let createdAt: string;
          let submittedAt: string | null = null;
          if (s.includes('result,createdAt,submittedAt') || s.includes('result,createdAt')) {
            result = resultOrCreatedAt;
            createdAt = maybeCreatedAt;
            submittedAt = maybeSubmittedAt ?? null;
          } else {
            createdAt = resultOrCreatedAt;
          }
          const row = { id, reportId, payer, symbol, status, quote, result, createdAt, submittedAt };
          this.browserPurchases.set(id, row);
          void this.sync?.('browser_purchases', row);
          return { changes: 1 };
        }
        if (s.includes("DELETE FROM browser_purchases WHERE id=? AND status='quoted'")) {
          const [id] = args;
          const existing = this.browserPurchases.get(id);
          if (existing && existing.status === 'quoted') {
            this.browserPurchases.delete(id);
            return { changes: 1 };
          }
          return { changes: 0 };
        }
        if (s.includes("UPDATE browser_purchases SET status='submitting',submittedAt=? WHERE id=? AND status='quoted'")) {
          const [submittedAt, id] = args;
          const row = this.browserPurchases.get(id);
          if (row && row.status === 'quoted') {
            row.status = 'submitting';
            row.submittedAt = submittedAt;
            void this.sync?.('browser_purchases', row);
            return { changes: 1 };
          }
          return { changes: 0 };
        }
        if (s.includes("UPDATE browser_purchases SET status='submitting' WHERE id=?")) {
          const [id] = args;
          const row = this.browserPurchases.get(id);
          if (row) {
            row.status = 'submitting';
            void this.sync?.('browser_purchases', row);
            return { changes: 1 };
          }
          return { changes: 0 };
        }
        if (s.includes("UPDATE browser_purchases SET status='paid_data_unavailable',result=? WHERE id=?")) {
          const [result, id] = args;
          const row = this.browserPurchases.get(id);
          if (row) {
            row.status = 'paid_data_unavailable';
            row.result = result;
            void this.sync?.('browser_purchases', row);
            return { changes: 1 };
          }
          return { changes: 0 };
        }
        if (s.includes("UPDATE browser_purchases SET status='settled',result=? WHERE id=?")) {
          const [result, id] = args;
          const row = this.browserPurchases.get(id);
          if (row) {
            row.status = 'settled';
            row.result = result;
            void this.sync?.('browser_purchases', row);
            return { changes: 1 };
          }
          return { changes: 0 };
        }
        if (s.includes("UPDATE browser_purchases SET status='unknown',result=? WHERE id=?")) {
          const [result, id] = args;
          const row = this.browserPurchases.get(id);
          if (row) {
            row.status = 'unknown';
            row.result = result;
            void this.sync?.('browser_purchases', row);
            return { changes: 1 };
          }
          return { changes: 0 };
        }
        if (s.startsWith('UPDATE browser_purchases SET status=?,result=? WHERE id=?')) {
          const [status, result, id] = args;
          const row = this.browserPurchases.get(id);
          if (row) {
            row.status = status;
            row.result = result;
            void this.sync?.('browser_purchases', row);
            return { changes: 1 };
          }
          return { changes: 0 };
        }
        if (s.startsWith('UPDATE browser_purchases SET quote=? WHERE id=?')) {
          const [quote, id] = args;
          const row = this.browserPurchases.get(id);
          if (row) {
            row.quote = quote;
            void this.sync?.('browser_purchases', row);
            return { changes: 1 };
          }
          return { changes: 0 };
        }

        // --- WEB SESSIONS ---
        if (s.startsWith('INSERT INTO web_sessions(id,tokenHash,expiresAt) VALUES (?,?,?)')) {
          const [id, tokenHash, expiresAt] = args;
          const row = { id, tokenHash, wallet: null, expiresAt, nonce: null, message: null, nonceExpiresAt: null };
          this.webSessions.set(id, row);
          void this.sync?.('web_sessions', row);
          return { changes: 1 };
        }
        if (s.startsWith('UPDATE web_sessions SET nonce=?,message=?,nonceExpiresAt=? WHERE id=?')) {
          const [nonce, message, nonceExpiresAt, id] = args;
          const row = this.webSessions.get(id);
          if (row) {
            row.nonce = nonce; row.message = message; row.nonceExpiresAt = nonceExpiresAt;
            void this.sync?.('web_sessions', row);
            return { changes: 1 };
          }
          return { changes: 0 };
        }
        if (s.includes('UPDATE web_sessions SET nonce=NULL,message=NULL,nonceExpiresAt=NULL WHERE id=? AND nonce=?')) {
          const [id, nonce] = args;
          const row = this.webSessions.get(id);
          if (row && row.nonce === nonce) {
            row.nonce = null; row.message = null; row.nonceExpiresAt = null;
            void this.sync?.('web_sessions', row);
            return { changes: 1 };
          }
          return { changes: 0 };
        }
        if (s.startsWith('UPDATE web_sessions SET wallet=?,tokenHash=?,expiresAt=? WHERE id=?')) {
          const [wallet, tokenHash, expiresAt, id] = args;
          const row = this.webSessions.get(id);
          if (row) {
            row.wallet = wallet; row.tokenHash = tokenHash; row.expiresAt = expiresAt;
            void this.sync?.('web_sessions', row);
            return { changes: 1 };
          }
          return { changes: 0 };
        }
        if (s.startsWith('UPDATE web_sessions SET tokenHash=?,nonce=NULL,message=NULL,nonceExpiresAt=NULL WHERE id=?')) {
          const [tokenHash, id] = args;
          const row = this.webSessions.get(id);
          if (row) {
            row.tokenHash = tokenHash; row.nonce = null; row.message = null; row.nonceExpiresAt = null;
            void this.sync?.('web_sessions', row);
            return { changes: 1 };
          }
          return { changes: 0 };
        }

        // --- REPORT OWNERS ---
        if (s.startsWith('INSERT INTO report_owners')) {
          const [reportId, sessionId, maybeWallet] = args;
          const row = { reportId, sessionId, wallet: maybeWallet ?? null };
          this.reportOwners.set(reportId, row);
          void this.sync?.('report_owners', row);
          return { changes: 1 };
        }
        if (s.startsWith('UPDATE report_owners SET wallet=? WHERE sessionId=? AND wallet IS NULL')) {
          const [wallet, sessionId] = args;
          let changes = 0;
          for (const row of this.reportOwners.values()) {
            if (row.sessionId === sessionId && row.wallet === null) {
              row.wallet = wallet;
              changes++;
              void this.sync?.('report_owners', row);
            }
          }
          return { changes };
        }

        return { changes: 0 };
      },

      get: (...args: any[]) => {
        // --- TASKS ---
        if (s === 'SELECT * FROM tasks WHERE requestKey=?') {
          const [requestKey] = args;
          for (const t of this.tasks.values()) {
            if (t.requestKey === requestKey) return { ...t };
          }
          return undefined;
        }
        if (s === 'SELECT * FROM tasks WHERE id=?') {
          const [id] = args;
          const t = this.tasks.get(id);
          return t ? { ...t } : undefined;
        }

        // --- PAYMENTS ---
        if (s === 'SELECT * FROM payments WHERE id=?') {
          const [id] = args;
          const p = this.payments.get(id);
          return p ? { ...p } : undefined;
        }

        // --- AUDIT ---
        if (s.includes('SELECT hash FROM audit ORDER BY seq DESC LIMIT 1')) {
          const last = this.audit[this.audit.length - 1];
          return last ? { hash: last.hash } : undefined;
        }

        // --- TREASURY REPORTS ---
        if (s === 'SELECT * FROM treasury_reports WHERE id=?') {
          const [id] = args;
          const r = this.treasuryReports.get(id);
          return r ? { ...r } : undefined;
        }

        // --- BROWSER PURCHASES ---
        if (s === 'SELECT * FROM browser_purchases WHERE id=?') {
          const [id] = args;
          const b = this.browserPurchases.get(id);
          return b ? { ...b } : undefined;
        }
        if (s.includes("SELECT COUNT(*) AS n FROM browser_purchases WHERE payer=? AND status IN ('submitting','settled','paid_data_unavailable','unknown') AND submittedAt>=?")) {
          const [payer, submittedAtThreshold] = args;
          const validStatuses = new Set(['submitting', 'settled', 'paid_data_unavailable', 'unknown']);
          let count = 0;
          for (const b of this.browserPurchases.values()) {
            if (b.payer === payer && validStatuses.has(b.status) && b.submittedAt && b.submittedAt >= submittedAtThreshold) {
              count++;
            }
          }
          return { n: count };
        }
        if (s === 'SELECT * FROM browser_purchases WHERE reportId=? AND payer=? AND symbol=?') {
          const [reportId, payer, symbol] = args;
          for (const b of this.browserPurchases.values()) {
            if (b.reportId === reportId && b.payer === payer && b.symbol === symbol) return { ...b };
          }
          return undefined;
        }

        // --- WEB SESSIONS ---
        if (s.startsWith('SELECT * FROM web_sessions WHERE tokenHash=? AND expiresAt>?')) {
          const [tokenHash, nowTime] = args;
          for (const w of this.webSessions.values()) {
            if (w.tokenHash === tokenHash && w.expiresAt > nowTime) return { ...w };
          }
          return undefined;
        }
        if (s.includes('FROM web_sessions WHERE tokenHash=?')) {
          const [tokenHash] = args;
          for (const w of this.webSessions.values()) {
            if (w.tokenHash === tokenHash) return { ...w };
          }
          return undefined;
        }
        if (s === 'SELECT wallet FROM web_sessions WHERE id=?') {
          const [id] = args;
          const w = this.webSessions.get(id);
          return w ? { wallet: w.wallet } : undefined;
        }
        if (s === 'SELECT * FROM web_sessions WHERE id=?') {
          const [id] = args;
          const w = this.webSessions.get(id);
          return w ? { ...w } : undefined;
        }
        if (s === 'SELECT tokenHash FROM web_sessions WHERE id=?') {
          const [id] = args;
          const w = this.webSessions.get(id);
          return w ? { tokenHash: w.tokenHash } : undefined;
        }

        // --- REPORT OWNERS ---
        if (s === 'SELECT * FROM report_owners WHERE reportId=?') {
          const [reportId] = args;
          const o = this.reportOwners.get(reportId);
          return o ? { ...o } : undefined;
        }
        if (s.includes('SELECT COUNT(*) AS total FROM treasury_reports r JOIN report_owners o')) {
          const [sessionId, wallet] = args;
          let count = 0;
          for (const r of this.treasuryReports.values()) {
            const o = this.reportOwners.get(r.id);
            if (o && ((o.wallet === null && o.sessionId === sessionId) || (o.wallet !== null && o.wallet === wallet))) {
              count++;
            }
          }
          return { total: count };
        }

        return undefined;
      },

      all: (...args: any[]) => {
        // --- TASKS ---
        if (s.includes('SELECT * FROM tasks ORDER BY rowid DESC LIMIT 100') || s.includes('SELECT * FROM tasks')) {
          return Array.from(this.tasks.values())
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, 100);
        }

        // --- PAYMENTS ---
        if (s === 'SELECT * FROM payments WHERE taskId=?') {
          const [taskId] = args;
          return Array.from(this.payments.values()).filter((p) => p.taskId === taskId);
        }
        if (s.startsWith('SELECT * FROM payments')) {
          return Array.from(this.payments.values());
        }

        // --- AUDIT ---
        if (s === 'SELECT * FROM audit WHERE taskId=? ORDER BY seq') {
          const [taskId] = args;
          return this.audit.filter((e) => e.taskId === taskId);
        }
        if (s.startsWith('SELECT * FROM audit')) {
          return [...this.audit];
        }

        // --- TREASURY REPORTS ---
        if (s.includes('SELECT id,walletAddress,chainId,createdAt,summary,reportHash FROM treasury_reports ORDER BY rowid DESC LIMIT 20')) {
          return Array.from(this.treasuryReports.values())
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, 20)
            .map(({ id, walletAddress, chainId, createdAt, summary, reportHash }) => ({
              id, walletAddress, chainId, createdAt, summary, reportHash,
            }));
        }
        if (s.includes('SELECT r.id,r.walletAddress,r.chainId,r.createdAt,r.summary,r.reportHash FROM treasury_reports r JOIN report_owners o')) {
          const [sessionId, wallet, limit, offset] = args;
          const matched: any[] = [];
          for (const r of this.treasuryReports.values()) {
            const o = this.reportOwners.get(r.id);
            if (o && ((o.wallet === null && o.sessionId === sessionId) || (o.wallet !== null && o.wallet === wallet))) {
              matched.push(r);
            }
          }
          matched.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          return matched.slice(offset, offset + limit).map(({ id, walletAddress, chainId, createdAt, summary, reportHash }) => ({
            id, walletAddress, chainId, createdAt, summary, reportHash,
          }));
        }

        // --- BROWSER PURCHASES ---
        if (s === 'SELECT * FROM browser_purchases WHERE reportId=? AND payer=? ORDER BY createdAt DESC') {
          const [reportId, payer] = args;
          return Array.from(this.browserPurchases.values())
            .filter((b) => b.reportId === reportId && b.payer === payer)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        }
        if (s === 'SELECT * FROM browser_purchases WHERE payer=? ORDER BY createdAt DESC') {
          const [payer] = args;
          return Array.from(this.browserPurchases.values())
            .filter((b) => b.payer === payer)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        }

        return [];
      },
    };
  }
}

export class Store {
  readonly db: InMemoryDb;
  readonly limits: Limits;
  readonly now: () => Date;
  readonly supabase?: SupabaseConfig;

  constructor(
    limitsOrPath: Limits | string,
    limitsOrNow?: Limits | (() => Date),
    nowOrSupabase?: (() => Date) | SupabaseConfig,
    supabaseConfig?: SupabaseConfig,
  ) {
    let resolvedLimits: Limits;
    let resolvedNow: () => Date = () => new Date();
    let resolvedSupabase: SupabaseConfig | undefined;

    if (typeof limitsOrPath === 'string') {
      resolvedLimits = limitsOrNow as Limits;
      if (typeof nowOrSupabase === 'function') resolvedNow = nowOrSupabase;
      if (supabaseConfig) resolvedSupabase = supabaseConfig;
      else if (nowOrSupabase && typeof nowOrSupabase === 'object') resolvedSupabase = nowOrSupabase as SupabaseConfig;
    } else {
      resolvedLimits = limitsOrPath;
      if (typeof limitsOrNow === 'function') resolvedNow = limitsOrNow;
      if (nowOrSupabase && typeof nowOrSupabase === 'object') resolvedSupabase = nowOrSupabase as SupabaseConfig;
    }

    if (!resolvedLimits) throw new Error('INVALID_LIMIT');
    for (const amount of Object.values(resolvedLimits)) {
      if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('INVALID_LIMIT');
    }

    this.limits = resolvedLimits;
    this.now = resolvedNow;
    this.supabase = resolvedSupabase?.url && resolvedSupabase?.key
      ? {
          url: resolvedSupabase.url.replace(/\/+$/, ''),
          key: resolvedSupabase.key,
        }
      : undefined;

    this.db = new InMemoryDb((table, payload) => this.syncToSupabase(table, payload));
  }

  async syncToSupabase(table: string, payload: unknown): Promise<void> {
    if (!this.supabase) return;
    try {
      const res = await fetch(`${this.supabase.url}/rest/v1/${table}`, {
        method: 'POST',
        headers: {
          apikey: this.supabase.key,
          Authorization: `Bearer ${this.supabase.key}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.error(`[Supabase Sync Error] Table "${table}" HTTP ${res.status}:`, errText);
      } else {
        console.log(`[Supabase] Synced record to "${table}" successfully.`);
      }
    } catch (err: any) {
      console.error(`[Supabase Network Error] Table "${table}":`, err?.message || err);
    }
  }

  async pullFromSupabase(): Promise<void> {
    if (!this.supabase) return;
    try {
      const headers = {
        apikey: this.supabase.key,
        Authorization: `Bearer ${this.supabase.key}`,
      };

      const [reportsRes, purchasesRes, ownersRes, tasksRes, paymentsRes] = await Promise.all([
        fetch(`${this.supabase.url}/rest/v1/treasury_reports?select=*&order=createdAt.desc&limit=100`, {
          headers,
          signal: AbortSignal.timeout(5000),
        }),
        fetch(`${this.supabase.url}/rest/v1/browser_purchases?select=*&order=createdAt.desc&limit=100`, {
          headers,
          signal: AbortSignal.timeout(5000),
        }),
        fetch(`${this.supabase.url}/rest/v1/report_owners?select=*&limit=500`, {
          headers,
          signal: AbortSignal.timeout(5000),
        }),
        fetch(`${this.supabase.url}/rest/v1/tasks?select=*&order=createdAt.desc&limit=100`, {
          headers,
          signal: AbortSignal.timeout(5000),
        }),
        fetch(`${this.supabase.url}/rest/v1/payments?select=*&limit=200`, {
          headers,
          signal: AbortSignal.timeout(5000),
        }),
      ]);

      if (reportsRes.ok) {
        const reports = (await reportsRes.json()) as any[];
        if (Array.isArray(reports)) {
          for (const r of reports) {
            this.db.treasuryReports.set(r.id, r);
          }
        }
      }

      if (purchasesRes.ok) {
        const purchases = (await purchasesRes.json()) as any[];
        if (Array.isArray(purchases)) {
          for (const p of purchases) {
            this.db.browserPurchases.set(p.id, p);
          }
        }
      }

      if (ownersRes.ok) {
        const owners = (await ownersRes.json()) as any[];
        if (Array.isArray(owners)) {
          for (const o of owners) {
            this.db.reportOwners.set(o.reportId, o);
          }
        }
      }

      if (tasksRes.ok) {
        const tasks = (await tasksRes.json()) as any[];
        if (Array.isArray(tasks)) {
          for (const t of tasks) {
            this.db.tasks.set(t.id, t);
          }
        }
      }

      if (paymentsRes.ok) {
        const payments = (await paymentsRes.json()) as any[];
        if (Array.isArray(payments)) {
          for (const pay of payments) {
            this.db.payments.set(pay.id, pay);
          }
        }
      }
      console.log(`[Supabase] Hydrated ${this.db.treasuryReports.size} reports and ${this.db.browserPurchases.size} purchases from cloud.`);
    } catch (err: any) {
      console.error('[Supabase Hydration Error]:', err?.message || err);
    }
  }

  transaction<T>(fn: () => T): T {
    return fn();
  }

  private append(taskId: string | null, type: string, payload: unknown): void {
    const detail = JSON.stringify(payload);
    const previous = this.db.prepare('SELECT hash FROM audit ORDER BY seq DESC LIMIT 1').get() as
      | { hash: string }
      | undefined;
    const prevHash = previous?.hash ?? 'GENESIS';
    const at = this.now().toISOString();
    const digest = hash(JSON.stringify([prevHash, taskId, type, detail, at]));
    this.db
      .prepare('INSERT INTO audit(taskId,type,detail,at,prevHash,hash) VALUES (?,?,?,?,?,?)')
      .run(taskId, type, detail, at, prevHash, digest);
  }

  event(taskId: string | null, type: string, payload: unknown): void {
    this.append(taskId, type, payload);
  }

  createTask(input: { requestKey: string; prompt: string; symbol: Symbol; budget: number }): {
    task: Task;
    created: boolean;
  } {
    if (!Number.isSafeInteger(input.budget) || input.budget < 0) throw new Error('INVALID_BUDGET');
    const existing = this.db
      .prepare('SELECT * FROM tasks WHERE requestKey=?')
      .get(input.requestKey) as unknown as Task | undefined;
    if (existing) {
      if (
        existing.prompt !== input.prompt ||
        existing.symbol !== input.symbol ||
        existing.budget !== input.budget
      ) {
        throw new Error('IDEMPOTENCY_CONFLICT');
      }
      return { task: existing, created: false };
    }

    const task: Task = {
      id: randomUUID(),
      ...input,
      status: 'running',
      createdAt: this.now().toISOString(),
      result: null,
      error: null,
    };

    this.db
      .prepare('INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?)')
      .run(
        task.id,
        task.requestKey,
        task.prompt,
        task.symbol,
        task.budget,
        task.status,
        task.createdAt,
        null,
        null,
      );
    this.append(task.id, 'task.created', { symbol: task.symbol, budget: task.budget });
    return { task, created: true };
  }

  getTask(id: string): Task {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id=?').get(id) as unknown as
      | Task
      | undefined;
    if (!row) throw new Error('TASK_NOT_FOUND');
    return row;
  }

  tasks(): Task[] {
    return this.db
      .prepare('SELECT * FROM tasks ORDER BY rowid DESC LIMIT 100')
      .all() as unknown as Task[];
  }

  payments(taskId?: string): Payment[] {
    return (taskId
      ? this.db.prepare('SELECT * FROM payments WHERE taskId=?').all(taskId)
      : this.db.prepare('SELECT * FROM payments').all()) as unknown as Payment[];
  }

  audit(taskId?: string): AuditEvent[] {
    return (taskId
      ? this.db.prepare('SELECT * FROM audit WHERE taskId=? ORDER BY seq').all(taskId)
      : this.db.prepare('SELECT * FROM audit ORDER BY seq').all()) as unknown as AuditEvent[];
  }

  saveTreasuryReport(input: {
    walletAddress: string;
    chainId: number;
    summary: string;
    report: unknown;
    markdown: string;
  }): { id: string; createdAt: string; reportHash: string } {
    const id = randomUUID();
    const createdAt = this.now().toISOString();
    const reportStr = JSON.stringify(input.report);
    const reportHash = hash(
      JSON.stringify([input.walletAddress, input.chainId, createdAt, reportStr]),
    );

    this.db
      .prepare(
        'INSERT INTO treasury_reports(id,walletAddress,chainId,createdAt,summary,report,markdown,reportHash) VALUES (?,?,?,?,?,?,?,?)',
      )
      .run(id, input.walletAddress, input.chainId, createdAt, input.summary, reportStr, input.markdown, reportHash);

    this.append(null, 'treasury.report.saved', {
      reportId: id,
      walletAddress: input.walletAddress,
      chainId: input.chainId,
      reportHash,
    });

    return { id, createdAt, reportHash };
  }

  treasuryReport(id: string) {
    const row = this.db.prepare('SELECT * FROM treasury_reports WHERE id=?').get(id) as
      | {
          id: string;
          walletAddress: string;
          chainId: number;
          createdAt: string;
          summary: string;
          report: string;
          markdown: string;
          reportHash: string;
        }
      | undefined;
    if (!row) throw new Error('REPORT_NOT_FOUND');
    return { ...row, report: JSON.parse(row.report) as unknown };
  }

  treasuryReports(): Array<{
    id: string;
    walletAddress: string;
    chainId: number;
    createdAt: string;
    summary: string;
    reportHash: string;
  }> {
    return this.db
      .prepare(
        'SELECT id,walletAddress,chainId,createdAt,summary,reportHash FROM treasury_reports ORDER BY rowid DESC LIMIT 20',
      )
      .all() as any[];
  }

  totals(taskId?: string): { spent: number; held: number; committed: number } {
    const rows = this.payments(taskId);
    const spent = rows.filter((p) => p.state === 'settled').reduce((n, p) => n + p.amount, 0);
    const held = rows
      .filter((p) => p.state === 'reserved' || p.state === 'unknown')
      .reduce((n, p) => n + p.amount, 0);
    return { spent, held, committed: spent + held };
  }

  overview() {
    const today = this.now().toISOString().slice(0, 10);
    const all = this.totals();
    const dailyCommitted = this.payments()
      .filter(
        (p) =>
          (p.state === 'settled' && p.day === today) ||
          p.state === 'unknown' ||
          p.state === 'reserved',
      )
      .reduce((n, p) => n + p.amount, 0);

    return {
      ...all,
      walletAvailable: Math.max(0, this.limits.wallet - all.committed),
      dailyCommitted,
      dailyRemaining: Math.max(0, this.limits.dailyBudget - dailyCommitted),
    };
  }

  reserve(taskId: string, serviceId: string, resource: string, amount: number): Payment {
    positive(amount);
    const old = this.payments(taskId).find(
      (p) => p.serviceId === serviceId && p.resource === resource,
    );
    if (old) {
      if (old.amount !== amount) throw new Error('PRICE_CHANGED');
      if (old.state !== 'settled') throw new Error('PAYMENT_ALREADY_ATTEMPTED');
      return old;
    }

    const task = this.getTask(taskId);
    if (task.status !== 'running') throw new Error('TASK_NOT_RUNNING');
    const totals = this.totals(taskId);
    const global = this.overview();

    if (amount > this.limits.maxPayment) throw new Error('PER_PAYMENT_LIMIT');
    if (totals.committed + amount > task.budget) throw new Error('TASK_BUDGET_EXCEEDED');
    if (amount > global.dailyRemaining) throw new Error('DAILY_BUDGET_EXCEEDED');
    if (amount > global.walletAvailable) throw new Error('WALLET_INSUFFICIENT');

    const p: Payment = {
      id: randomUUID(),
      taskId,
      serviceId,
      resource,
      amount,
      state: 'reserved',
      day: this.now().toISOString().slice(0, 10),
      receiptId: null,
      data: null,
    };

    this.db
      .prepare('INSERT INTO payments VALUES (?,?,?,?,?,?,?,?,?)')
      .run(p.id, p.taskId, p.serviceId, p.resource, p.amount, p.state, p.day, null, null);
    this.append(taskId, 'payment.reserved', { paymentId: p.id, serviceId, amount });
    return p;
  }

  transition(
    id: string,
    state: 'settled' | 'released' | 'unknown',
    receiptId: string | null = null,
  ): void {
    const p = this.db.prepare('SELECT * FROM payments WHERE id=?').get(id) as unknown as Payment;
    if (!p || p.state !== 'reserved') throw new Error('INVALID_PAYMENT_TRANSITION');

    this.db
      .prepare('UPDATE payments SET state=?, receiptId=?, day=? WHERE id=?')
      .run(
        state,
        receiptId,
        state === 'settled' ? this.now().toISOString().slice(0, 10) : p.day,
        id,
      );
    this.append(p.taskId, `payment.${state}`, {
      paymentId: id,
      serviceId: p.serviceId,
      amount: p.amount,
      receiptId,
    });
  }

  saveData(id: string, data: unknown): void {
    this.db
      .prepare("UPDATE payments SET data=? WHERE id=? AND state='settled'")
      .run(JSON.stringify(data), id);
  }

  finish(id: string, result: string, error: string | null = null): void {
    this.db
      .prepare('UPDATE tasks SET status=?,result=?,error=? WHERE id=?')
      .run(error ? 'failed' : 'completed', result, error, id);
    this.append(
      id,
      error ? 'task.failed' : 'task.completed',
      error ? { error } : this.totals(id),
    );
  }

  recover(): void {
    for (const p of this.payments().filter((p) => p.state === 'reserved')) {
      this.db.prepare("UPDATE payments SET state='unknown' WHERE id=?").run(p.id);
      this.append(p.taskId, 'payment.unknown', { paymentId: p.id, reason: 'process_restart' });
    }

    for (const b of this.db.browserPurchases.values()) {
      if (b.status === 'submitting') b.status = 'unknown';
    }

    this.db
      .prepare(
        "UPDATE tasks SET status='interrupted',error='PROCESS_RESTART' WHERE status='running'",
      )
      .run();
  }

  verifyAudit(): boolean {
    let previous = 'GENESIS';
    for (const e of this.audit()) {
      if (
        e.prevHash !== previous ||
        e.hash !== hash(JSON.stringify([previous, e.taskId, e.type, e.detail, e.at]))
      ) {
        return false;
      }
      previous = e.hash;
    }
    return true;
  }

  async close(): Promise<void> {
    // Pure in-memory/Supabase engine has no lingering open resources to close
  }
}
