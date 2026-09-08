const icons: Record<string, string> = {
  chart: '<path d="M4 4v16h16M8 15v-4m5 4V7m5 8v-6"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/>',
  document: '<path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h6"/>',
};
export function tokenIcon(symbol: string): string {
  const base = symbol === 'WETH' ? 'ETH' : symbol === 'WBNB' ? 'BNB' : symbol;
  const paths: Record<string, string> = {
    ETH: '<path fill="#a9baff" d="m12 2 6 10-6 3-6-3zm-6 12 6 8 6-8-6 3z"/>',
    BNB: '<path fill="#f0b90b" d="m12 3 4 4-2 2-2-2-2 2-2-2zm-7 7 2 2-2 2-2-2zm14 0 2 2-2 2-2-2zm-7 0 2 2-2 2-2-2zm-4 7 2-2 2 2 2-2 2 2-4 4z"/>',
    BTC: '<circle cx="12" cy="12" r="11" fill="#f7931a"/><text x="12" y="17" text-anchor="middle" font-size="16" fill="white" font-family="Arial">₿</text>',
    USDC: '<circle cx="12" cy="12" r="11" fill="#2775ca"/><path d="M7 5a8 8 0 0 0 0 14m10-14a8 8 0 0 1 0 14" stroke="white" fill="none"/><text x="12" y="17" text-anchor="middle" font-size="15" fill="white">$</text>',
    USDT: '<circle cx="12" cy="12" r="11" fill="#26a17b"/><path d="M6 6h12v3h-4v11h-4V9H6z" fill="white"/><ellipse cx="12" cy="11" rx="8" ry="2" fill="none" stroke="white"/>',
    cbBTC:
      '<circle cx="12" cy="12" r="11" fill="#1652f0"/><text x="12" y="17" text-anchor="middle" font-size="16" fill="white" font-family="Arial">₿</text>',
  };
  return paths[base]
    ? `<svg class="token-icon" viewBox="0 0 24 24" aria-hidden="true">${paths[base]}</svg>`
    : '<span class="token-icon token-generic" aria-hidden="true">◈</span>';
}

async function refreshTickers() {
  const status = document.getElementById('ticker-status')!;
  const host = document.getElementById('market-tickers')!;
  try {
    const response = await fetch('/api/tickers', { signal: AbortSignal.timeout(6000) });
    if (!response.ok) throw new Error('Unavailable');
    const data: unknown = await response.json();
    if (!Array.isArray(data)) throw new Error('Invalid data');
    const rows = data.filter(
      (item) =>
        ['BTC', 'ETH', 'BNB'].includes(item.symbol) &&
        Number.isFinite(item.price) &&
        item.price > 0 &&
        Number.isFinite(item.change),
    );
    if (!rows.length) throw new Error('No quotes');
    host.replaceChildren();
    for (const item of rows) {
      const row = document.createElement('div');
      row.className = 'ticker-item';
      row.innerHTML = `${tokenIcon(item.symbol)}<div><strong>${item.symbol}<small> / USDT</small></strong><span>${item.price.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })} <em class="${item.change >= 0 ? 'positive' : 'negative'}">${item.change >= 0 ? '+' : ''}${item.change.toFixed(2)}%</em></span></div>`;
      host.append(row);
    }
    const observed = response.headers.get('X-Ticker-Observed-At');
    status.textContent = observed
      ? `${response.headers.get('X-Ticker-Stale') === 'true' ? 'Cached' : 'Binance'} · ${new Date(observed).toLocaleTimeString()} · 24h change`
      : 'Timestamp unavailable · 24h change';
  } catch {
    host.textContent = 'Market quotes are temporarily unavailable.';
    status.textContent = 'Binance · No verified quote';
  }
}

