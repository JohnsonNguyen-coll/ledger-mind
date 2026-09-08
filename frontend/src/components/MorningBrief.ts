import type { TreasuryResult } from '../types/treasury.js';
import { $ } from '../utils/formatters.js';

export function renderBrief(result: TreasuryResult) {
  const preview = $('brief-text');
  if (preview) preview.textContent = result.brief;

  const modalText = document.getElementById('modal-brief-text');
  if (modalText) modalText.textContent = result.brief;
  
  const exportLink = $<HTMLAnchorElement>('export-report');
  if (exportLink) {
    exportLink.hidden = false;
    exportLink.href = `/api/reports/${result.reportId}/markdown`;
    exportLink.download = `ledgermind-${result.reportId}.md`;
  }
}
