import type { Service } from '../types.js';
import type { MerchantPolicy } from '../payments/binance.js';
import { CMC_ORIGIN, CMC_PATH, CMC_USDC_BASE, CMC_RECIPIENT } from './cmc.js';

export function mockServices(): Service[] {
  return [
    {
      id: 'whale',
      title: 'Whale intelligence',
      description: 'Fixture: large transfers and exchange activity',
      price: 30_000,
      baseUrl: '',
      protocol: 'mock',
    },
    {
      id: 'sentiment',
      title: 'Market sentiment',
      description: 'Fixture: sentiment and discussion consensus',
      price: 20_000,
      baseUrl: '',
      protocol: 'mock',
    },
    {
      id: 'risk',
      title: 'Risk signals',
      description: 'Fixture: volatility, funding and risk metrics',
      price: 10_000,
      baseUrl: '',
      protocol: 'mock',
    },
  ];
}

/** Only exposes configured live tools; does not disguise mock services as live data. */
export const realServices: Service[] = [
  {
    id: 'cmc_quote',
    title: 'CoinMarketCap quotes',
    description:
      'Live prices, 24-hour changes, volume and market cap. One purchase costs 0.01 USDC on Base.',
    price: 10_000,
    baseUrl: CMC_ORIGIN,
    protocol: 'x402',
  },
];
export const realPolicies: MerchantPolicy[] = [
  {
    serviceId: 'cmc_quote',
    origin: CMC_ORIGIN,
    resourcePath: CMC_PATH,
    network: 'eip155:8453',
    asset: CMC_USDC_BASE,
    payTo: CMC_RECIPIENT,
    tokenAmount: '10000',
    maxUsd: 10_000,
    fixedBudgetAmount: 10_000,
    transferMethod: 'eip3009',
    tokenName: 'USD Coin',
    tokenVersion: '2',
  },
];
