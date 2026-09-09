import { chromium } from 'playwright-core';
import { startSystem } from '../src/system.js';
import { testConfig } from '../tests/helpers.js';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

mkdirSync('data/ui-check', { recursive: true });
const system = await startSystem(
  testConfig({ databasePath: `data/ui-check/check-${Date.now()}.sqlite` }),
);
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/tickers', (route) =>
    route.fulfill({
      json: [
        { symbol: 'ETH', price: 2000, change: -1.25 },
        { symbol: 'BTC', price: 60000, change: 2.1 },
        { symbol: 'BNB', price: 600, change: 0 },
      ],
      headers: { 'X-Ticker-Observed-At': new Date().toISOString(), 'X-Ticker-Stale': 'false' },
    }),
  );
  await page.goto(system.url);
  await page.locator('.ticker-item').first().waitFor();
  assert.equal(await page.locator('[data-open-modal]:visible').count(), 0);
  await page.screenshot({ path: 'data/ui-check/landing-desktop.png', fullPage: true });
  await page.locator('.public-nav [data-route="/docs"]').click();
  assert.equal(await page.locator('#docs-page').isVisible(), true);
  await page.reload();
  assert.equal(await page.locator('#docs-page').isVisible(), true);
  await page.screenshot({ path: 'data/ui-check/docs-desktop.png', fullPage: true });
  await page.locator('.public-nav [data-route="/dashboard"]').click();
  assert.equal(await page.locator('#app-workspace').isVisible(), true);
  await page.reload();
  assert.equal(await page.locator('#app-workspace').isVisible(), true);
  await page.locator('[data-route="/assets"]').click();
  assert.equal(await page.locator('#tab-assets').isVisible(), true);
  await page.goBack();
  assert.equal(await page.locator('#tab-overview').isVisible(), true);
  const report = {
    reportId: '12345678-1234-4234-8234-123456789012',
    reportHash: 'test',
    markdownReport: 'test',
    observedAt: new Date().toISOString(),
    walletAddress: '0x0000000000000000000000000000000000000001',
    chain: { name: 'Base', nativeSymbol: 'ETH' },
    assets: [
      {
        symbol: 'ETH',
        balance: 2,
        priceUsd: 2000,
        valueUsd: 4000,
        stable: false,
        source: 'Test fixture',
      },
      {
        symbol: 'USDC',
        balance: 6000,
        priceUsd: 1,
        valueUsd: 6000,
        stable: true,
        source: 'Test fixture',
      },
    ],
    transactions: [
      {
        hash: '0x1',
        time: '2026-09-07T12:00:00Z',
        direction: 'inflow',
        asset: 'ETH',
        amount: 1,
        valueUsd: 2000,
        counterparty: '0x2',
      },
      {
        hash: '0x2',
        time: '2026-09-08T12:00:00Z',
        direction: 'outflow',
        asset: 'ETH',
        amount: 0.2,
        valueUsd: 400,
        counterparty: '0x3',
      },
    ],
    metrics: {
      totalValueUsd: 10000,
      stableValueUsd: 6000,
      netFlowUsd: 1600,
      burnMonthlyUsd: 400,
      runwayMonths: 15,
      concentrationPct: 60,
      riskScore: 'Low',
    },
    risks: [],
    dataSources: [{ name: 'RPC', status: 'verified' }],
    brief: 'Fixture report for UI verification.',
    workflowDraft: 'Review fixture report.',
    premiumData: { requested: false, status: 'not requested', taskId: null, note: '' },
  };
  await page.route('**/api/treasury/analyze', (route) => route.fulfill({ json: report }));
  await page.route('**/api/reports/*/audit', (route) =>
    route.fulfill({ json: { integrityValid: true, events: [] } }),
  );
  await page.locator('.topbar-actions [data-open-modal="analysis-modal"]').click();
  await page.locator('#run-analysis').click();
  await page.locator('.report-donut').waitFor();
  assert.equal(await page.locator('.flow-row').count(), 2);
  assert.equal(await page.locator('#analysis-modal').getAttribute('class'), 'modal-backdrop');
  await page.screenshot({ path: 'data/ui-check/dashboard-desktop.png', fullPage: true });
  // Exercise long lists, final pages and replacement with a shorter report.
  for (const [id, rowClass, route, size] of [
    ['allocation-bars','asset-row','/dashboard',8],
    ['cashflow-chart','flow-row','/dashboard',10],
    ['risks','risk-item','/risk-audit',5],
    ['audit-list','audit-row','/risk-audit',10],
    ['sources','source-item','/risk-audit',6],
    ['transactions','','/assets',10],
  ] as const) {
    await page.locator(`.tab-btn[data-route="${route}"]`).click();
    if(id==='sources')await page.locator('.topbar-actions [data-open-modal="analysis-modal"]').click();
    await page.evaluate(({id,rowClass})=>{
      const host=document.getElementById(id)!;host.replaceChildren();
      for(let i=0;i<23;i++){
        const row=document.createElement(id==='transactions'?'tr':'div');row.className=rowClass;
        if(id==='transactions'){const td=document.createElement('td');td.textContent=`Item ${i+1}`;row.append(td);}else row.textContent=`Item ${i+1}`;
        host.append(row);
      }
    },{id,rowClass});
    const pager=page.getByRole('navigation',{name:`${id.replaceAll('-',' ')} pagination`,exact:true});
    await pager.waitFor();
    assert.equal(await page.locator(`#${id} > :not([hidden])`).count(),size);
    for(let i=1;i<Math.ceil(23/size);i++)await pager.getByRole('button',{name:'Next',exact:true}).click();
    assert.equal(await page.locator(`#${id} > :not([hidden])`).count(),23%size || size);
    assert.equal(await pager.getByRole('button',{name:'Next',exact:true}).isDisabled(),true);
    await page.evaluate(id=>{const host=document.getElementById(id)!;host.replaceChildren(host.firstElementChild!);},id);
    await pager.waitFor({state:'hidden'});
    assert.equal(await page.locator(`#${id} > :not([hidden])`).count(),1);
    if(id==='sources')await page.keyboard.press('Escape');
  }
  await page.route('**/api/reports?*',route=>{
    const requested=Number(new URL(route.request().url()).searchParams.get('page') || 1);
    const reports=Array.from({length:23},(_,i)=>({id:String(i),walletAddress:'0x'+'11'.repeat(20),chainId:8453,createdAt:new Date().toISOString(),summary:`Saved report ${i+1}`}));
    return route.fulfill({json:{reports:reports.slice((requested-1)*10,requested*10),pagination:{page:requested,total:23,pageSize:10}}});
  });
  await page.locator('[data-open-modal="history-modal"]').click();
  await page.locator('#refresh-history').click();
  const historyPager=page.getByRole('navigation',{name:'Report history pagination',exact:true});
  await historyPager.waitFor();
  assert.equal(await page.locator('.history-item').count(),10);
  await historyPager.getByRole('button',{name:'Next',exact:true}).click();
  await page.getByText('Saved report 11',{exact:true}).waitFor();
  await page.getByRole('navigation',{name:'Report history pagination',exact:true}).getByRole('button',{name:'Next',exact:true}).click();
  await page.getByText('Saved report 23',{exact:true}).waitFor();
  assert.equal(await page.locator('.history-item').count(),3);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:'data/ui-check/pagination-mobile.png',fullPage:true});
  await page.keyboard.press('Escape');
  for (const path of ['/', '/docs', '/dashboard']) {
    await page.goto(system.url + path);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      `Overflow: ${path}`,
    );
    await page.screenshot({
      path: `data/ui-check/${path === '/' ? 'landing' : path.slice(1)}-mobile.png`,
      fullPage: true,
    });
  }
  assert.deepEqual(errors, []);
  console.log(
    'UI checks passed: routes, refresh, back, report rendering, charts, modal, mobile overflow, console.',
  );
} finally {
  await browser.close();
  await system.close();
}
