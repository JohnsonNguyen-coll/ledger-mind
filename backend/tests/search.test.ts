import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MarketSearch } from '../src/services/market-search.js';
import { AgentRunner } from '../src/agent/runner.js';
import { GeminiProvider } from '../src/agent/gemini.js';
import { toolsForServices, type Provider } from '../src/agent/provider.js';
import { Store } from '../src/store.js';
import { PaymentGateway } from '../src/payments/gateway.js';
import { MockPaymentAdapter } from '../src/payments/mock.js';
import { startSystem } from '../src/system.js';
import { testConfig } from './helpers.js';

test('catalog discovers arbitrary exchange assets; quotes check exact pair and reject URL injection', async () => {
  let catalogs = 0;
  const search = new MarketSearch(async (url) => {
    if (String(url).includes('exchangeInfo')) {
      catalogs++;
      return Response.json({ symbols: [
        { symbol: 'NEWTOKENUSDT', baseAsset: 'NEWTOKEN', quoteAsset: 'USDT', status: 'TRADING' },
        { symbol: 'NEWTOKENBTC', baseAsset: 'NEWTOKEN', quoteAsset: 'BTC', status: 'BREAK' },
      ] });
    }
    return Response.json({ symbol: 'NEWTOKENUSDT', lastPrice: '2.5', priceChangePercent: '1', quoteVolume: '2000', closeTime: Date.now() });
  });
  assert.equal((await search.search('NEWTOKEN')).matches.length, 1);
  assert.equal((await search.search('no-such-asset')).totalMatches, 0);
  assert.equal(catalogs, 1);
  assert.equal((await search.quote('NEWTOKEN')).symbol, 'NEWTOKEN');
  await assert.rejects(search.quote('../evil?symbol=ETH'));
  await assert.rejects(search.quote('ETH')); // Provider returning another pair is rejected.
});

test('dynamic runner keeps different symbols distinct and reuses normalized duplicate calls', async () => {
  const config = testConfig({ marketMode: 'binance' });
  const store = new Store(':memory:', { wallet: config.wallet, maxPayment: config.maxPayment, dailyBudget: config.dailyBudget });
  const gateway = new PaymentGateway(store, new MockPaymentAdapter('test'));
  const fetched: string[] = [];
  const market = new MarketSearch(async url => {
    const pair = new URL(String(url)).searchParams.get('symbol')!;
    fetched.push(pair);
    return Response.json({ symbol: pair, lastPrice: pair === 'SUIUSDT' ? '3' : '1', priceChangePercent: '2', quoteVolume: '300', closeTime: Date.now() });
  });
  let turn = 0;
  const provider: Provider = { async next(obs) {
    if (!turn++) return { calls: [
      { id: '1', name: 'get_market', arguments: '{"symbol":"SUI","quoteAsset":"USDT"}' },
      { id: '2', name: 'get_market', arguments: '{"symbol":"ADA","quoteAsset":"USDT"}' },
      { id: '3', name: 'get_market', arguments: '{"quoteAsset":"usdt","symbol":"sui"}' },
    ] };
    assert.equal((obs[0]!.output as any).data.symbol, 'SUI');
    assert.equal((obs[1]!.output as any).data.symbol, 'ADA');
    assert.deepEqual(obs[2]!.output, obs[0]!.output);
    return { calls: [], text: 'Compared the requested SUI and ADA snapshots.' };
  } };
  try {
    const task = store.createTask({ requestKey: randomUUID(), prompt: 'Compare SUI and ADA', symbol: 'AUTO', budget: 0 }).task;
    const runner = new AgentRunner(config, store, gateway, [], market);
    runner.start(task, provider); await runner.idle();
    assert.equal(store.getTask(task.id).status, 'completed');
    assert.deepEqual(fetched, ['SUIUSDT', 'ADAUSDT']);
    assert.equal(store.payments().length, 0);
  } finally { store.close(); }
});

test('new task API requires no selected asset, preserves idempotency and runs local SOL fixture', async () => {
  const system = await startSystem(testConfig());
  try {
    const { csrfToken } = await (await fetch(system.url + '/api/config')).json() as { csrfToken: string };
    const payload = { requestKey: randomUUID(), prompt: 'Research Solana', budgetUsd: '0' };
    const post = () => fetch(system.url + '/api/tasks', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-LedgerMind-Token': csrfToken }, body: JSON.stringify(payload) });
    const response = await post(); assert.equal(response.status, 202);
    const { taskId } = await response.json() as { taskId: string };
    await system.runner.idle();
    assert.equal(system.store.getTask(taskId).symbol, 'AUTO');
    assert.equal(system.store.getTask(taskId).status, 'completed');
    assert.ok(system.store.getTask(taskId).result?.includes('SOL'));
    assert.equal((await post()).status, 200);
    const html = await (await fetch(system.url)).text();
    assert.ok(!html.includes('id="symbol"'));
    assert.equal(system.store.payments().length, 0);
  } finally { await system.close(); }
});

test('Gemini receives actual dynamic argument schemas including symbols and quote currency', async () => {
  const task = { id: 'test', requestKey: randomUUID(), prompt: 'Research SUI', symbol: 'AUTO', budget: 0,
    status: 'running' as const, createdAt: new Date().toISOString(), result: null, error: null };
  const provider = new GeminiProvider(task, 'test', 'gemini-2.5-flash', async (_url, init) => {
    const declarations = JSON.parse(String(init?.body)).tools[0].functionDeclarations;
    assert.deepEqual(declarations.find((t: any) => t.name === 'get_market').parametersJsonSchema.required, ['symbol', 'quoteAsset']);
    assert.ok(declarations.find((t: any) => t.name === 'search_assets').parametersJsonSchema.properties.query);
    return Response.json({ candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ functionCall: { name: 'get_market', args: { symbol: 'SUI', quoteAsset: 'USDT' } } }] } }] });
  }, toolsForServices([], true));
  assert.deepEqual(JSON.parse((await provider.next([])).calls[0]!.arguments), { symbol: 'SUI', quoteAsset: 'USDT' });
});
