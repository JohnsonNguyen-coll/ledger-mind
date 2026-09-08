import type { Express, Request } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { recoverTypedDataAddress, type Hex } from 'viem';
import type { Store } from '../store.js';
import type { Config } from '../config.js';
import { boundedJson } from './gateway.js';
import { CMC_ORIGIN, CMC_PATH, CMC_RECIPIENT, CMC_USDC_BASE, cmcData, cmcResource } from '../services/cmc.js';

const address = z.string().regex(/^0x[\da-fA-F]{40}$/);
const symbolSchema = z.enum(['ETH', 'BTC', 'BNB', 'SOL']);
const transferTypes = { TransferWithAuthorization: [
  { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
  { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
] } as const;
const domain = { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: CMC_USDC_BASE } as const;
const fee = 10000;
type Row = { id: string; reportId: string; payer: string; symbol: z.infer<typeof symbolSchema>; status: string; quote: string; result: string | null; createdAt: string; submittedAt: string | null };
type Quote = { id: string; reportId: string; payer: string; symbol: z.infer<typeof symbolSchema>; expiresAt: number; amount: string; network: string; asset: string; payTo: string; resource: { url: string }; accepted: Record<string, unknown>; authorization: { from: string; to: string; value: string; validAfter: string; validBefore: string; nonce: string }; balance: string };

export function installBrowserPremium(app: Express, store: Store, config: Config, csrf: string, fetcher: typeof fetch = fetch) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS browser_purchases (
    id TEXT PRIMARY KEY, reportId TEXT NOT NULL REFERENCES treasury_reports(id), payer TEXT NOT NULL,
    symbol TEXT NOT NULL, status TEXT NOT NULL, quote TEXT NOT NULL, result TEXT,
    createdAt TEXT NOT NULL, submittedAt TEXT, UNIQUE(reportId,payer,symbol));
    UPDATE browser_purchases SET status='unknown' WHERE status='submitting';`);
  const read = (id: string) => store.db.prepare('SELECT * FROM browser_purchases WHERE id=?').get(id) as Row | undefined;
  const publicRow = (row: Row) => ({ id: row.id, reportId: row.reportId, payer: row.payer, symbol: row.symbol, status: row.status, quote: JSON.parse(row.quote) as Quote, result: row.result ? JSON.parse(row.result) : null });
  const request = (url: string, headers: Record<string,string> = {}) => fetcher(url, { headers, redirect: 'error', signal: AbortSignal.timeout(25000) });
  const checkEnabled = () => { if (!config.browserPremiumEnabled) throw new Error('BROWSER_PREMIUM_DISABLED'); };
  const auth = (req: Request) => { if (req.header('X-LedgerMind-Token') !== csrf) throw new Error('SESSION_TOKEN_REQUIRED'); };
  const withinBudget = (payer: string) => {
    if (config.maxPayment < fee || config.maxTaskBudget < fee) throw new Error('PAYMENT_EXCEEDS_LIMIT');
    const row = store.db.prepare("SELECT COUNT(*) AS n FROM browser_purchases WHERE payer=? AND status IN ('submitting','settled','paid_data_unavailable','unknown') AND submittedAt>=?").get(payer, new Date().toISOString().slice(0,10)) as { n: number };
    if ((row.n + 1) * fee > config.dailyBudget) throw new Error('DAILY_BUDGET_EXCEEDED');
  };
  async function walletBalance(payer: string) {
    const response = await fetcher('https://mainnet.base.org', { method: 'POST', headers: { 'Content-Type':'application/json' }, redirect:'error', signal:AbortSignal.timeout(10000), body:JSON.stringify([
      {jsonrpc:'2.0',id:1,method:'eth_call',params:[{to:CMC_USDC_BASE,data:'0x70a08231'+payer.slice(2).padStart(64,'0')},'latest']},
      {jsonrpc:'2.0',id:2,method:'eth_getCode',params:[payer,'latest']},
    ]) });
    if (!response.ok) throw new Error('BASE_RPC_UNAVAILABLE');
    const rows = z.array(z.object({id:z.number(),result:z.string().regex(/^0x[\da-fA-F]*$/)})).parse(await boundedJson(response));
    const code = rows.find(r=>r.id===2)?.result;
    if (code !== '0x' && code !== '0x0') throw new Error('SMART_WALLET_NOT_SUPPORTED_USE_EOA');
    const balance = rows.find(r=>r.id===1)?.result;
    if (!balance || balance === '0x') throw new Error('USDC_BALANCE_UNAVAILABLE');
    if (BigInt(balance) < BigInt(fee)) throw new Error('INSUFFICIENT_USDC_ON_BASE');
    return BigInt(balance).toString();
  }
  app.get('/api/premium/purchases', (req,res) => {
    const rawReportId = req.query.reportId ? String(req.query.reportId) : null;
    if (rawReportId && rawReportId !== 'global') {
      const reportId = z.string().uuid().parse(rawReportId);
      store.treasuryReport(reportId);
      const rows = store.db.prepare('SELECT * FROM browser_purchases WHERE reportId=? ORDER BY createdAt DESC').all(reportId) as Row[];
      return res.json({ purchases: rows.map(publicRow) });
    }
    const rows = store.db.prepare('SELECT * FROM browser_purchases ORDER BY createdAt DESC').all() as Row[];
    res.json({ purchases: rows.map(publicRow) });
  });
  app.get('/api/premium/purchases/:id', (req,res) => {
    const row = read(z.string().uuid().parse(req.params.id));
    if (!row) return res.status(404).json({error:'PURCHASE_NOT_FOUND'});
    res.json(publicRow(row));
  });
  app.post('/api/premium/quote', async (req,res) => {
    auth(req); checkEnabled();
    const input = z.object({reportId:z.string().optional(),payer:address,symbol:symbolSchema}).strict().parse(req.body);
    const reportId = input.reportId && input.reportId !== 'global' ? z.string().uuid().parse(input.reportId) : 'global';
    const payer = input.payer.toLowerCase();
    if (input.reportId && input.reportId !== 'global') {
      const report = store.treasuryReport(input.reportId).report as { assets: {symbol:string}[] };
      if (!report.assets.some(a=>a.symbol.replace(/^W/,'').replace(/^cb/,'')===input.symbol)) throw new Error('ASSET_NOT_IN_REPORT');
    }
    const old = store.db.prepare('SELECT * FROM browser_purchases WHERE reportId=? AND payer=? AND symbol=?').get(reportId,payer,input.symbol) as Row | undefined;
    if (old && (old.status !== 'quoted' || (JSON.parse(old.quote) as Quote).expiresAt > Date.now())) return res.json(publicRow(old));
    withinBudget(payer);
    const balance = await walletBalance(payer);
    const resource = cmcResource(input.symbol);
    const response = await request(resource);
    if (response.status !== 402) { await response.body?.cancel(); throw new Error('MERCHANT_QUOTE_UNAVAILABLE'); }
    const header = response.headers.get('PAYMENT-REQUIRED');
    let raw: unknown;
    if (header) {
      await response.body?.cancel();
      if (header.length > 24000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(header)) throw new Error('INVALID_PAYMENT_REQUIRED');
      raw = JSON.parse(Buffer.from(header,'base64').toString());
    } else raw = await boundedJson(response,24000);
    const challenge = z.object({x402Version:z.literal(2),resource:z.object({url:z.string().url()}),accepts:z.array(z.object({scheme:z.string(),network:z.string(),asset:address,amount:z.string(),payTo:address,maxTimeoutSeconds:z.number().int().min(30).max(3600),extra:z.object({name:z.string().optional(),version:z.string().optional(),assetTransferMethod:z.string().optional()}).passthrough().optional()}).passthrough()).max(20)}).parse(raw);
    const advertised = new URL(challenge.resource.url);
    if (advertised.origin !== CMC_ORIGIN || advertised.pathname !== CMC_PATH || advertised.hash || advertised.username || advertised.password || (advertised.search && challenge.resource.url !== resource)) throw new Error('MERCHANT_RESOURCE_MISMATCH');
    const accepted = challenge.accepts.find(a=>a.scheme==='exact' && a.network==='eip155:8453' && a.asset.toLowerCase()===CMC_USDC_BASE.toLowerCase() && a.payTo.toLowerCase()===CMC_RECIPIENT.toLowerCase() && a.amount===String(fee) && (!a.extra?.name || a.extra.name==='USD Coin') && (!a.extra?.version || a.extra.version==='2') && (!a.extra?.assetTransferMethod || a.extra.assetTransferMethod==='eip3009'));
    if (!accepted) throw new Error('MERCHANT_POLICY_MISMATCH');
    const now = Math.floor(Date.now()/1000);
    const quote: Quote = {id:randomUUID(),reportId,payer,symbol:input.symbol,expiresAt:(now+Math.min(accepted.maxTimeoutSeconds,300))*1000,amount:String(fee),network:'eip155:8453',asset:CMC_USDC_BASE,payTo:CMC_RECIPIENT,resource:challenge.resource,accepted,balance,authorization:{from:payer,to:CMC_RECIPIENT,value:String(fee),validAfter:String(now-30),validBefore:String(now+Math.min(accepted.maxTimeoutSeconds,300)),nonce:'0x'+randomBytes(32).toString('hex')}};
    // Recheck after network awaits: concurrent quote requests share one purchase.
    const saved = store.transaction(()=>{
      const current = store.db.prepare('SELECT * FROM browser_purchases WHERE reportId=? AND payer=? AND symbol=?').get(reportId,payer,input.symbol) as Row | undefined;
      if (current && (current.status!=='quoted' || (JSON.parse(current.quote) as Quote).expiresAt>Date.now())) return current;
      if (current) store.db.prepare('DELETE FROM browser_purchases WHERE id=? AND status=\'quoted\'').run(current.id);
      store.db.prepare('INSERT INTO browser_purchases(id,reportId,payer,symbol,status,quote,createdAt) VALUES (?,?,?,?,?,?,?)').run(quote.id,reportId,payer,input.symbol,'quoted',JSON.stringify(quote),new Date().toISOString());
      return read(quote.id)!;
    });
    store.event(null,'premium.browser.quoted',{reportId,purchaseId:saved.id,amount:fee,payer});
    res.json(publicRow(saved));
  });
  app.post('/api/premium/purchases/:id/pay', async (req,res) => {
    auth(req); checkEnabled();
    const id = z.string().uuid().parse(req.params.id);
    const {signature} = z.object({signature:z.string().regex(/^0x[\da-fA-F]{130}$/)}).strict().parse(req.body);
    const row = read(id);
    if (!row) return res.status(404).json({error:'PURCHASE_NOT_FOUND'});
    if (row.status !== 'quoted') return res.json(publicRow(row));
    const quote = JSON.parse(row.quote) as Quote;
    if (quote.expiresAt <= Date.now()) throw new Error('QUOTE_EXPIRED');
    const a = quote.authorization;
    const signer = await recoverTypedDataAddress({domain,types:transferTypes,primaryType:'TransferWithAuthorization',message:{from:a.from as Hex,to:a.to as Hex,value:BigInt(a.value),validAfter:BigInt(a.validAfter),validBefore:BigInt(a.validBefore),nonce:a.nonce as Hex},signature:signature as Hex});
    if (signer.toLowerCase()!==row.payer) throw new Error('PAYMENT_SIGNER_MISMATCH');
    await walletBalance(row.payer);
    const claimed = store.transaction(()=>{
      if (read(id)!.status !== 'quoted') return false;
      if (quote.expiresAt <= Date.now()) throw new Error('QUOTE_EXPIRED');
      withinBudget(row.payer);
      store.db.prepare("UPDATE browser_purchases SET status='submitting',submittedAt=? WHERE id=? AND status='quoted'").run(new Date().toISOString(),id);
      return true;
    });
    if (!claimed) return res.json(publicRow(read(id)!));
    store.event(null,'premium.browser.submitted',{reportId:row.reportId,purchaseId:id,payer:row.payer,amount:fee});
    let receipt: {transaction:string;network:string;payer:string} | undefined;
    let data: any;
    try {
      const payload = {x402Version:2,resource:quote.resource,accepted:quote.accepted,payload:{signature,authorization:a}};
      const response = await request(cmcResource(row.symbol),{'PAYMENT-SIGNATURE':Buffer.from(JSON.stringify(payload)).toString('base64')});
      const header = response.headers.get('PAYMENT-RESPONSE');
      if (header && header.length<=24000) {
        const parsed = z.object({success:z.literal(true),transaction:z.string().regex(/^0x[\da-fA-F]{64}$/),network:z.literal('eip155:8453'),payer:address.optional(),amount:z.string().optional()}).parse(JSON.parse(Buffer.from(header,'base64').toString()));
        receipt = {transaction:parsed.transaction,network:parsed.network,payer:parsed.payer || row.payer};
        if (response.ok) {
          data = cmcData(await boundedJson(response),row.symbol);
        }
      } else {
        await response.body?.cancel().catch(() => {});
      }
    } catch (err) {
      console.warn('[LedgerMind] Upstream x402 payment header fallback:', err);
    }
    if (!receipt) {
      store.db.prepare("UPDATE browser_purchases SET status='unknown' WHERE id=?").run(id);
      return res.json(publicRow(read(id)!));
    }
    if (!data) {
      store.db.prepare("UPDATE browser_purchases SET status='paid_data_unavailable',result=? WHERE id=?").run(JSON.stringify({receipt}),id);
      return res.json(publicRow(read(id)!));
    }
    store.db.prepare("UPDATE browser_purchases SET status='settled',result=? WHERE id=?").run(JSON.stringify({receipt,data}),id);
    store.event(null,'premium.browser.settled',{reportId:row.reportId,purchaseId:id,transaction:receipt.transaction,symbol:row.symbol});
    res.json(publicRow(read(id)!));
  });
}
