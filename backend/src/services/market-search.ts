import { z } from 'zod';
import { boundedJson } from '../payments/gateway.js';

export const assetSymbol = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{1,30}$/);
const marketSchema = z.object({
  symbol: z.string(),
  baseAsset: z.string(),
  quoteAsset: z.string(),
  status: z.string(),
});
type Market = z.infer<typeof marketSchema>;

/** Query Binance's current catalog, not an app-maintained coin whitelist.
 * Keep URLs fixed; user/model input is only used for local filtering or encoded parameters.
 */
export class MarketSearch {
  private cached?: { at: number; rows: Market[] };
  constructor(private fetcher: typeof fetch = fetch) {}
  async search(query: string) {
    const term = z.string().trim().min(1).max(80).parse(query).toUpperCase();
    if (!this.cached || Date.now() - this.cached.at > 300_000) {
      const r = await this.fetcher(
        'https://data-api.binance.vision/api/v3/exchangeInfo?showPermissionSets=false',
        { redirect: 'error', signal: AbortSignal.timeout(15_000) },
      );
      if (!r.ok) {
        await r.body?.cancel();
        throw new Error(`BINANCE_MARKET_HTTP_${r.status}`);
      }
      const body = z
        .object({ symbols: z.array(marketSchema).max(30000) })
        .parse(await boundedJson(r, 8_000_000));
      this.cached = { at: Date.now(), rows: body.symbols.filter((s) => s.status === 'TRADING') };
    }
    const rows = this.cached.rows;
    const exact = rows.filter((s) => s.baseAsset === term || s.symbol === term);
    const matches = exact.length
      ? exact
      : rows.filter((s) => s.baseAsset.includes(term) || s.symbol.includes(term));
    return {
      source: 'Binance exchangeInfo',
      observedAt: new Date(this.cached.at).toISOString(),
      query,
      matches: matches.slice(0, 40),
      totalMatches: matches.length,
      note: 'Exchange tickers, not full project names. Resolve a project name to a candidate ticker, then verify it here. Empty matches do not prove the asset does not exist elsewhere.',
    };
  }
  async quote(symbol: string, quoteAsset = 'USDT') {
    let base = assetSymbol.parse(symbol);
    const quote = assetSymbol.parse(quoteAsset);
    if (base.endsWith(quote) && base.length > quote.length) {
      base = base.slice(0, -quote.length);
    }
    const pair = base + quote;
    const r = await this.fetcher(
      `https://data-api.binance.vision/api/v3/ticker/24hr?symbol=${encodeURIComponent(pair)}`,
      { redirect: 'error', signal: AbortSignal.timeout(10_000) },
    );
    if (!r.ok) {
      await r.body?.cancel();
      throw new Error(
        r.status === 400 ? 'MARKET_PAIR_NOT_AVAILABLE' : `BINANCE_MARKET_HTTP_${r.status}`,
      );
    }
    const d = z
      .object({
        symbol: z.literal(pair),
        lastPrice: z.string(),
        priceChangePercent: z.string(),
        quoteVolume: z.string(),
        closeTime: z.number(),
      })
      .parse(await boundedJson(r));
    return {
      source: 'Binance public spot ticker',
      fixture: false,
      symbol: base,
      summary: `Live ${pair} market snapshot. Prices and volume are denominated in ${quote}.`,
      metrics: {
        pair,
        quoteAsset: quote,
        price: d.lastPrice,
        change24hPct: d.priceChangePercent,
        volume: d.quoteVolume,
      },
      observedAt: new Date(d.closeTime).toISOString(),
    };
  }
}
