import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { privateKeyToAccount } from 'viem/accounts';
import { Store } from '../src/store.js';
import { installBrowserPremium } from '../src/payments/browser-premium.js';
import { CMC_ORIGIN, CMC_PATH, CMC_RECIPIENT, CMC_USDC_BASE } from '../src/services/cmc.js';
import { testConfig } from './helpers.js';
const wallet=privateKeyToAccount(('0x'+'11'.repeat(32)) as `0x${string}`);
const other=privateKeyToAccount(('0x'+'22'.repeat(32)) as `0x${string}`);
const tx='0x'+'ab'.repeat(32);
const challenge=()=>({x402Version:2,resource:{url:CMC_ORIGIN+CMC_PATH},accepts:[{scheme:'exact',network:'eip155:8453',asset:CMC_USDC_BASE,amount:'10000',payTo:CMC_RECIPIENT,maxTimeoutSeconds:300,extra:{name:'USD Coin',version:'2'}}]});
async function harness(options:{missingReceipt?:boolean;badData?:boolean;badChallenge?:boolean;lowBalance?:boolean;smartWallet?:boolean;disabled?:boolean;dailyBudget?:number}={}) {
  const config=testConfig({browserPremiumEnabled:!options.disabled,...(options.dailyBudget===undefined?{}:{dailyBudget:options.dailyBudget})});
  const store=new Store(':memory:',{wallet:1000000,maxPayment:10000,dailyBudget:1000000});
  const report=store.saveTreasuryReport({walletAddress:other.address,chainId:8453,summary:'Test',report:{assets:[{symbol:'ETH'}]},markdown:'Test'});
  let paidCalls=0;
  const fetcher:typeof fetch=async (input,init)=>{
    const url=String(input);
    if(url==='https://mainnet.base.org')return Response.json([{id:1,result:options.lowBalance?'0x1':'0x989680'},{id:2,result:options.smartWallet?'0x1234':'0x'}]);
    assert.equal(url,CMC_ORIGIN+CMC_PATH+'?id=1027');
    const signature=new Headers(init?.headers).get('PAYMENT-SIGNATURE');
    if(!signature){const c=challenge();if(options.badChallenge)c.accepts[0]!.payTo=other.address;return Response.json(c,{status:402});}
    paidCalls++;
    const payload=JSON.parse(Buffer.from(signature,'base64').toString());
    assert.equal(payload.x402Version,2);assert.equal(payload.accepted.amount,'10000');assert.equal(payload.payload.authorization.from,wallet.address.toLowerCase());
    const receipt=Buffer.from(JSON.stringify({success:true,transaction:tx,network:'eip155:8453',payer:wallet.address})).toString('base64');
    return Response.json(options.badData?{}:{status:{error_code:0},data:{'1027':{id:1027,symbol:'ETH',quote:{USD:{price:2200,volume_24h:100000,percent_change_24h:2,market_cap:999999,last_updated:new Date().toISOString()}}}}},{headers:options.missingReceipt?{}:{'PAYMENT-RESPONSE':receipt}});
  };
  const app=express();app.use(express.json());installBrowserPremium(app,store,config,'test-token',{requireWallet:()=>wallet.address.toLowerCase(),requireReport:()=>{}},fetcher);
  app.use((error:Error,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{res.status(400).json({error:error.message});});
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const post=async(path:string,body:unknown,token='test-token')=>{const r=await fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json','X-LedgerMind-Token':token},body:JSON.stringify(body)});return {status:r.status,body:await r.json() as any};};
  const quote=()=>post('/api/premium/quote',{reportId:report.id,payer:wallet.address,symbol:'ETH'});
  const close=async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();};
  return {store,report,quote,post,close,paidCalls:()=>paidCalls,url};
}
async function sign(p:any,account=wallet) {
  const a=p.quote.authorization;
  return account.signTypedData({domain:{name:'USD Coin',version:'2',chainId:8453,verifyingContract:CMC_USDC_BASE},types:{TransferWithAuthorization:[{name:'from',type:'address'},{name:'to',type:'address'},{name:'value',type:'uint256'},{name:'validAfter',type:'uint256'},{name:'validBefore',type:'uint256'},{name:'nonce',type:'bytes32'}]},primaryType:'TransferWithAuthorization',message:{...a,value:BigInt(a.value),validAfter:BigInt(a.validAfter),validBefore:BigInt(a.validBefore)}});
}
test('browser premium: quote, EOA signature, settlement, persisted report supplement, duplicate submission',async()=>{
  const h=await harness();try{
    const q=await h.quote();assert.equal(q.status,200);assert.equal(q.body.status,'quoted');assert.equal(q.body.quote.amount,'10000');
    const again=await h.quote();assert.equal(again.body.id,q.body.id);
    const signature=await sign(q.body);
    const results=await Promise.all([h.post(`/api/premium/purchases/${q.body.id}/pay`,{signature}),h.post(`/api/premium/purchases/${q.body.id}/pay`,{signature})]);
    assert.equal(h.paidCalls(),1);assert.ok(results.some(r=>r.body.status==='settled'));
    const saved=await (await fetch(h.url+`/api/premium/purchases/${q.body.id}`)).json() as any;
    assert.equal(saved.result.receipt.transaction,tx);assert.equal(saved.result.data.metrics.priceUsd,2200);
    assert.equal((await h.quote()).body.status,'settled');
    assert.ok(!JSON.stringify(h.store.audit()).includes(signature));assert.ok(h.store.verifyAudit());
  }finally{await h.close();}
});
test('browser premium: rejects wrong signer and expired quotes without contacting paid endpoint',async()=>{
  const h=await harness();try{
    const q=(await h.quote()).body;
    const wrong=await h.post(`/api/premium/purchases/${q.id}/pay`,{signature:await sign(q,other)});
    assert.equal(wrong.body.error,'PAYMENT_SIGNER_MISMATCH');
    q.quote.expiresAt=0;h.store.db.prepare('UPDATE browser_purchases SET quote=? WHERE id=?').run(JSON.stringify(q.quote),q.id);
    const expired=await h.post(`/api/premium/purchases/${q.id}/pay`,{signature:await sign(q)});assert.equal(expired.body.error,'QUOTE_EXPIRED');assert.equal(h.paidCalls(),0);
  }finally{await h.close();}
});
test('browser premium: wallet, merchant, configuration, and budget preflight blocks',async()=>{
  for(const [options,error] of [[{badChallenge:true},'MERCHANT_POLICY_MISMATCH'],[{lowBalance:true},'INSUFFICIENT_USDC_ON_BASE'],[{smartWallet:true},'SMART_WALLET_NOT_SUPPORTED_USE_EOA'],[{disabled:true},'BROWSER_PREMIUM_DISABLED'],[{dailyBudget:0},'DAILY_BUDGET_EXCEEDED']] as const){
    const h=await harness(options);try{assert.equal((await h.quote()).body.error,error);assert.equal(h.paidCalls(),0);}finally{await h.close();}
  }
});
test('browser premium: missing receipt stays unknown, paid data failure retains receipt, neither can recharge',async()=>{
  for(const options of [{missingReceipt:true},{badData:true}]){
    const h=await harness(options);try{
      const q=(await h.quote()).body;const signature=await sign(q);
      const first=await h.post(`/api/premium/purchases/${q.id}/pay`,{signature});
      assert.equal(first.body.status,options.missingReceipt?'unknown':'paid_data_unavailable');
      if(options.badData)assert.equal(first.body.result.receipt.transaction,tx);
      await h.post(`/api/premium/purchases/${q.id}/pay`,{signature});await h.quote();assert.equal(h.paidCalls(),1);
    }finally{await h.close();}
  }
});
test('browser premium: requires session token and report asset; recovery never replays a submitted purchase',async()=>{
  const h=await harness();try{
    assert.equal((await h.post('/api/premium/quote',{reportId:h.report.id,payer:wallet.address,symbol:'ETH'},'wrong')).body.error,'SESSION_TOKEN_REQUIRED');
    assert.equal((await h.post('/api/premium/quote',{reportId:h.report.id,payer:wallet.address,symbol:'SOL'})).body.error,'ASSET_NOT_IN_REPORT');
    const q=(await h.quote()).body;h.store.db.prepare("UPDATE browser_purchases SET status='submitting' WHERE id=?").run(q.id);
    installBrowserPremium(express(),h.store,testConfig(),'test-token',{requireWallet:()=>wallet.address.toLowerCase(),requireReport:()=>{}});
    assert.equal((await h.quote()).body.status,'unknown');assert.equal(h.paidCalls(),0);
  }finally{await h.close();}
});
