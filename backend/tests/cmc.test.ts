import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  buyCmcOnce,
  cmcPurchase,
  selectCmcOption,
  validateCmcChallenge,
} from '../src/payments/cmc-demo.js';

const accept = {
  scheme: 'exact',
  network: cmcPurchase.network,
  asset: cmcPurchase.asset,
  payTo: cmcPurchase.payTo,
  amount: cmcPurchase.amount,
  extra: { name: 'USD Coin', version: '2' },
};
const challenge = {
  x402Version: 2,
  resource: { url: cmcPurchase.url.split('?')[0] },
  accepts: [accept],
};
const option = {
  index: 4,
  status: 'READY_TO_SIGN',
  needApproveFirst: false,
  assetTransferMethod: 'eip3009',
  binanceChainId: '8453',
  tokenAddress: cmcPurchase.asset,
  payTo: cmcPurchase.payTo,
  amount: '0.010000',
  amountUsd: '0.0099987902292164280000',
  originalAccept: accept,
};
const preview = (candidate: unknown = option) => ({
  success: true,
  data: { paymentId: randomUUID(), options: [candidate] },
});

test('CMC pins recipient, atomic price, token, network and resource; allows path-only merchant URL', () => {
  assert.equal(validateCmcChallenge(challenge), challenge);
  assert.doesNotThrow(() =>
    validateCmcChallenge({
      ...challenge,
      resource: { url: '/x402/v3/cryptocurrency/quotes/latest' },
    }),
  );
  for (const mutation of [
    { payTo: '0x' + '0'.repeat(40) },
    { amount: '10001' },
    { asset: '0x' + '1'.repeat(40) },
    { network: 'eip155:56' },
  ]) {
    assert.throws(() =>
      validateCmcChallenge({ ...challenge, accepts: [{ ...accept, ...mutation }] }),
    );
  }
  for (const url of ['https://evil.example/', cmcPurchase.url.replace('1027', '1')])
    assert.throws(() => validateCmcChallenge({ ...challenge, resource: { url } }));
});

test('CMC selects by pinned fields instead of position, rejects approvals; accepts real long USD estimate', () => {
  assert.equal(selectCmcOption(preview()).index, 4);
  for (const mutation of [
    { needApproveFirst: true },
    { status: 'ACTION_REQUIRED' },
    { assetTransferMethod: 'permit2' },
    { amount: '0.02' },
    { binanceChainId: '56' },
  ]) {
    assert.throws(() => selectCmcOption(preview({ ...option, ...mutation })));
  }
});

for (const mode of ['success', 'timeout', 'missing_receipt', 'data_failure'] as const) {
  test(`CMC one-shot ${mode}: journal survives and prevents another charge`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'alphamesh-cmc-'));
    let httpCalls = 0;
    let signs = 0;
    const tx = '0x' + 'a'.repeat(64);
    const run = async (args: string[]) => {
      if (args[0] === 'wallet') return { success: true, data: { status: 'CONNECTED' } };
      if (args[1] === 'preview') return preview();
      signs++;
      assert.deepEqual(args.slice(-2), ['--selectedIndex', '4']);
      assert.match(
        await readFile(join(directory, 'cmc-first-payment.jsonl'), 'utf8'),
        /signing_started/,
      );
      return {
        success: true,
        data: {
          paymentHeaderName: 'PAYMENT-SIGNATURE',
          paymentHeaderValue: 'TEST_SIGNATURE',
          approveTxHash: null,
          signatureExpiresAt: Math.floor(Date.now() / 1000) + 60,
        },
      };
    };
    const fetcher: typeof fetch = async (url, init) => {
      httpCalls++;
      assert.equal(url, cmcPurchase.url);
      assert.equal(init?.redirect, 'error');
      if (httpCalls === 1) return Response.json(challenge, { status: 402 });
      assert.equal(new Headers(init?.headers).get('PAYMENT-SIGNATURE'), 'TEST_SIGNATURE');
      if (mode === 'timeout') throw new Error('NETWORK_TIMEOUT');
      const headers: Record<string, string> =
        mode === 'missing_receipt'
          ? {}
          : {
              'PAYMENT-RESPONSE': Buffer.from(
                JSON.stringify({
                  success: true,
                  network: cmcPurchase.network,
                  transaction: tx,
                }),
              ).toString('base64'),
            };
      return Response.json(
        mode === 'data_failure'
          ? {}
          : { status: { error_code: 0 }, data: { '1027': { symbol: 'ETH' } } },
        { headers },
      );
    };
    try {
      const deps = { confirmed: true, run, directory, fetcher };
      await assert.rejects(buyCmcOnce({ ...deps, confirmed: false }), /CONFIRMATION_REQUIRED/);
      assert.equal(httpCalls, 0);
      if (mode === 'success') assert.equal((await buyCmcOnce(deps)).transaction, tx);
      else await assert.rejects(buyCmcOnce(deps), /CHECK_AUDIT/);
      await assert.rejects(buyCmcOnce(deps), /PAYMENT_ATTEMPT_EXISTS/);
      assert.equal(signs, 1);
      assert.equal(httpCalls, 2);
      const journal = await readFile(join(directory, 'cmc-first-payment.jsonl'), 'utf8');
      assert.ok(!journal.includes('TEST_SIGNATURE'));
      assert.ok(!journal.includes('paymentId'));
      if (mode === 'success') assert.match(journal, /completed/);
      if (mode === 'data_failure') assert.match(journal, /settlement_reported_data_incomplete/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
