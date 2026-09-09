import type { Config } from '../src/config.js';

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 0,
    appOrigin: '',
    servicePorts: [0, 0, 0],
    databasePath: ':memory:',
    supabaseUrl: '',
    supabaseAnonKey: '',
    supabaseServiceRoleKey: '',
    agentMode: 'demo',
    marketMode: 'fixture',
    paymentMode: 'mock',
    wallet: 10_000_000,
    maxPayment: 100_000,
    dailyBudget: 1_000_000,
    maxTaskBudget: 1_000_000,
    stepMs: 0,
    maxSteps: 8,
    groqKey: '',
    model: 'llama-3.3-70b-versatile',
    bawCliJs: '',
    realEnabled: false,
    browserPremiumEnabled: true,
    walletConnectProjectId: '',
    ...overrides,
  };
}
