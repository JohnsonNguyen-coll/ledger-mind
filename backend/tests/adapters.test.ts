import { DefinitelyUnpaidError } from '../src/payments/adapter.js';
import { completeX402Envelope } from '../src/payments/x402-envelope.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, verify } from 'node:crypto';
import { BinancePaymentAdapter, cliRunner, bawCommandError, type MerchantPolicy } from '../src/payments/binance.js';
import { signReceipt, verifyReceipt } from '../src/payments/mock.js';
import { signedB402Request } from '../src/payments/b402.js';
import { OpenAIProvider } from '../src/agent/provider.js';
import type { Payment, Service, Task } from '../src/types.js';
const resource = 'https://merchant.example/data/ETH';
const service: Service = {
  id: 'whale',
  title: 'Whale',
  description: '',
  price: 30_000,
  baseUrl: 'https://merchant.example',
  protocol: 'x402',
};
// Test-only addresses: never use these values for a live merchant.
const policy: MerchantPolicy = {
  serviceId: 'whale',
  origin: 'https://merchant.example',
  network: 'eip155:8453',
  asset: '0x' + '1'.repeat(40),
  payTo: '0x' + '2'.repeat(40),
  tokenAmount: '30000',
  maxUsd: 30_000,
};
const accept = {
  scheme: 'exact',
  network: policy.network,
  asset: policy.asset,
  payTo: policy.payTo,
  amount: '30000',
};
const challenge = { x402Version: 2, resource: { url: resource }, accepts: [accept] };
const preview = () => ({
  success: true,
  data: {
    paymentId: randomUUID(),
    options: [
      {
        index: 2,
        status: 'READY_TO_SIGN',
        needApproveFirst: false,
        amountUsd: '0.03',
        originalAccept: accept,
      },
    ],
  },
});
const payment: Payment = {
  id: randomUUID(),
  taskId: randomUUID(),
  serviceId: 'whale',
  resource,
  amount: 30_000,
  state: 'reserved',
  day: '2026-09-03',
  receiptId: null,
  data: null,
};
test('V2 missing accepted: restore only the matching EIP3009 offer without changing signed fields', async () => {
  const offer = {...accept, maxTimeoutSeconds:30, extra:{name:'USD Coin',version:'2',assetTransferMethod:'eip3009',x402PaymentConfigId:'test-config'}};
  const signed = {x402Version:2,payload:{signature:'0x'+'a'.repeat(130),authorization:{from:'0x'+'3'.repeat(40),to:offer.payTo,value:offer.amount,validAfter:'100',validBefore:'130',nonce:'0x'+'4'.repeat(64)}}};
  const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64');
  const result = completeX402Envelope(encode(signed),offer);
  assert.equal(result.diagnostic,'MISSING_ACCEPTED_RESTORED');
  const decoded = JSON.parse(Buffer.from(result.header,'base64').toString());
  assert.deepEqual(decoded.payload,signed.payload);
  assert.deepEqual(decoded.accepted,offer);
  assert.equal(completeX402Envelope(result.header,offer).header,result.header);
  assert.throws(()=>completeX402Envelope(encode(signed),{...offer,amount:'90000'}),/CANNOT_REPAIR/);
  assert.throws(()=>completeX402Envelope(encode(signed),{...offer,payTo:'0x'+'5'.repeat(40)}),/CANNOT_REPAIR/);
  assert.throws(()=>completeX402Envelope(encode(signed),{...offer,network:'eip155:56'}),/CANNOT_REPAIR/);
  assert.throws(()=>completeX402Envelope(encode({...signed,payload:{signature:'secret'}}),offer),/CANNOT_REPAIR/);
  assert.equal(completeX402Envelope(encode({...signed,x402Version:1}),offer).diagnostic,'NON_V2_ENVELOPE');
  assert.equal(completeX402Envelope('not-json',offer).diagnostic,'UNRECOGNIZED_ENVELOPE');
  const adapter = new BinancePaymentAdapter(async args => args[1] === 'preview'
    ? {success:true,data:{paymentId:randomUUID(),options:[{index:1,status:'READY_TO_SIGN',needApproveFirst:false,amountUsd:'0.03',originalAccept:offer}]}}
    : {success:true,data:{paymentHeaderName:'PAYMENT-SIGNATURE',paymentHeaderValue:encode(signed),approveTxHash:null,signatureExpiresAt:Math.floor(Date.now()/1000)+60}},[policy],true);
  const quote=await adapter.preview({...challenge,accepts:[offer]},service,resource);
  const auth=await adapter.authorize(quote,payment);
  assert.equal(auth.diagnostic,'MISSING_ACCEPTED_RESTORED');
  assert.deepEqual(JSON.parse(Buffer.from(auth.headers['PAYMENT-SIGNATURE']!,'base64').toString()).accepted,offer);
});
test('Binance exact documented CLI flow, one-based option index, settlement receipt', async () => {
  const calls: string[][] = [];
  const adapter = new BinancePaymentAdapter(
    async (args) => {
      calls.push(args);
      return args[1] === 'preview'
        ? preview()
        : {
            success: true,
            data: {
              paymentHeaderName: 'PAYMENT-SIGNATURE',
              paymentHeaderValue: 'TEST_ONLY_SIGNATURE',
              approveTxHash: null,
              signatureExpiresAt: Math.floor(Date.now() / 1000) + 60,
            },
          };
    },
    [policy],
    true,
  );
  const quote = await adapter.preview(challenge, service, resource);
  const auth = await adapter.authorize(quote, payment);
  assert.equal(quote.amount, 30_000);
  assert.equal(auth.settled, false);
  assert.deepEqual(calls[1]?.slice(-2), ['--selectedIndex', '2']);
  assert.equal(auth.headers['PAYMENT-SIGNATURE'], 'TEST_ONLY_SIGNATURE');
  const tx = '0x' + 'a'.repeat(64);
  const response = new Response('{}', {
    headers: {
      'PAYMENT-RESPONSE': Buffer.from(
        JSON.stringify({ success: true, network: policy.network, transaction: tx }),
      ).toString('base64'),
    },
  });
  assert.equal(adapter.settlement(response, quote).receiptId, tx);
  assert.throws(() => adapter.settlement(new Response('{}'), quote), /MISSING_SETTLEMENT_PROOF/);
});
test('Binance guards: wrong recipient, unsafe origin, unsupported network, approval, excessive price and disabled signing', async () => {
  let calls = 0;
  const adapter = new BinancePaymentAdapter(async () => {
    calls++;
    return preview();
  }, [policy]);
  await assert.rejects(
    adapter.preview(
      { ...challenge, accepts: [{ ...accept, payTo: '0x' + '3'.repeat(40) }] },
      service,
      resource,
    ),
    /NOT_ALLOWED/,
  );
  assert.equal(calls, 0);
  await assert.rejects(
    adapter.preview(challenge, service, 'http://127.0.0.1/data/ETH'),
    /MERCHANT_NOT_ALLOWED/,
  );
  assert.throws(
    () => new BinancePaymentAdapter(async () => ({}), [{ ...policy, network: 'eip155:1' }]),
    /INVALID_MERCHANT_POLICY/,
  );
  const quote = await adapter.preview(challenge, service, resource);
  await assert.rejects(adapter.authorize(quote, payment), /REAL_PAYMENTS_DISABLED/);
  assert.equal(calls, 1);
  for (const change of [
    { needApproveFirst: true },
    { status: 'NOT_SIGNABLE' },
    { amountUsd: '0.04' },
  ]) {
    const a = new BinancePaymentAdapter(async () => {
      const p = preview();
      Object.assign(p.data.options[0]!, change);
      return p;
    }, [policy]);
    await assert.rejects(a.preview(challenge, service, resource));
  }
  assert.throws(() => cliRunner('baw.cmd'), /ABSOLUTE_JS_PATH/);
});
test('Binance settlement must report the exact selected network', async () => {
  const adapter = new BinancePaymentAdapter(async () => preview(), [policy]);
  const quote = await adapter.preview(challenge, service, resource);
  const header = Buffer.from(
    JSON.stringify({ success: true, network: 'eip155:56', transaction: '0x' + 'a'.repeat(64) }),
  ).toString('base64');
  assert.throws(
    () =>
      adapter.settlement(new Response('{}', { headers: { 'PAYMENT-RESPONSE': header } }), quote),
    /INVALID_SETTLEMENT_PROOF/,
  );
});
test('mock receipt: tampering, wrong secret, expiry rejected', () => {
  const value = {
    paymentId: randomUUID(),
    taskId: randomUUID(),
    resource,
    serviceId: 'whale',
    amount: 30_000,
    expiresAt: Date.now() + 60_000,
  };
  const token = signReceipt(value, 'secret');
  assert.equal(verifyReceipt(token, 'secret').amount, 30_000);
  assert.throws(() => verifyReceipt(token, 'wrong'));
  assert.throws(() => verifyReceipt('x' + token, 'secret'));
  assert.throws(
    () => verifyReceipt(signReceipt({ ...value, expiresAt: 0 }, 'secret'), 'secret'),
    /RECEIPT_EXPIRED/,
  );
});
test('B402 signature verifies the exact UTF-8 body plus millisecond timestamp', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privateKeyBase64 = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
  const req = signedB402Request(
    { note: 'Test Note', amount: '30000' },
    { clientId: 'test', accessToken: 'test', privateKeyBase64 },
    1788400000000,
  );
  const signature = Buffer.from(req.headers['X-Tesla-Signature'], 'base64');
  assert.ok(
    verify(
      'RSA-SHA256',
      Buffer.from(req.body + req.headers['X-Tesla-Timestamp']),
      publicKey,
      signature,
    ),
  );
  assert.equal(verify('RSA-SHA256', Buffer.from(req.body + '0'), publicKey, signature), false);
});
test('OpenAI Responses: function call outputs carried to next request, secrets excluded from history', async () => {
  const task: Task = {
    id: randomUUID(),
    requestKey: randomUUID(),
    prompt: 'Research ETH',
    symbol: 'ETH',
    budget: 200_000,
    status: 'running',
    createdAt: new Date().toISOString(),
    result: null,
    error: null,
  };
  const bodies: Record<string, unknown>[] = [];
  const fetcher = (async (_url: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({
      status: 'completed',
      output:
        bodies.length === 1
          ? [{ type: 'function_call', call_id: 'call_1', name: 'get_market', arguments: '{}' }]
          : [{ type: 'message', content: [{ type: 'output_text', text: 'Report from tool.' }] }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
  }) as typeof fetch;
  const provider = new OpenAIProvider(task, 'test-key', 'gpt-4.1-mini', fetcher);
  const first = await provider.next([]);
  assert.equal(first.calls[0]?.name, 'get_market');
  const last = await provider.next([
    { call: first.calls[0]!, output: { data: { fixture: true } } },
  ]);
  assert.equal(last.text, 'Report from tool.');
  assert.ok(JSON.stringify(bodies[1]).includes('function_call_output'));
  assert.ok(!JSON.stringify(bodies).includes('test-key'));
  assert.equal(bodies[0]?.store, false);
});


test('CLI classifies only proven local login failure as unpaid; preserves unknown timeouts and redacts secrets', () => {
  const body = JSON.stringify({ success: false, error: { code: 10003000, name: 'NOT_LOGGED_IN', message: 'SECRET', data: { session: 'SECRET' } } });
  const error = bawCommandError({ code: 1 }, body);
  assert.ok(error instanceof DefinitelyUnpaidError);
  assert.equal(error.message, 'BAW_NOT_LOGGED_IN');
  assert.ok(!(bawCommandError({ killed: true }, body) instanceof DefinitelyUnpaidError));
  assert.equal(bawCommandError({ killed: true }, body).message, 'BAW_COMMAND_TIMED_OUT');
  assert.equal(bawCommandError({ code: 1 }, 'raw SECRET').message, 'BAW_COMMAND_FAILED');
  const walletError = bawCommandError({ code: 1 }, JSON.stringify({success:false,error:{name:'WALLET_API_ERROR',message:'SECRET',data:{session:'SECRET'}}}));
  assert.equal(walletError.message, 'BAW_WALLET_API_ERROR');
  assert.ok(!(walletError instanceof DefinitelyUnpaidError));
  assert.ok(!(bawCommandError({ code: 1 }, JSON.stringify({success:false,error:{name:'UNAUTHORIZED'}})) instanceof DefinitelyUnpaidError));
});
