import 'dotenv/config';
import { z } from 'zod';
import { usd } from './money.js';

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_ORIGIN: z.string().trim().default('').refine(value => {
    if (!value) return true;
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && url.origin === value; } catch { return false; }
  }, 'APP_ORIGIN must be an exact http(s) origin without a trailing slash'),
  WHALE_PORT: z.coerce.number().int().min(1).max(65535).default(4101),
  SENTIMENT_PORT: z.coerce.number().int().min(1).max(65535).default(4102),
  RISK_PORT: z.coerce.number().int().min(1).max(65535).default(4103),
  DATABASE_PATH: z.string().default('./data/ledgermind.sqlite'),
  DATABASE_URL: z.string().default(''),
  SUPABASE_URL: z.string().default(''),
  SUPABASE_ANON_KEY: z.string().default(''),
  SUPABASE_SERVICE_ROLE_KEY: z.string().default(''),
  AGENT_MODE: z.enum(['demo', 'openai', 'openrouter', 'gemini', 'groq']).default('demo'),
  MARKET_MODE: z.enum(['fixture', 'binance']).default('fixture'),
  PAYMENT_MODE: z.enum(['mock', 'binance']).default('mock'),
  MOCK_WALLET_USD: z.string().default('10.00'),
  MAX_PAYMENT_USD: z.string().default('0.10'),
  DAILY_BUDGET_USD: z.string().default('1.00'),
  MAX_TASK_BUDGET_USD: z.string().default('1.00'),
  DEMO_STEP_MS: z.coerce.number().int().min(0).max(2000).default(350),
  MAX_AGENT_STEPS: z.coerce.number().int().min(1).max(200).default(50),
  OPENAI_API_KEY: z.string().trim().default(''),
  OPENAI_MODEL: z.string().default('gpt-4.1-mini'),
  OPENROUTER_API_KEY: z.string().trim().default(''),
  OPENROUTER_MODEL: z.string().trim().min(1).default('openrouter/free'),
  GEMINI_API_KEY: z.string().trim().default(''),
  GEMINI_MODEL: z
    .string()
    .regex(/^gemini-[a-zA-Z0-9.-]+$/)
    .default('gemini-3.6-flash'),
  GROQ_API_KEY: z.string().trim().default(''),
  GROQ_MODEL: z.string().trim().min(1).default('llama-3.3-70b-versatile'),
  BAW_CLI_JS: z.string().default(''),
  REAL_PAYMENTS_ENABLED: z.enum(['true', 'false']).default('false'),
  BROWSER_PREMIUM_ENABLED: z.enum(['true', 'false']).default('true'),
  WALLETCONNECT_PROJECT_ID: z.string().trim().regex(/^([a-fA-F0-9]{32})?$/).default(''),
});
export function readConfig(requireModelKey = true) {
  const e = envSchema.parse(process.env);
  if (e.AGENT_MODE === 'openai' && e.OPENAI_API_KEY.startsWith('sk-or-'))
    throw new Error('OPENROUTER_KEY_REQUIRES_OPENROUTER_MODE');
  if (requireModelKey && e.AGENT_MODE === 'openrouter' && !e.OPENROUTER_API_KEY)
    throw new Error('OPENROUTER_API_KEY_REQUIRED');
  if (requireModelKey && e.AGENT_MODE === 'openai' && !e.OPENAI_API_KEY)
    throw new Error('OPENAI_API_KEY_REQUIRED');
  if (requireModelKey && e.AGENT_MODE === 'gemini' && !e.GEMINI_API_KEY)
    throw new Error('GEMINI_API_KEY_REQUIRED');
  if (requireModelKey && e.AGENT_MODE === 'groq' && !e.GROQ_API_KEY)
    throw new Error('GROQ_API_KEY_REQUIRED');
  return {
    port: e.PORT,
    appOrigin: e.APP_ORIGIN,
    servicePorts: [e.WHALE_PORT, e.SENTIMENT_PORT, e.RISK_PORT],
    databasePath: e.DATABASE_PATH,
    databaseUrl: e.DATABASE_URL,
    supabaseUrl: e.SUPABASE_URL,
    supabaseAnonKey: e.SUPABASE_ANON_KEY,
    supabaseServiceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY,
    agentMode: e.AGENT_MODE,
    marketMode: e.MARKET_MODE,
    paymentMode: e.PAYMENT_MODE,
    wallet: usd(e.MOCK_WALLET_USD),
    maxPayment: usd(e.MAX_PAYMENT_USD),
    dailyBudget: usd(e.DAILY_BUDGET_USD),
    maxTaskBudget: usd(e.MAX_TASK_BUDGET_USD),
    stepMs: e.DEMO_STEP_MS,
    maxSteps: e.MAX_AGENT_STEPS,
    openaiKey: e.OPENAI_API_KEY,
    openrouterKey: e.OPENROUTER_API_KEY,
    geminiKey: e.GEMINI_API_KEY,
    groqKey: e.GROQ_API_KEY,
    model:
      e.AGENT_MODE === 'groq'
        ? e.GROQ_MODEL
        : e.AGENT_MODE === 'gemini'
          ? e.GEMINI_MODEL
          : e.AGENT_MODE === 'openrouter'
            ? e.OPENROUTER_MODEL
            : e.OPENAI_MODEL,
    bawCliJs: e.BAW_CLI_JS,
    realEnabled: e.REAL_PAYMENTS_ENABLED === 'true',
    browserPremiumEnabled: e.BROWSER_PREMIUM_ENABLED === 'true',
    walletConnectProjectId: e.WALLETCONNECT_PROJECT_ID,
  };
}
export type Config = ReturnType<typeof readConfig>;