export function initMarketing() {
  document.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => {
    el.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[el.dataset.icon!] || ''}</svg>`;
  });
  document.getElementById('docs-page')!.innerHTML = `
    <div class="docs-layout"><aside class="docs-sidebar"><p class="eyebrow">DOCUMENTATION</p><a href="#introduction">Introduction</a><a href="#quick-start">Quick start</a><a href="#networks">Networks & assets</a><a href="#methodology">Metrics & charts</a><a href="#workflow">Reports & workflow</a><a href="#x402">Premium data & x402</a><a href="#api">API reference</a><a href="#limitations">Data limitations</a></aside>
    <article class="docs-content"><header id="introduction"><p class="eyebrow">LEDGERMIND / DOCS</p><h1>Understand your treasury.<br>Understand your tools.</h1><p class="docs-lead">LedgerMind turns public onchain balances and market data into treasury reports, risk signals, and human-reviewed workflow drafts.</p><div class="docs-callout">Start with a public EVM wallet address. Standard analysis does not require connecting a wallet or signing a transaction.</div></header>
    <section id="quick-start"><h2>Quick start</h2><ol><li><a href="/dashboard" data-route="/dashboard">Launch the dashboard</a> and select <strong>Run Analysis</strong>.</li><li>Enter a wallet address, select Base or BNB Smart Chain, and choose a 7, 30, or 90 day timeframe.</li><li>Run the analysis. Review source status before interpreting balances, cash flow, or risk.</li><li>Explore assets and risk, then open AI Copilot & Workflow to ask report-specific questions or copy a review draft.</li></ol><h3>Run locally</h3><pre><code>npm ci
npm run build
npm start
# Open http://127.0.0.1:3000</code></pre><p>Requires Node.js 24 or newer. Configure environment values using the repository’s .env.example and .env.live.example files.</p></section>
    <section id="networks"><h2>Networks & tracked assets</h2><div class="table-wrap"><table><thead><tr><th>Network</th><th>Chain ID</th><th>Native asset</th><th>Selected tokens</th></tr></thead><tbody><tr><td>Base</td><td>8453</td><td>ETH</td><td>USDC, WETH, cbBTC</td></tr><tr><td>BNB Smart Chain</td><td>56</td><td>BNB</td><td>USDT, USDC, WBNB</td></tr></tbody></table></div><p>Tickers identify assets, not networks: Base uses ETH for gas. WETH and WBNB are wrapped assets; cbBTC is a distinct token on Base. LedgerMind reads only its configured token list, not every token a wallet may hold.</p></section>
    <section id="methodology"><h2>How metrics & charts work</h2><dl><dt>Treasury value</dt><dd>Sum of tracked balances × available USD reference prices. Unpriced holdings do not contribute to the priced allocation chart.</dd><dt>Stablecoin buffer</dt><dd>Combined value of tracked assets marked as stablecoins. A public peg assumption is not a guarantee of redemption or a live depeg check.</dd><dt>Allocation</dt><dd>Each priced asset’s value divided by total priced holdings. The chart is a current report snapshot, not historical portfolio performance.</dd><dt>Native cash flow</dt><dd>Native inflows and outflows grouped by UTC date from the returned transfer sample. USD values use the analysis reference price, not execution-time prices.</dd><dt>Monthly burn & runway</dt><dd>Sampled native outflow × 30 ÷ selected days. Estimated runway equals stablecoin buffer ÷ monthly burn. No observed burn means runway cannot be estimated.</dd><dt>Concentration & risk</dt><dd>Largest holding as a percentage of tracked treasury value. Rule-based signals also consider stablecoin coverage, runway, and unavailable sources. Review the explanations in Risk & Audit.</dd></dl></section>
    <section id="workflow"><h2>Reports, copilot & approval</h2><p>Report History loads saved reports. Each report includes an observation time, source statuses, report hash, and a Markdown export. The copilot answers from the selected report; its answers inherit that report’s coverage and limitations.</p><p>Workflow drafts support team review. Creating or copying a draft does not submit a multisig transaction or execute a trade. The local SHA-256 audit chain helps detect modifications against a trusted checkpoint; it is not external notarization.</p></section>
    <section id="x402"><h2>Premium data &amp; x402</h2><p>Open a report, connect your paying wallet with RainbowKit, then select Get premium quote. The app checks USDC balance and the merchant terms on Base. Review the 0.01 USDC price, recipient and expiry before selecting Confirm &amp; pay.</p><p>Your wallet signs a single-use USDC authorization. A successful merchant response supplies a settlement receipt and market snapshot. The dashboard saves these as a report supplement with a Base explorer link and Markdown export.</p><pre><code>BROWSER_PREMIUM_ENABLED=true
WALLETCONNECT_PROJECT_ID=</code></pre><p>Extension wallets work without a project ID. Add a public Reown project ID for mobile WalletConnect QR connections. Browser payments do not require a backend wallet CLI or model key. Standard EOA wallets are supported; smart contract wallets are not yet supported.</p><p>If settlement is pending or unknown, use Refresh status and inspect your wallet. The app will not automatically charge the same purchase again. A receipt is merchant-reported evidence. The original report snapshot remains unchanged.</p></section>
    <section id="api"><h2>API reference</h2><p>Local server endpoints used by the dashboard.</p><pre><code>POST /api/treasury/analyze
{
  "walletAddress": "0x…",
  "chainId": 8453,
  "timeframeDays": 30,
  "usePremiumData": false
}</code></pre><p>Replace 0x… with a valid 42-character EVM address. The response includes assets, transactions, metrics, risks, dataSources, brief, workflowDraft, and report metadata.</p><div class="table-wrap"><table><thead><tr><th>Endpoint</th><th>Purpose</th></tr></thead><tbody><tr><td>GET /api/reports</td><td>Saved report list</td></tr><tr><td>GET /api/reports/:id</td><td>Read one report</td></tr><tr><td>GET /api/reports/:id/markdown</td><td>Export report</td></tr><tr><td>GET /api/reports/:id/audit</td><td>Report audit events</td></tr><tr><td>POST /api/agent/ask</td><td>Ask with reportId and question</td></tr><tr><td>POST /api/workflows/draft</td><td>Retrieve a draft using reportId</td></tr><tr><td>GET /api/tickers</td><td>BTC, ETH, BNB quotes in USDT</td></tr></tbody></table></div></section>
    <section id="limitations"><h2>Read the evidence in context</h2><p>Explorer coverage may be partial or unavailable. The current report uses up to 20 returned native transfers within the chosen timeframe; it does not provide a complete ledger of ERC-20 transfers, internal calls, or protocol positions.</p><p>Missing prices and RPC failures can understate tracked value. Cash-flow, burn, and runway estimates are incomplete when transfer data is missing. Market snapshot prices are separate from the prices recorded in an existing report.</p><a class="btn-solid-primary" href="/dashboard" data-route="/dashboard">Open the dashboard ↗</a></section></article></div>`;
  void refreshTickers();
  window.setInterval(() => {
    if (!document.hidden && document.body.dataset.view === 'landing') void refreshTickers();
  }, 60000);
}
