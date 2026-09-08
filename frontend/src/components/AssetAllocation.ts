import type { TreasuryResult } from '../types/treasury.js';
import { $, usd } from '../utils/formatters.js';
import { tokenIcon } from './Marketing.js';

export function renderAllocation(result: TreasuryResult) {
  const host = $('allocation-bars');
  host.replaceChildren();
  host.className = 'allocation-content';
  const assets = result.assets
    .filter((a) => a.balance > 0 || a.valueUsd > 0)
    .sort((a, b) => b.valueUsd - a.valueUsd);
  const total = assets.reduce(
    (sum, a) =>
      sum + (a.priceUsd !== null && Number.isFinite(a.valueUsd) ? Math.max(0, a.valueUsd) : 0),
    0,
  );
  if (!assets.length) {
    host.className = 'empty-state';
    host.textContent = 'No tracked balances returned. Review data source status for coverage.';
    return;
  }
  const colors = ['#64d8be', '#7896fa', '#e4b66b', '#be9af7', '#e08fa2'];
  const assetColors = new Map(
    assets
      .filter((a) => a.priceUsd !== null && a.valueUsd > 0)
      .map((a, i) => [a.symbol, colors[i % colors.length]]),
  );
  if (total > 0) {
    let offset = 0;
    const segments = assets
      .filter((a) => a.priceUsd !== null && a.valueUsd > 0)
      .map((a, i) => {
        const start = offset;
        offset += (a.valueUsd / total) * 100;
        return `${colors[i % colors.length]} ${start}% ${offset}%`;
      });
    const chart = document.createElement('div');
    chart.className = 'allocation-summary';
    const donut = document.createElement('div');
    donut.className = 'report-donut';
    donut.style.background = `conic-gradient(${segments.join(',')})`;
    donut.setAttribute('role', 'img');
    donut.setAttribute(
      'aria-label',
      assets
        .map(
          (a) =>
            `${a.symbol}: ${a.priceUsd === null ? 'unpriced' : ((a.valueUsd / total) * 100).toFixed(1) + '%'}`,
        )
        .join(', '),
    );
    const center = document.createElement('div');
    center.textContent = usd(total);
    donut.append(center);
    const caption = document.createElement('p');
    caption.className = 'chart-caption';
    caption.textContent = 'Priced holdings. Current report snapshot; unpriced assets excluded.';
    chart.append(donut, caption);
    host.append(chart);
  }
  for (const asset of assets) {
    const row = document.createElement('div');
    row.className = 'asset-row';
    const name = document.createElement('div');
    name.className = 'asset-name';
    name.innerHTML = tokenIcon(asset.symbol);
    const symbol = document.createElement('strong');
    symbol.textContent = asset.symbol;
    name.append(symbol);
    const swatch = document.createElement('span');
    swatch.className = 'legend-dot';
    swatch.style.setProperty('--asset-color', assetColors.get(asset.symbol) || '#90a29f');
    name.prepend(swatch);
    const detail = document.createElement('div');
    detail.className = 'asset-amount';
    const value = document.createElement('strong');
    value.textContent = asset.priceUsd === null ? 'Price unavailable' : usd(asset.valueUsd);
    const amount = document.createElement('small');
    amount.textContent = `${asset.balance.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${asset.symbol} · ${asset.priceUsd === null || total <= 0 ? 'Unpriced' : ((asset.valueUsd / total) * 100).toFixed(1) + '%'}`;
    detail.append(value, amount);
    row.append(name, detail);
    row.title = asset.source;
    host.append(row);
  }
}
