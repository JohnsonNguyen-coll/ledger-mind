import { z } from 'zod';
import type { DataResult, Symbol } from '../types.js';

export const CMC_ORIGIN = 'https://pro-api.coinmarketcap.com';
export const CMC_PATH = '/x402/v3/cryptocurrency/quotes/latest';
export const CMC_USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
// Địa chỉ từ challenge CMC đã được kiểm tra trong phiên setup; thay đổi => dừng.
export const CMC_RECIPIENT = '0x3C5f3a6cE224BB89D72f5EB4232ecC27F67B3eeA';
const ids: Record<Symbol, number> = { ETH: 1027, BTC: 1, BNB: 1839, SOL: 5426 };
export function cmcResource(symbol: Symbol): string {
  if (!Object.hasOwn(ids, symbol)) throw new Error('UNSUPPORTED_SYMBOL');
  return `${CMC_ORIGIN}${CMC_PATH}?id=${ids[symbol]}`;
}

/** CMC trả schema riêng, không phải schema của các microservice mock.
 * Chỉ lấy các trường số đã kiểm tra; không đẩy nguyên body merchant vào prompt.
 * Hỗ trợ giá trị object hoặc array một phần tử của API quotes. */
export function cmcData(raw: unknown, symbol: Symbol): DataResult {
  const envelope = z
    .object({
      status: z.object({ error_code: z.union([z.literal(0), z.literal('0')]) }).passthrough(),
      data: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]),
    })
    .passthrough()
    .parse(raw);

  const targetId = ids[symbol];
  let entry: unknown;

  if (Array.isArray(envelope.data)) {
    entry = envelope.data.find(
      (item: any) => item?.id === targetId || item?.symbol === symbol,
    );
  } else {
    const value = envelope.data[String(targetId)];
    entry = Array.isArray(value) && value.length === 1 ? value[0] : value;
  }

  const rawQuote = (entry as any)?.quote;
  let usdQuote: any = rawQuote?.USD;
  if (!usdQuote && Array.isArray(rawQuote)) {
    usdQuote = rawQuote.find((q: any) => q?.symbol === 'USD');
  }

  const normalizedEntry = {
    ...(entry as object),
    quote: {
      USD: usdQuote,
    },
  };

  const result = z
    .object({
      id: z.literal(targetId),
      symbol: z.literal(symbol),
      quote: z.object({
        USD: z.object({
          price: z.number().finite().nonnegative(),
          volume_24h: z.number().finite().nonnegative().nullable().optional(),
          percent_change_24h: z.number().finite().nullable().optional(),
          market_cap: z.number().finite().nonnegative().nullable().optional(),
          last_updated: z.string(),
        }),
      }),
    })
    .parse(normalizedEntry);
  const quote = result.quote.USD;
  const metrics: Record<string, string | number> = { priceUsd: quote.price };
  if (quote.volume_24h != null) metrics.volume24hUsd = quote.volume_24h;
  if (quote.percent_change_24h != null) metrics.change24hPct = quote.percent_change_24h;
  if (quote.market_cap != null) metrics.marketCapUsd = quote.market_cap;
  return {
    source: 'CoinMarketCap quotes (x402)',
    fixture: false,
    symbol,
    summary: `Snapshot ${symbol} from CoinMarketCap: price, change and market size. This source does not provide whale or sentiment data.`,
    metrics,
    observedAt: quote.last_updated,
  };
}
