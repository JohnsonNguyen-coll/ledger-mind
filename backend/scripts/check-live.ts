import { readConfig } from '../src/config.js';
import { cliRunner, BinancePaymentAdapter } from '../src/payments/binance.js';
import { realPolicies, realServices } from '../src/services/registry.js';
import { cmcResource } from '../src/services/cmc.js';
import { boundedJson } from '../src/payments/gateway.js';
import { errorCode } from '../src/agent/runner.js';

// Chỉ đọc wallet/market/quote/model access. Không gọi sign hay model generation.
const config = readConfig(false);
let failed = false;
async function check(label: string, fn: () => Promise<string>) {
  try {
    console.log(`${label}: OK - ${await fn()}`);
    return true;
  } catch (e) {
    failed = true;
    console.log(`${label}: ${errorCode(e)}`);
    return false;
  }
}
await check('Model', async () => {
  if (config.agentMode === 'gemini') {
    if (!config.geminiKey) throw new Error('GEMINI_API_KEY_REQUIRED');
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}`,
      {
        headers: { 'x-goog-api-key': config.geminiKey },
        redirect: 'error',
        signal: AbortSignal.timeout(20000),
      },
    );
    await r.body?.cancel();
    if (!r.ok) throw new Error(`GEMINI_HTTP_${r.status}`);
    return `${config.model} accessible. Run npm run check:model to test tool calling.`;
  }
  if (config.agentMode === 'openrouter') {
    if (!config.openrouterKey) throw new Error('OPENROUTER_API_KEY_REQUIRED');
    const r = await fetch('https://openrouter.ai/api/v1/key', {
      headers: { Authorization: `Bearer ${config.openrouterKey}` },
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    });
    await r.body?.cancel();
    if (!r.ok) throw new Error(`OPENROUTER_HTTP_${r.status}`);
    return `OpenRouter key hop le; model ${config.model} (chua kiem tra generation/quota)`;
  }
  if (!config.openaiKey) throw new Error('OPENAI_API_KEY_REQUIRED');
  const r = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(config.model)}`, {
    headers: { Authorization: `Bearer ${config.openaiKey}` },
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  });
  await r.body?.cancel();
  if (!r.ok) throw new Error(`OPENAI_HTTP_${r.status}`);
  return `${config.model} (co quyen truy cap; chua goi sinh noi dung)`;
});
await check('Binance market', async () => {
  const r = await fetch('https://data-api.binance.vision/api/v3/ticker/24hr?symbol=ETHUSDT', {
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  });
  await r.body?.cancel();
  if (!r.ok) throw new Error(`BINANCE_MARKET_HTTP_${r.status}`);
  return 'ETHUSDT';
});
// Keep phases separate: a login error must not look like a merchant rejection.
const walletReady = await check('Agentic Wallet status', async () => {
  const run = cliRunner(config.bawCliJs);
  const s = (await run(['wallet', 'status'])) as { success?: boolean; data?: { status?: string } };
  if (!s.success || s.data?.status !== 'CONNECTED') throw new Error('WALLET_NOT_CONNECTED');
  return 'CONNECTED';
});
const resource = cmcResource('ETH');
let payload: unknown;
const merchantReady = await check('CMC payment requirements', async () => {
  const r = await fetch(resource, { redirect: 'error', signal: AbortSignal.timeout(20_000) });
  if (r.status !== 402) {
    await r.body?.cancel();
    throw new Error(`CMC_EXPECTED_402_GOT_${r.status}`);
  }
  const header = r.headers.get('PAYMENT-REQUIRED');
  if (header) {
    await r.body?.cancel();
    if (header.length > 24_000) throw new Error('PAYMENT_REQUIREMENTS_TOO_LARGE');
    payload = JSON.parse(Buffer.from(header, 'base64').toString());
  } else payload = await boundedJson(r);
  return 'HTTP 402 received (expected for a paid endpoint)';
});
if (walletReady && merchantReady) await check('Agentic Wallet preview', async () => {
  const run = cliRunner(config.bawCliJs);
  const adapter = new BinancePaymentAdapter(run, realPolicies, false);
  await adapter.preview(payload, realServices[0]!, resource);
  return 'READY_TO_SIGN: CMC 0.01 USDC / Base (preview only)';
});
else console.log('Agentic Wallet preview: SKIPPED - wallet or CMC requirements check failed');
console.log('Khong ky/thanh toan, khong goi model generation.');
if (failed) process.exitCode = 1;
