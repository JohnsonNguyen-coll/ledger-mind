import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.js';
import { PaymentGateway } from '../src/payments/gateway.js';
import { BinancePaymentAdapter } from '../src/payments/binance.js';
import { realServices, realPolicies } from '../src/services/registry.js';
import { cmcData, cmcResource, CMC_ORIGIN, CMC_PATH } from '../src/services/cmc.js';
import { OpenAIProvider, toolsForServices } from '../src/agent/provider.js';
import { AgentRunner } from '../src/agent/runner.js';
import { testConfig } from './helpers.js';
import { usdCeiling } from '../src/money.js';
import { merchantErrorCategory } from '../src/payments/merchant-error.js';
import { createApp } from '../src/app.js';
import { listen, address } from '../src/services/server.js';

const policy = realPolicies[0]!;
const accept = {
  scheme: 'exact',
  network: policy.network,
  asset: policy.asset,
  payTo: policy.payTo,
  amount: '10000',
  extra: { name: 'USD Coin', version: '2', assetTransferMethod: 'eip3009' },
};
const challenge = { x402Version: 2, resource: { url: CMC_ORIGIN + CMC_PATH }, accepts: [accept] };
const cmcBody = {
  status: { error_code: 0 },
  data: {
    '1027': {
      id: 1027,
      symbol: 'ETH',
      quote: {
        USD: {
          price: 2500.75,
          volume_24h: 100000,
          percent_change_24h: 1.2,
          market_cap: 2000000,
          last_updated: '2026-09-03T00:00:00.000Z',
        },
      },
    },
  },
};
const preview = () => ({
  success: true,
  data: {
    paymentId: randomUUID(),
    options: [
      {
        index: 3,
        status: 'READY_TO_SIGN',
        needApproveFirst: false,
        originalAccept: accept,
        amountUsd: '0.0099987902292164280000',
        assetTransferMethod: 'eip3009',
        binanceChainId: '8453',
        tokenAddress: policy.asset,
        payTo: policy.payTo,
      },
    ],
  },
});

test('live CMC parser: real object and single-element array, wrong symbol/id rejected', () => {
  const data = cmcData(cmcBody, 'ETH');
  assert.equal(data.fixture, false);
  assert.equal(data.metrics.priceUsd, 2500.75);
  assert.equal(
    cmcData({ ...cmcBody, data: { '1027': [cmcBody.data['1027']] } }, 'ETH').symbol,
    'ETH',
  );
  assert.throws(() => cmcData(cmcBody, 'BTC'));
  assert.throws(() => cmcData({ ...cmcBody, status: { error_code: 1001 } }, 'ETH'));
  assert.equal(cmcResource('ETH'), CMC_ORIGIN + CMC_PATH + '?id=1027');
});

test('real wallet long decimal estimate and queryless CMC resource accepted, other paths rejected', async () => {
  assert.equal(usdCeiling('0.0099987902292164280000'), 9999);
  const a = new BinancePaymentAdapter(async () => preview(), realPolicies);
  assert.equal((await a.preview(challenge, realServices[0]!, cmcResource('ETH'))).amount, 10000);
  await assert.rejects(
    a.preview(
      { ...challenge, resource: { url: CMC_ORIGIN + '/wrong' } },
      realServices[0]!,
      cmcResource('ETH'),
    ),
  );
  for (const alteration of [
    { amount: '10001' },
    { payTo: '0x' + '0'.repeat(40) },
    { extra: { name: 'Fake', version: '2' } },
  ])
    await assert.rejects(
      a.preview(
        { ...challenge, accepts: [{ ...accept, ...alteration }] },
        realServices[0]!,
        cmcResource('ETH'),
      ),
    );
  const tools = toolsForServices(realServices);
  assert.deepEqual(
    tools.map((t) => t.name),
    ['get_market', 'get_budget', 'compare_markets', 'get_spending_summary', 'buy_cmc_quote'],
  );
});

