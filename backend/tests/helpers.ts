import type { Config } from '../src/config.js';
export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 0,
    servicePorts: [0, 0, 0],
    databasePath: ':memory:',
    agentMode: 'demo',
    marketMode: 'fixture',
    paymentMode: 'mock',
    wallet: 10_000_000,
    maxPayment: 100_000,
    dailyBudget: 1_000_000,
    maxTaskBudget: 1_000_000,
    stepMs: 0,
    maxSteps: 8,
    openaiKey: '',
    openrouterKey: '',
    geminiKey: '',
    model: 'gpt-4.1-mini',
    bawCliJs: '',
    realEnabled: false,
    browserPremiumEnabled: true,
    walletConnectProjectId: '',
    ...overrides,
  };
}
