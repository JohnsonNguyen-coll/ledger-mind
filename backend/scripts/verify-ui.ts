import { chromium } from 'playwright-core';
import { startSystem } from '../src/system.js';
import { testConfig } from '../tests/helpers.js';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

mkdirSync('data/ui-check', { recursive: true });
const system = await startSystem(testConfig({ databasePath: `data/ui-check/check-${Date.now()}.sqlite` }));
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/tickers', route => route.fulfill({ json: [{ symbol: 'ETH', price: 2000, change: -1.25 },{symbol:'BTC',price:60000,change:2.1},{symbol:'BNB',price:600,change:0}], headers: { 'X-Ticker-Observed-At': new Date().toISOString(), 'X-Ticker-Stale':'false' } }));
  await page.goto(system.url);
  await page.locator('.ticker-item').first().waitFor();
  assert.equal(await page.locator('[data-open-modal]:visible').count(),0);
  await page.screenshot({ path: 'data/ui-check/landing-desktop.png', fullPage:true });
  await page.locator('.public-nav [data-route="/docs"]').click();
  assert.equal(await page.locator('#docs-page').isVisible(),true);
  await page.reload(); assert.equal(await page.locator('#docs-page').isVisible(),true);
  await page.screenshot({ path: 'data/ui-check/docs-desktop.png', fullPage:true });
  await page.locator('.public-nav [data-route="/dashboard"]').click();
  assert.equal(await page.locator('#app-workspace').isVisible(),true);
  await page.reload(); assert.equal(await page.locator('#app-workspace').isVisible(),true);
  await page.locator('[data-route="/assets"]').click();
  assert.equal(await page.locator('#tab-assets').isVisible(),true);
  await page.goBack(); assert.equal(await page.locator('#tab-overview').isVisible(),true);
  const report = { reportId:'12345678-1234-4234-8234-123456789012',reportHash:'test',markdownReport:'test',observedAt:new Date().toISOString(),walletAddress:'0x0000000000000000000000000000000000000001',chain:{name:'Base',nativeSymbol:'ETH'},assets:[{symbol:'ETH',balance:2,priceUsd:2000,valueUsd:4000,stable:false,source:'Test fixture'},{symbol:'USDC',balance:6000,priceUsd:1,valueUsd:6000,stable:true,source:'Test fixture'}],transactions:[{hash:'0x1',time:'2026-09-07T12:00:00Z',direction:'inflow',asset:'ETH',amount:1,valueUsd:2000,counterparty:'0x2'},{hash:'0x2',time:'2026-09-08T12:00:00Z',direction:'outflow',asset:'ETH',amount:0.2,valueUsd:400,counterparty:'0x3'}],metrics:{totalValueUsd:10000,stableValueUsd:6000,netFlowUsd:1600,burnMonthlyUsd:400,runwayMonths:15,concentrationPct:60,riskScore:'Low'},risks:[],dataSources:[{name:'RPC',status:'verified'}],brief:'Fixture report for UI verification.',workflowDraft:'Review fixture report.',premiumData:{requested:false,status:'not requested',taskId:null,note:''}};
  await page.route('**/api/treasury/analyze', route => route.fulfill({json:report}));
  await page.route('**/api/reports/*/audit', route => route.fulfill({json:{integrityValid:true,events:[]}}));
  await page.locator('.topbar-actions [data-open-modal="analysis-modal"]').click();
  await page.locator('#run-analysis').click();
  await page.locator('.report-donut').waitFor();
  assert.equal(await page.locator('.flow-row').count(),2);
  assert.equal(await page.locator('#analysis-modal').getAttribute('class'),'modal-backdrop');
  await page.screenshot({path:'data/ui-check/dashboard-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  for (const path of ['/', '/docs', '/dashboard']) {
    await page.goto(system.url + path);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true, `Overflow: ${path}`);
    await page.screenshot({path:`data/ui-check/${path === '/' ? 'landing' : path.slice(1)}-mobile.png`,fullPage:true});
  }
  assert.deepEqual(errors,[]);
  console.log('UI checks passed: routes, refresh, back, report rendering, charts, modal, mobile overflow, console.');
} finally { await browser.close(); await system.close(); }