for (const [budget, behavior] of [
  [10000, 'success'],
  [5000, 'blocked'],
  [10000, 'timeout'],
] as const) {
  test(`OpenAI tool loop -> Binance x402 -> budget/audit: ${behavior} (all upstreams stubbed)`, async () => {
    const config = testConfig({
      paymentMode: 'binance',
      realEnabled: true,
      agentMode: 'openai',
      maxPayment: 10000,
    });
    const store = new Store(':memory:', { wallet: 100000, maxPayment: 10000, dailyBudget: 100000 });
    let signs = 0,
      paidRequests = 0;
    const tx = '0x' + 'a'.repeat(64);
    const adapter = new BinancePaymentAdapter(
      async (args) => {
        if (args[1] === 'preview') return preview();
        signs++;
        assert.equal(store.totals().held, 10000);
        assert.deepEqual(args.slice(-2), ['--selectedIndex', '3']);
        return {
          success: true,
          data: {
            paymentHeaderName: 'PAYMENT-SIGNATURE',
            paymentHeaderValue: 'TEST_SIGNATURE',
            approveTxHash: null,
            signatureExpiresAt: Math.floor(Date.now() / 1000) + 60,
          },
        };
      },
      realPolicies,
      true,
    );
    const gateway = new PaymentGateway(store, adapter, async (url, init) => {
      assert.equal(url, cmcResource('ETH'));
      assert.equal(init?.redirect, 'error');
      if (!new Headers(init?.headers).has('PAYMENT-SIGNATURE'))
        return Response.json(challenge, { status: 402 });
      paidRequests++;
      if (behavior === 'timeout') throw new Error('TIMEOUT');
      return Response.json(cmcBody, {
        headers: {
          'PAYMENT-RESPONSE': Buffer.from(
            JSON.stringify({
              success: true,
              network: policy.network,
              transaction: tx,
            }),
          ).toString('base64'),
        },
      });
    });
    const task = store.createTask({
      requestKey: randomUUID(),
      prompt: 'Mua CMC ETH',
      symbol: 'ETH',
      budget,
    }).task;
    let decisions = 0;
    const provider = new OpenAIProvider(
      task,
      'TEST_KEY_ONLY',
      config.model,
      async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        assert.deepEqual(
          body.tools.map((t: { name: string }) => t.name),
          ['get_market', 'get_budget', 'compare_markets', 'get_spending_summary', 'buy_cmc_quote'],
        );
        assert.ok(!JSON.stringify(body.input).includes('TEST_SIGNATURE'));
        decisions++;
        // Model gọi cùng tool hai lần: executor phải dùng lại kết quả hoặc lỗi.
        return Response.json({
          status: 'completed',
          output:
            decisions <= 2
              ? [
                  {
                    type: 'function_call',
                    call_id: `call_${decisions}`,
                    name: 'buy_cmc_quote',
                    arguments: '{}',
                  },
                ]
              : [
                  {
                    type: 'message',
                    content: [
                      { type: 'output_text', text: 'Báo cáo kiểm thử từ dữ liệu đã nhận.' },
                    ],
                  },
                ],
          usage: { input_tokens: 5, output_tokens: 10 },
        });
      },
      toolsForServices(realServices),
    );
    try {
      const runner = new AgentRunner(config, store, gateway, realServices);
      runner.start(task, provider);
      await runner.idle();
      assert.equal(store.getTask(task.id).status, 'completed');
      assert.equal(signs, behavior === 'blocked' ? 0 : 1);
      assert.equal(paidRequests, signs);
      assert.equal(store.totals().spent, behavior === 'success' ? 10000 : 0);
      assert.equal(store.totals().held, behavior === 'timeout' ? 10000 : 0);
      if (behavior === 'success') {
        assert.equal(store.payments()[0]?.receiptId, tx);
        assert.equal(JSON.parse(store.payments()[0]!.data!).source, 'CoinMarketCap quotes (x402)');
      }
      assert.ok(store.verifyAudit());
      assert.ok(!JSON.stringify(store.audit()).includes('TEST_SIGNATURE'));
      assert.ok(!JSON.stringify(store.audit()).includes('TEST_KEY_ONLY'));
    } finally {
      store.close();
    }
  });
}

