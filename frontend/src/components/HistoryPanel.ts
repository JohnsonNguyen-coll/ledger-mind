import type { TreasuryResult } from '../types/treasury.js';
import { fetchReports, fetchReportById } from '../api/client.js';
import { $, shortAddress } from '../utils/formatters.js';
import { createPagination } from './Pagination.js';

let historyRequest = 0;
let historyPager: ReturnType<typeof createPagination> | undefined;

export function renderSources(result: TreasuryResult) {
  const host = $('sources');
  host.replaceChildren();
  const verified = result.dataSources.filter((source) => source.status === 'verified').length;
  $('source-count').textContent = `${verified}/${result.dataSources.length} verified`;

  for (const source of result.dataSources) {
    const item = document.createElement('div');
    item.className = `source-item ${source.status.replaceAll(' ', '-')}`;
    item.innerHTML = `<span>${source.name}</span><strong>${source.status}</strong>`;
    host.append(item);
  }
}

export async function loadHistory(onSelectReport: (report: TreasuryResult) => void, page = 1) {
  const host = $('history-list');
  const request = ++historyRequest;
  historyPager?.nav.remove();
  historyPager = createPagination('Report history', next => void loadHistory(onSelectReport, next));
  host.after(historyPager.nav);
  historyPager.nav.hidden = true;
  host.setAttribute('aria-busy', 'true');
  let result;
  try {
    result = await fetchReports(page);
    if (request !== historyRequest) return;
  } catch {
    if (request !== historyRequest) return;
    host.className = 'history-list empty-state';
    host.textContent = 'Report history unavailable. Select Refresh to retry.';
    host.removeAttribute('aria-busy');
    return;
  }
  host.removeAttribute('aria-busy');
  const meta = result.pagination || {page:1,total:result.reports.length,pageSize:10};
  historyPager.update(meta.page, meta.total, meta.pageSize);
  host.replaceChildren();

  if (!result.reports.length) {
    host.className = 'history-list empty-state';
    host.textContent = 'No saved reports yet.';
    return;
  }

  host.className = 'history-list';
  for (const report of result.reports) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'history-item';
    button.innerHTML = `
      <strong>${shortAddress(report.walletAddress)} · ${report.chainId === 8453 ? 'Base' : 'BNB'}</strong>
      <span>${new Date(report.createdAt).toLocaleString()}</span>
      <small>${report.summary}</small>
    `;
    button.onclick = async () => {
      const saved = await fetchReportById(report.id);
      onSelectReport(saved.report);
    };
    host.append(button);
  }
}
