import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { positive } from './money.js';
import type { AuditEvent, Payment, Symbol, Task } from './types.js';

const requireModule = createRequire(import.meta.url);
let DatabaseSync: any;
try {
  DatabaseSync = requireModule('node:sqlite').DatabaseSync;
} catch {
  console.warn('[LedgerMind] node:sqlite module requires Node.js >= 22.5.0.');
}

export interface Limits {
  wallet: number;
  maxPayment: number;
  dailyBudget: number;
}
const hash = (s: string) => createHash('sha256').update(s).digest('hex');

export class Store {
  readonly db: any;
  constructor(
    path: string,
    readonly limits: Limits,
    readonly now = () => new Date(),
  ) {

    for (const amount of Object.values(limits)) {
      if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('INVALID_LIMIT');
    }
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, requestKey TEXT NOT NULL UNIQUE, prompt TEXT NOT NULL,
        symbol TEXT NOT NULL, budget INTEGER NOT NULL CHECK(budget>=0), status TEXT NOT NULL,
        createdAt TEXT NOT NULL, result TEXT, error TEXT);
      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY, taskId TEXT NOT NULL REFERENCES tasks(id),
        serviceId TEXT NOT NULL, resource TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount>0),
        state TEXT NOT NULL, day TEXT NOT NULL, receiptId TEXT, data TEXT,
        UNIQUE(taskId, serviceId, resource));
      CREATE TABLE IF NOT EXISTS audit (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, taskId TEXT, type TEXT NOT NULL,
        detail TEXT NOT NULL, at TEXT NOT NULL, prevHash TEXT NOT NULL, hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS treasury_reports (
        id TEXT PRIMARY KEY, walletAddress TEXT NOT NULL, chainId INTEGER NOT NULL,
        createdAt TEXT NOT NULL, summary TEXT NOT NULL, report TEXT NOT NULL,
        markdown TEXT NOT NULL, reportHash TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'append only'); END;
      CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'append only'); END;`);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  private append(taskId: string | null, type: string, payload: unknown) {
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
  event(taskId: string | null, type: string, payload: unknown) {
    this.transaction(() => this.append(taskId, type, payload));
  }
  createTask(input: { requestKey: string; prompt: string; symbol: Symbol; budget: number }) {
    if (!Number.isSafeInteger(input.budget) || input.budget < 0) throw new Error('INVALID_BUDGET');
    return this.transaction(() => {
      const existing = this.db
        .prepare('SELECT * FROM tasks WHERE requestKey=?')
        .get(input.requestKey) as unknown as Task | undefined;
      if (existing) {
        if (
          existing.prompt !== input.prompt ||
          existing.symbol !== input.symbol ||
          existing.budget !== input.budget
        )
          throw new Error('IDEMPOTENCY_CONFLICT');
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
    });
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
  }) {
    return this.transaction(() => {
      const id = randomUUID();
      const createdAt = this.now().toISOString();
      const report = JSON.stringify(input.report);
      const reportHash = hash(JSON.stringify([input.walletAddress, input.chainId, createdAt, report]));
      this.db
        .prepare(
          'INSERT INTO treasury_reports(id,walletAddress,chainId,createdAt,summary,report,markdown,reportHash) VALUES (?,?,?,?,?,?,?,?)',
        )
        .run(id, input.walletAddress, input.chainId, createdAt, input.summary, report, input.markdown, reportHash);
      this.append(null, 'treasury.report.saved', {
        reportId: id,
        walletAddress: input.walletAddress,
        chainId: input.chainId,
        reportHash,
      });
      return { id, createdAt, reportHash };
    });
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
  treasuryReports() {
    return this.db
      .prepare(
        'SELECT id,walletAddress,chainId,createdAt,summary,reportHash FROM treasury_reports ORDER BY rowid DESC LIMIT 20',
      )
      .all() as Array<{
      id: string;
      walletAddress: string;
      chainId: number;
      createdAt: string;
      summary: string;
      reportHash: string;
    }>;
  }
  totals(taskId?: string) {
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
    // Unknown/reserved vẫn chiếm hạn mức ngày, kể cả đã qua UTC midnight.
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
    return this.transaction(() => {
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
      const totals = this.totals(taskId),
        global = this.overview();
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
    });
  }
  transition(
    id: string,
    state: 'settled' | 'released' | 'unknown',
    receiptId: string | null = null,
  ) {
    this.transaction(() => {
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
    });
  }
  saveData(id: string, data: unknown) {
    this.db
      .prepare("UPDATE payments SET data=? WHERE id=? AND state='settled'")
      .run(JSON.stringify(data), id);
  }
  finish(id: string, result: string, error: string | null = null) {
    this.transaction(() => {
      this.db
        .prepare('UPDATE tasks SET status=?,result=?,error=? WHERE id=?')
        .run(error ? 'failed' : 'completed', result, error, id);
      this.append(
        id,
        error ? 'task.failed' : 'task.completed',
        error ? { error } : this.totals(id),
      );
    });
  }
  recover() {
    // Không tự trả lại ngân sách khi process chết giữa sign và HTTP response.
    this.transaction(() => {
      for (const p of this.payments().filter((p) => p.state === 'reserved')) {
        this.db.prepare("UPDATE payments SET state='unknown' WHERE id=?").run(p.id);
        this.append(p.taskId, 'payment.unknown', { paymentId: p.id, reason: 'process_restart' });
      }
      this.db
        .prepare(
          "UPDATE tasks SET status='interrupted',error='PROCESS_RESTART' WHERE status='running'",
        )
        .run();
    });
  }
  verifyAudit() {
    let previous = 'GENESIS';
    for (const e of this.audit()) {
      if (
        e.prevHash !== previous ||
        e.hash !== hash(JSON.stringify([previous, e.taskId, e.type, e.detail, e.at]))
      )
        return false;
      previous = e.hash;
    }
    return true;
  }
  close() {
    this.db.close();
  }
}