test('live HTTP consent is required and recorded; zero budget cannot sign', async () => {
  const config = testConfig({ paymentMode: 'binance', realEnabled: true, maxPayment: 10000 });
  const store = new Store(':memory:', { wallet: 100000, maxPayment: 10000, dailyBudget: 100000 });
  let signs = 0;
  const adapter = new BinancePaymentAdapter(
    async (args) => {
      if (args[1] !== 'preview') signs++;
      return preview();
    },
    realPolicies,
    true,
  );
  const gateway = new PaymentGateway(store, adapter, async () =>
    Response.json(challenge, { status: 402 }),
  );
  const runner = new AgentRunner(config, store, gateway, realServices);
  const server = await listen(createApp(config, store, runner, realServices), 0);
  const url = address(server);
  try {
    const conf = (await (await fetch(url + '/api/config')).json()) as {
      csrfToken: string;
      services: unknown[];
    };
    assert.equal(conf.services.length, 1);
    const post = (consent: boolean, budgetUsd = '0') =>
      fetch(url + '/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-AlphaMesh-Token': conf.csrfToken },
        body: JSON.stringify({
          requestKey: randomUUID(),
          prompt: 'Mua CMC',
          symbol: 'ETH',
          budgetUsd,
          authorizeRealPayments: consent,
        }),
      });
    assert.equal((await post(false, '0.01')).status, 403);
    assert.equal((await post(false)).status, 202);
    assert.equal((await post(true, '0.005')).status, 202);
    await runner.idle();
    assert.equal(signs, 0);
    assert.ok(store.audit().some((e) => e.type === 'payment.consent'));
    assert.ok(store.audit().some((e) => e.type === 'payment.blocked'));
  } finally {
    server.closeIdleConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  }
});


test('merchant rejects a signed request: retain hold, report HTTP 402, redact body and never replay again', async () => {
  const store = new Store(':memory:', {wallet:100000,maxPayment:10000,dailyBudget:100000});
  let signs = 0, requests = 0;
  const adapter = new BinancePaymentAdapter(async args => {
    if (args[1] === 'preview') return preview();
    signs++;
    return {success:true,data:{paymentHeaderName:'PAYMENT-SIGNATURE',paymentHeaderValue:'PRIVATE_SIGNATURE',approveTxHash:null,signatureExpiresAt:Math.floor(Date.now()/1000)+60}};
  }, realPolicies, true);
  const gateway = new PaymentGateway(store, adapter, async () => ++requests === 1 ? Response.json(challenge,{status:402}) : Response.json({error:'invalid signature PRIVATE_SIGNATURE',session:'PRIVATE_SESSION'},{status:402}));
  try {
    const task = store.createTask({requestKey:randomUUID(),prompt:'Purchase ETH',symbol:'ETH',budget:10000}).task;
    await assert.rejects(gateway.purchase(task,realServices[0]!), /MERCHANT_PAYMENT_REJECTED_402/);
    assert.equal(store.totals().held,10000);
    assert.equal(store.totals().spent,0);
    const audit=store.audit(task.id);
    assert.equal(JSON.parse(audit.find(e=>e.type==='payment.merchant_rejected')!.detail).category,'SIGNATURE_REJECTED');
    assert.ok(!JSON.stringify(audit).includes('PRIVATE_'));
    await assert.rejects(gateway.purchase(task,realServices[0]!), /PAYMENT_ALREADY_ATTEMPTED/);
    assert.equal(signs,1); assert.equal(requests,2);
  } finally {store.close();}
});

test('merchant failure category never echoes raw messages',()=>{
  assert.equal(merchantErrorCategory({error:'Missing accepted in PAYMENT-SIGNATURE payload (x402 V2)'}),'MISSING_ACCEPTED');
  assert.equal(merchantErrorCategory({error:'insufficient balance for SECRET'}),'INSUFFICIENT_FUNDS');
  assert.equal(merchantErrorCategory({message:'PRIVATE_SESSION'}),'UNSPECIFIED');
  assert.equal(merchantErrorCategory(null),'UNSPECIFIED');
});
