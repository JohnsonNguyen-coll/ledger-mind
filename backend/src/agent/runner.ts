import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { DataResult, Service, Task } from '../types.js';
import { Store } from '../store.js';
import { money } from '../money.js';
import { PaymentGateway, boundedJson } from '../payments/gateway.js';
import { fixture } from '../services/fixtures.js';
import { OpenRouterProvider } from './openrouter.js';
import { GeminiProvider } from './gemini.js';
import { MarketSearch, assetSymbol } from '../services/market-search.js';
import {
  DemoProvider,
  OpenAIProvider,
  toolsForServices,
  type Observation,
  type Provider,
} from './provider.js';

export function errorCode(error: unknown): string {
  const m = error instanceof Error ? error.message : '';
  // Exception bodies may contain upstream secrets or raw untrusted responses.
  return /^[A-Z][A-Z0-9_]{1,90}$/.test(m) ? m : 'TOOL_OR_PROVIDER_FAILED';
}
export class AgentRunner {
  private jobs = new Map<string, Promise<void>>();
  constructor(
    private config: Config,
    private store: Store,
    private gateway: PaymentGateway,
    private services: Service[],
    private marketSearch = new MarketSearch(),
  ) {}
  start(task: Task, provider?: Provider) {
    if (this.jobs.has(task.id)) return;
    const job = this.run(task, provider).finally(() => this.jobs.delete(task.id));
    this.jobs.set(task.id, job);
  }
  async idle() {
    await Promise.all(this.jobs.values());
  }
  get active() {
    return this.jobs.size;
  }
  private async market(task: Task) {
    if (this.config.marketMode === 'fixture') return fixture('market', task.symbol);
    const url = `https://data-api.binance.vision/api/v3/ticker/24hr?symbol=${task.symbol}USDT`;
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`BINANCE_MARKET_HTTP_${response.status}`);
    const d = z
      .object({
        lastPrice: z.string(),
        priceChangePercent: z.string(),
        quoteVolume: z.string(),
        closeTime: z.number(),
      })
      .parse(await boundedJson(response));
    return {
      source: 'Binance public spot ticker',
      fixture: false,
      symbol: task.symbol,
      summary: 'Live Binance spot market snapshot (USDT pair).',
      metrics: {
        priceUsdt: d.lastPrice,
        change24hPct: d.priceChangePercent,
        volumeUsdt: d.quoteVolume,
      },
      observedAt: new Date(d.closeTime).toISOString(),
    };
  }
  private async run(task: Task, given?: Provider) {
    const provider =
      given ??
      (this.config.agentMode === 'demo'
        ? new DemoProvider(task, () => this.store.totals(task.id), this.services)
        : this.config.agentMode === 'gemini'
          ? new GeminiProvider(
              task,
              this.config.geminiKey,
              this.config.model,
              fetch,
              toolsForServices(this.services, task.symbol === 'AUTO'),
            )
          : this.config.agentMode === 'openrouter'
            ? new OpenRouterProvider(
                task,
                this.config.openrouterKey,
                this.config.model,
                fetch,
                toolsForServices(this.services, task.symbol === 'AUTO'),
              )
            : new OpenAIProvider(
                task,
                this.config.openaiKey,
                this.config.model,
                fetch,
                toolsForServices(this.services, task.symbol === 'AUTO'),
              ));
    const observations: Observation[] = [];
    let callsCount = 0;
    const toolCache = new Map<string, unknown>();
    try {
      for (let step = 0; step < this.config.maxSteps; step++) {
        if (this.config.stepMs) await delay(this.config.stepMs);
        const decision = await provider.next(observations);
        if (decision.usage) this.store.event(task.id, 'llm.usage', decision.usage);
        if (!decision.calls.length) {
          if (!decision.text?.trim()) throw new Error('EMPTY_AGENT_RESULT');
          this.store.finish(task.id, decision.text);
          return;
        }
        for (const call of decision.calls) {
          if (++callsCount > Math.max(100, this.config.maxSteps * 2)) throw new Error('TOOL_CALL_LIMIT');
          let output: unknown;
          let cacheKey: string | undefined;
          try {
            const raw = JSON.parse(call.arguments);
            const dynamic = task.symbol === 'AUTO';
            let args: { symbol?: string; quoteAsset?: string; symbols?: string[]; query?: string } =
              {};
            if (!dynamic) z.object({}).strict().parse(raw);
            else if (call.name === 'search_assets')
              args = z
                .object({ query: z.string().trim().min(1).max(80) })
                .strict()
                .parse(raw);
            else if (call.name === 'get_market')
              args = z.object({ symbol: assetSymbol, quoteAsset: assetSymbol }).strict().parse(raw);
            else if (call.name === 'compare_markets')
              args = z
                .object({ symbols: z.array(assetSymbol).min(1).max(8) })
                .strict()
                .parse(raw);
            else if (call.name.startsWith('buy_'))
              args = z.object({ symbol: assetSymbol }).strict().parse(raw);
            else z.object({}).strict().parse(raw);
            const argumentKey = JSON.stringify(args);
            const selectedTask = args.symbol ? { ...task, symbol: args.symbol } : task;
            this.store.event(task.id, 'tool.started', { tool: call.name, arguments: args });
            cacheKey = call.name + ':' + argumentKey;
            if (toolCache.has(cacheKey) && call.name !== 'get_budget') {
              output = toolCache.get(cacheKey);
              this.store.event(task.id, 'tool.reused', { tool: call.name });
            } else if (call.name === 'search_assets' && dynamic) {
              if (this.config.marketMode === 'fixture') throw new Error('LIVE_MARKET_REQUIRED');
              output = await this.marketSearch.search(args.query!);
            } else if (call.name === 'get_market') {
              output = {
                data:
                  dynamic && this.config.marketMode === 'binance'
                    ? await this.marketSearch.quote(args.symbol!, args.quoteAsset!)
                    : await this.market(selectedTask),
              };
            } else if (call.name === 'compare_markets') {
              const symbols = args.symbols ?? ['BTC', 'ETH', 'BNB'];
              const snapshots = await Promise.allSettled(
                symbols.map((symbol) =>
                  dynamic && this.config.marketMode === 'binance'
                    ? this.marketSearch.quote(symbol)
                    : this.market({ ...task, symbol }),
                ),
              );
              output = {
                snapshots: snapshots.map((r, i) =>
                  r.status === 'fulfilled'
                    ? r.value
                    : { symbol: symbols[i], error: errorCode(r.reason) },
                ),
                dataPaymentUsd: '0.00',
              };
            } else if (call.name === 'get_spending_summary') {
              // Aggregate numeric ledger facts only. Never send prompts, signatures or keys to a model.
              const payments = this.store.payments();
              const overview = this.store.overview();
              output = {
                source: 'LedgerMind local payment ledger',
                observedAt: new Date().toISOString(),
                paymentMode: this.config.paymentMode,
                integrityValid: this.store.verifyAudit(),
                spentUsd: money(overview.spent),
                heldUsd: money(overview.held),
                dailyRemainingUsd: money(overview.dailyRemaining),
                appAllowanceRemainingUsd: money(overview.walletAvailable),
                providers: this.services.map((s) => ({
                  service: s.id,
                  settledUsd: money(
                    payments
                      .filter((p) => p.serviceId === s.id && p.state === 'settled')
                      .reduce((n, p) => n + p.amount, 0),
                  ),
                })),
                counts: Object.fromEntries(
                  ['settled', 'reserved', 'unknown', 'released'].map((state) => [
                    state,
                    payments.filter((p) => p.state === state).length,
                  ]),
                ),
                note: 'Local ledger only. Not independent on-chain verification; model API costs are excluded.',
              };
            } else if (call.name === 'get_budget') {
              const totals = this.store.totals(task.id);
              output = {
                currency: 'USD',
                budgetUsd: money(task.budget),
                spentUsd: money(totals.spent),
                heldUsd: money(totals.held),
                remainingUsd: money(Math.max(0, task.budget - totals.committed)),
              };
            } else {
              const service = this.services.find((s) => `buy_${s.id}` === call.name);
              if (!service) throw new Error('UNKNOWN_TOOL');
              output = { data: await this.gateway.purchase(selectedTask, service) };
            }
            this.store.event(task.id, 'tool.completed', { tool: call.name });
          } catch (error) {
            const code = errorCode(error);
            output = { error: code };
            this.store.event(task.id, 'tool.failed', { tool: call.name, error: code });
          }
          if (cacheKey && call.name !== 'get_budget') toolCache.set(cacheKey, output);
          observations.push({ call, output });
        }
      }
      const successfulObs = observations.filter((o) => {
        const out = o.output as Record<string, unknown> | undefined;
        return out && !out.error;
      });
      if (successfulObs.length > 0) {
        const totals = this.store.totals(task.id);
        const data = observations.flatMap((o) => {
          const v = o.output as { data?: DataResult };
          return v.data ? [v.data] : [];
        });
        const summarySections = [
          `# ${task.symbol === 'AUTO' ? 'Market Research' : task.symbol} · Agent Report`,
          ...data.map(
            (d) =>
              `## ${d.source}\n${d.summary}\n**Observed:** ${d.observedAt}\n${Object.entries(d.metrics)
                .map(([k, v]) => `- **${k}:** ${v}`)
                .join('\n')}`,
          ),
          ...observations
            .filter((o) => o.call.name === 'get_market' && !('error' in (o.output as object)))
            .map((o) => {
              const res = o.output as Record<string, unknown>;
              return `## Binance Spot Market\n${Object.entries(res)
                .map(([k, v]) => `- **${k}:** ${typeof v === 'object' ? JSON.stringify(v) : v}`)
                .join('\n')}`;
            }),
          `### Ledger & Spending Summary\nSpent: $${money(totals.spent)} · Held: $${money(totals.held)} · Remaining: $${money(Math.max(0, task.budget - totals.spent - totals.held))}.`,
          `*Evidence synthesized directly from ${observations.length} agent observations.*`,
        ];
        this.store.finish(task.id, summarySections.join('\n\n'));
        return;
      }
      throw new Error('AGENT_STEP_LIMIT');
    } catch (error) {
      this.store.finish(
        task.id,
        'The agent could not finish this task. Any settled or held payments remain recorded in the activity log.',
        errorCode(error),
      );
    }
  }
}
