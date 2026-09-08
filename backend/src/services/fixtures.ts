import type { DataResult, MockServiceId, Symbol } from '../types.js';
export const fixtureTime = '2026-09-01T00:00:00.000Z';
export function fixture(service: MockServiceId | 'market', symbol: Symbol): DataResult {
  const prices: Record<string, number> = { ETH: 2500, BTC: 60000, BNB: 550, SOL: 150 };
  if (!Object.hasOwn(prices, symbol)) throw new Error('FIXTURE_ASSET_NOT_AVAILABLE');
  const values: Record<
    MockServiceId | 'market',
    { summary: string; metrics: Record<string, string | number> }
  > = {
    market: {
      summary: `${symbol}: fixture snapshot for testing the payment workflow.`,
      metrics: { priceUsd: prices[symbol]!, change24hPct: 2.4, volumeUsd: 1_250_000_000 },
    },
    whale: {
      summary: 'Fixture: higher exchange inflows; live evidence is needed for conclusions.',
      metrics: { exchangeInflowChangePct: 18.4, largeTransfers: 42, sampleWindow: '24h' },
    },
    sentiment: {
      summary: 'Fixture: discussion leans positive with mixed signals.',
      metrics: { positivePct: 62, neutralPct: 23, negativePct: 15, samplePosts: 1200 },
    },
    risk: {
      summary: 'Fixture: moderate volatility and funding above the reference level.',
      metrics: { volatility30dPct: 4.2, fundingRatePct: 0.012, category: 'moderate (fixture)' },
    },
  };
  return {
    source: `LedgerMind ${service} fixture`,
    fixture: true,
    symbol,
    ...values[service],
    observedAt: fixtureTime,
  };
}
