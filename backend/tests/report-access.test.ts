import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { startSystem } from '../src/system.js';
import { testConfig } from './helpers.js';
const alice=privateKeyToAccount(('0x'+'11'.repeat(32)) as `0x${string}`);
const bob=privateKeyToAccount(('0x'+'22'.repeat(32)) as `0x${string}`);
async function client(url:string){
  let cookie='';let token='';
  const request=async(path:string,body?:unknown)=>{
    const r=await fetch(url+path,{method:body?'POST':'GET',headers:{Cookie:cookie,'X-LedgerMind-Token':token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    const next=r.headers.getSetCookie()[0];if(next)cookie=next.split(';')[0]!;
    const data=r.headers.get('content-type')?.includes('json')?await r.json():await r.text();
    return {status:r.status,data};
  };
  token=(await request('/api/config')).data.csrfToken;
  const login=async(account:typeof alice)=>{const nonce=await request('/api/wallet/nonce',{wallet:account.address});const signature=await account.signMessage({message:nonce.data.message});return request('/api/wallet/login',{signature});};
  return {request,login,sessionHash:()=>createHash('sha256').update(cookie.split('=')[1]!).digest('hex')};
}
test('private reports: anonymous isolation, signed wallet ownership, guessed URLs, session rotation and logout',async()=>{
  const system=await startSystem(testConfig());try{
    const a=await client(system.url),b=await client(system.url);
    const report=system.store.saveTreasuryReport({walletAddress:alice.address,chainId:8453,summary:'Private report',report:{assets:[]},markdown:'Private export'});
    const aSession=system.store.db.prepare('SELECT id FROM web_sessions WHERE tokenHash=?').get(a.sessionHash()) as {id:string};
    system.store.db.prepare('INSERT INTO report_owners(reportId,sessionId,wallet) VALUES (?,?,NULL)').run(report.id,aSession.id);
    assert.equal((await a.request('/api/reports')).data.reports.length,1);
    assert.deepEqual((await b.request('/api/reports')).data.reports,[]);
    for(const suffix of ['', '/markdown','/audit'])assert.equal((await b.request(`/api/reports/${report.id}${suffix}`)).status,404);
    assert.equal((await b.request('/api/agent/ask',{reportId:report.id,question:'What is the risk?'})).status,404);
    assert.equal((await b.request('/api/workflows/draft',{reportId:report.id})).status,404);
    const oldHash=a.sessionHash();assert.equal((await a.login(alice)).status,200);assert.notEqual(a.sessionHash(),oldHash);
    assert.equal((await b.login(bob)).status,200);assert.equal((await b.request(`/api/reports/${report.id}`)).status,404);
    const anotherAlice=await client(system.url);await anotherAlice.login(alice);assert.equal((await anotherAlice.request(`/api/reports/${report.id}`)).status,200);
    await a.request('/api/wallet/logout',{});assert.deepEqual((await a.request('/api/reports')).data.reports,[]);
    assert.equal((await a.request(`/api/reports/${report.id}`)).status,404);
  }finally{await system.close();}
});
test('global premium history belongs to the authenticated payer, not a shared report ID',async()=>{
  const system=await startSystem(testConfig());try{
    const a=await client(system.url),b=await client(system.url),anon=await client(system.url);
    await a.login(alice);await b.login(bob);
    const ids=[randomUUID(),randomUUID()];
    for(const [i,account] of [alice,bob].entries())system.store.db.prepare('INSERT INTO browser_purchases(id,reportId,payer,symbol,status,quote,result,createdAt) VALUES (?,?,?,?,?,?,?,?)').run(ids[i]!,'global',account.address.toLowerCase(),'ETH','settled','{}',JSON.stringify({data:{privateFor:account.address}}),new Date().toISOString());
    for(const path of ['/api/premium/purchases','/api/premium/purchases?reportId=global']){
      assert.equal((await anon.request(path)).status,401);
      const rows=(await a.request(path)).data.purchases;assert.equal(rows.length,1);assert.equal(rows[0].id,ids[0]);
      assert.equal((await b.request(path)).data.purchases[0].id,ids[1]);
    }
    assert.equal((await b.request(`/api/premium/purchases/${ids[0]}`)).status,404);
    assert.equal((await b.request(`/api/premium/purchases/${ids[0]}/pay`,{signature:'0x'+'11'.repeat(65)})).status,404);
    const forged=await b.request('/api/premium/quote',{reportId:'global',payer:alice.address,symbol:'ETH'});assert.notEqual(forged.status,200);
  }finally{await system.close();}
});
test('report pagination reaches older reports and counts only the current owner',async()=>{
  const system=await startSystem(testConfig());try{
    const a=await client(system.url),b=await client(system.url);
    const session=system.store.db.prepare('SELECT id FROM web_sessions WHERE tokenHash=?').get(a.sessionHash()) as {id:string};
    for(let i=0;i<25;i++){
      const r=system.store.saveTreasuryReport({walletAddress:alice.address,chainId:8453,summary:`Report ${i}`,report:{assets:[]},markdown:''});
      system.store.db.prepare('INSERT INTO report_owners(reportId,sessionId,wallet) VALUES (?,?,NULL)').run(r.id,session.id);
    }
    const ids=new Set<string>();
    for(let page=1;page<=3;page++){
      const result=await a.request(`/api/reports?page=${page}&pageSize=10`);
      assert.equal(result.status,200);assert.equal(result.data.pagination.total,25);
      assert.equal(result.data.reports.length,page===3?5:10);
      result.data.reports.forEach((r:{id:string})=>ids.add(r.id));
    }
    assert.equal(ids.size,25);
    assert.equal((await a.request('/api/reports?page=999')).data.pagination.page,3);
    assert.equal((await b.request('/api/reports?page=2')).data.pagination.total,0);
    for(const query of ['page=0','page=1.5','pageSize=1000'])assert.equal((await a.request(`/api/reports?${query}`)).status,400);
  }finally{await system.close();}
});

test('configured frontend proxy can request a sign-in challenge, other origins stay blocked',async()=>{
  const origin='https://ledger-mind-kappa.vercel.app';
  const system=await startSystem(testConfig({appOrigin:origin}));try{
    const config=await fetch(system.url+'/api/config',{headers:{Origin:origin}});
    const {csrfToken}=await config.json();
    assert.match(config.headers.getSetCookie()[0]!,/Secure/);
    const response=await fetch(system.url+'/api/wallet/nonce',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-LedgerMind-Token':csrfToken},body:JSON.stringify({wallet:alice.address})});
    assert.equal(response.status,200);
    const {message}=await response.json();
    assert.ok(message.startsWith('ledger-mind-kappa.vercel.app wants you'));
    assert.ok(message.includes(`URI: ${origin}`));
    const preflight=await fetch(system.url+'/api/wallet/nonce',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Headers':'x-ledgermind-token'}});
    assert.equal(preflight.status,204);assert.match(preflight.headers.get('Access-Control-Allow-Headers')!,/X-LedgerMind-Token/);
    for(const hostile of ['https://evil.vercel.app',origin+'.evil.example'])assert.equal((await fetch(system.url+'/api/wallet/nonce',{method:'POST',headers:{Origin:hostile,'X-Forwarded-Host':'ledger-mind-kappa.vercel.app'}})).status,403);
  }finally{await system.close();}
});

test('sign-in challenges reject another wallet and cannot be replayed',async()=>{
  const system=await startSystem(testConfig());try{
    const a=await client(system.url);let nonce=(await a.request('/api/wallet/nonce',{wallet:alice.address})).data.message;
    const wrong=await bob.signMessage({message:nonce});assert.equal((await a.request('/api/wallet/login',{signature:wrong})).data.error,'SIGN_IN_WALLET_MISMATCH');
    nonce=(await a.request('/api/wallet/nonce',{wallet:alice.address})).data.message;
    const signature=await alice.signMessage({message:nonce});assert.equal((await a.request('/api/wallet/login',{signature})).status,200);
    assert.equal((await a.request('/api/wallet/login',{signature})).data.error,'SIGN_IN_CHALLENGE_EXPIRED');
  }finally{await system.close();}
});
