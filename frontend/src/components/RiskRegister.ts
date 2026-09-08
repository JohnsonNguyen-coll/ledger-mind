import type { TreasuryResult } from '../types/treasury.js';
import { $ } from '../utils/formatters.js';

export function renderRisks(result: TreasuryResult) {
  const host = $('risks');
  $('risk-count').textContent = `${result.risks.length} signal${result.risks.length === 1 ? '' : 's'}`;
  host.className = 'risk-list';
  host.replaceChildren();
  
  if (!result.risks.length) {
    host.className = 'risk-list empty-state';
    host.textContent = 'No deterministic risk signal found from available data.';
    return;
  }
  
  for (const risk of result.risks) {
    const item = document.createElement('div');
    item.className = `risk-item ${risk.level}`;
    item.innerHTML = `<strong>${risk.title}</strong><p>${risk.detail}</p>`;
    host.append(item);
  }
}
