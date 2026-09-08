import type { TreasuryResult } from '../types/treasury.js';
import { $, usd } from '../utils/formatters.js';

export function renderCharts(result: TreasuryResult) {
  const host = $('cashflow-chart');
  host.replaceChildren();
  host.className = 'cashflow-content';
  const unavailable = result.dataSources.some(
    (s) => /explorer|transaction/i.test(s.name) && ['unavailable', 'partial'].includes(s.status),
  );
  if (!result.transactions.length) {
    host.className = 'empty-state';
    host.textContent = unavailable
      ? 'Explorer data unavailable. Cash flow cannot be determined.'
      : 'No native transfers returned for this report. This does not establish a zero cash flow.';
    return;
  }
  if (
    !result.assets.some(
      (a) => a.symbol === result.chain.nativeSymbol && a.priceUsd !== null && a.priceUsd > 0,
    )
  ) {
    host.className = 'empty-state';
    host.textContent = 'Native asset price unavailable. USD cash flow cannot be plotted.';
    return;
  }
  const days = new Map<string, { inflow: number; outflow: number }>();
  for (const tx of result.transactions) {
    if (
      !['inflow', 'outflow'].includes(tx.direction) ||
      !Number.isFinite(Date.parse(tx.time)) ||
      !Number.isFinite(tx.valueUsd)
    )
      continue;
    const day = new Date(tx.time).toISOString().slice(0, 10);
    const values = days.get(day) || { inflow: 0, outflow: 0 };
    values[tx.direction as 'inflow' | 'outflow'] += Math.max(0, tx.valueUsd);
    days.set(day, values);
  }
  const rows = [...days].sort(([a], [b]) => a.localeCompare(b));
  const max = Math.max(1, ...rows.flatMap(([, v]) => [v.inflow, v.outflow]));
  const note = document.createElement('p');
  note.className = 'chart-caption';
  note.textContent = `${result.transactions.length} returned transfers · UTC dates · Current reference prices · Sample only, not a complete cash-flow ledger${unavailable ? ' · Partial source coverage' : ''}`;
  host.append(note);
  const legend = document.createElement('p');
  legend.className = 'flow-legend';
  legend.innerHTML =
    '<span class="positive">● Inflow</span><span class="negative">● Outflow</span>';
  host.append(legend);
  for (const [day, values] of rows) {
    const row = document.createElement('div');
    row.className = 'flow-row';
    const date = document.createElement('time');
    date.dateTime = day;
    date.textContent = day.slice(5);
    row.append(date);
    const tracks = document.createElement('div');
    tracks.className = 'flow-tracks';
    for (const direction of ['inflow', 'outflow'] as const) {
      const track = document.createElement('div');
      track.className = 'flow-track';
      const bar = document.createElement('div');
      bar.className = `flow-bar ${direction}`;
      bar.style.width = `${(values[direction] / max) * 100}%`;
      track.append(bar);
      tracks.append(track);
    }
    const label = document.createElement('span');
    label.textContent = `+${usd(values.inflow)} / −${usd(values.outflow)}`;
    row.append(tracks, label);
    row.title = `${day}: inflow ${usd(values.inflow)}, outflow ${usd(values.outflow)}`;
    host.append(row);
  }
}
