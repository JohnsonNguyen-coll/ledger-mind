import { chromium } from 'playwright-core';
import { privateKeyToAccount } from 'viem/accounts';
import { startSystem } from '../src/system.js';
import { testConfig } from '../tests/helpers.js';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const account=privateKeyToAccount(('0x'+'11'.repeat(32)) as `0x${string}`);
mkdirSync('data/ui-check',{recursive:true});
const system=await startSystem(testConfig({databasePath:`data/ui-check/premium-${Date.now()}.sqlite`}));
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.exposeFunction('testSign',async(raw:string)=>{const input=JSON.parse(raw);delete input.types.EIP712Domain;return account.signTypedData(input);});
  await page.exposeFunction('testLogin',async(message:string)=>account.signMessage({message}));
  await page.addInitScript('window.__name = (fn) => fn;');
  await page.addInitScript(({address})=>{
    const events=new Map<string,Function[]>();let chain='0x1';
    const provider={isMetaMask:true,on:(name:string,fn:Function)=>events.set(name,[...(events.get(name)||[]),fn]),removeListener:(name:string,fn:Function)=>events.set(name,(events.get(name)||[]).filter(f=>f!==fn)),request:async({method,params}:{method:string;params:any[]})=>{
      if(method==='eth_accounts')return localStorage.getItem('test-wallet-connected')?[address]:[];
      if(method==='eth_requestAccounts'){localStorage.setItem('test-wallet-connected','true');return[address];}
      if(method==='eth_chainId')return chain;
      if(method==='wallet_switchEthereumChain'){chain=params[0].chainId;events.get('chainChanged')?.forEach(fn=>fn(chain));return null;}
      if(method==='wallet_requestPermissions'||method==='wallet_getPermissions')return[{parentCapability:'eth_accounts'}];
      if(method==='eth_signTypedData_v4'){
        if((window as any).rejectTestSign){(window as any).rejectTestSign=false;throw Object.assign(new Error('User rejected request'),{code:4001});}
        return (window as any).testSign(params[1]);
      }
      if(method==='personal_sign')return (window as any).testLogin(new TextDecoder().decode(Uint8Array.from(params[0].slice(2).match(/.{2}/g),(s:any)=>parseInt(s,16))));
      if(method==='eth_getBalance')return '0x0';
      if(method==='eth_getCode')return '0x';
      if(method==='eth_call')return '0x'+'0'.repeat(64);
      if(method==='wallet_revokePermissions')return null;
      throw new Error('Unhandled test wallet method '+method);
    }};
    (window as any).ethereum=provider;
    const announce=()=>window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info:{uuid:'b0cbd59f-4990-4b6b-b364-26f44d79e044',name:'Test Wallet',icon:'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=',rdns:'io.test.wallet'},provider}}));
    window.addEventListener('eip6963:requestProvider',announce);announce();
  },{address:account.address});
  await page.route('https://mainnet.base.org/**',route=>route.fulfill({json:{jsonrpc:'2.0',id:1,result:'0x0'}}));
  await page.route('**/api/tickers',route=>route.fulfill({json:[]}));
  await page.route('**/api/reports',route=>route.fulfill({json:{reports:[]}}));
  const reportId='12345678-1234-4234-8234-123456789012';
  const quote={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',reportId,payer:account.address.toLowerCase(),symbol:'ETH',status:'quoted',quote:{expiresAt:Date.now()+300000,amount:'10000',network:'eip155:8453',asset:'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',payTo:'0x3C5f3a6cE224BB89D72f5EB4232ecC27F67B3eeA',balance:'1000000',authorization:{from:account.address.toLowerCase(),to:'0x3C5f3a6cE224BB89D72f5EB4232ecC27F67B3eeA',value:'10000',validAfter:String(Math.floor(Date.now()/1000)-30),validBefore:'',nonce:'0x'+'33'.repeat(32)}},result:null as any};
  quote.quote.expiresAt=Math.floor(quote.quote.expiresAt/1000)*1000;quote.quote.authorization.validBefore=String(quote.quote.expiresAt/1000);
  let recorded:typeof quote|null=null;let paid=0;
  await page.route('**/api/premium/purchases?*',route=>route.fulfill({json:{purchases:recorded?[recorded]:[]}}));
  await page.route('**/api/premium/quote',route=>{recorded=structuredClone(quote);return route.fulfill({json:recorded});});
  await page.route('**/api/premium/purchases/*/pay',route=>{paid++;assert.match(route.request().postDataJSON().signature,/^0x[\da-f]{130}$/i);recorded={...quote,status:'settled',result:{receipt:{transaction:'0x'+'ab'.repeat(32),network:'eip155:8453',payer:account.address},data:{source:'CoinMarketCap test fixture',observedAt:new Date().toISOString(),metrics:{priceUsd:2300,volume24hUsd:450000,change24hPct:2.4,marketCapUsd:270000000000}}}};return route.fulfill({json:recorded});});
  await page.goto(system.url+'/premium');
  await page.getByRole('button',{name:'Connect Wallet',exact:true}).waitFor({timeout:20000}).catch(async error=>{console.error(errors,await page.locator('body').innerText());throw error;});
  await page.evaluate((id)=>{const report={reportId:id,assets:[{symbol:'ETH'},{symbol:'USDC'}]};(window as any).ledgerMindReport=report;window.dispatchEvent(new CustomEvent('ledgermind:report',{detail:report}));},reportId);
  await page.getByRole('button',{name:'Connect Wallet',exact:true}).click();
  await page.screenshot({path:'data/ui-check/premium-connect.png'});
  await page.getByRole('button',{name:/Browser Wallet|Test Wallet|Injected/}).first().click();
  await page.route('**/api/wallet/nonce',route=>route.fulfill({status:403,json:{error:'ORIGIN_REJECTED'}}));
  await page.getByRole('button',{name:'Sign in with wallet',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Configure APP_ORIGIN'}).waitFor();
  assert.equal(await page.getByRole('alert').filter({hasText:'cancelled'}).count(),0);
  await page.unroute('**/api/wallet/nonce');
  await page.getByRole('button',{name:'Sign in with wallet',exact:true}).click({timeout:10000}).catch(async error=>{console.error(errors,await page.locator('body').innerText());throw error;});
  await page.getByRole('button',{name:/Switch to Base & get quote|Get premium quote/}).click();
  await page.getByRole('button',{name:'Confirm & pay 0.01 USDC'}).waitFor();
  await page.screenshot({path:'data/ui-check/premium-quote.png',fullPage:true});
  await page.evaluate(()=>{(window as any).rejectTestSign=true;});
  await page.getByRole('button',{name:'Confirm & pay 0.01 USDC'}).click();
  await page.getByRole('alert').filter({hasText:'cancelled'}).waitFor();assert.equal(paid,0);
  await page.getByRole('button',{name:'Confirm & pay 0.01 USDC'}).click();
  await page.getByText('ETH · Payment confirmed',{exact:true}).waitFor();assert.equal(paid,1);
  const walletPager=page.getByRole('navigation',{name:'Wallet tracking pagination'});
  assert.equal(await page.locator('.whale-table tbody tr').count(),5);
  await walletPager.getByRole('button',{name:'Next',exact:true}).click();
  assert.equal(await page.locator('.whale-table tbody tr').count(),5);
  assert.equal(await walletPager.getByRole('button',{name:'Next',exact:true}).isDisabled(),true);
  await page.screenshot({path:'data/ui-check/premium-settled.png',fullPage:true});
  await page.reload();await page.locator('.premium-panel').waitFor();
  await page.evaluate((id)=>{const report={reportId:id,assets:[{symbol:'ETH'}]};(window as any).ledgerMindReport=report;window.dispatchEvent(new CustomEvent('ledgermind:report',{detail:report}));},reportId);
  await page.getByText('ETH · Payment confirmed',{exact:true}).waitFor();assert.equal(paid,1);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:'data/ui-check/premium-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);console.log('Premium UI passed: RainbowKit connection, Base switch, quote, rejected signature, confirmed payment, receipt, reload recovery, mobile. No real payment made.');
}finally{await browser.close();await system.close();}
