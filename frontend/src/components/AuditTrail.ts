import { fetchAuditLog } from '../api/client.js';
import { $ } from '../utils/formatters.js';

export async function renderAudit(reportId: string) {
  const host = $('audit-list');
  try {
    const audit = await fetchAuditLog(reportId);
    $('audit-count').textContent = `${audit.events.length} event${audit.events.length === 1 ? '' : 's'}`;
    host.className = 'audit-list';
    host.replaceChildren();

    if (!audit.events.length) {
      host.className = 'audit-list empty-state';
      host.textContent = audit.integrityValid ? 'Hash chain valid. No report-linked events found.' : 'Audit hash chain failed verification.';
      return;
    }

    for (const event of audit.events) {
      const row = document.createElement('div');
      row.className = 'audit-row';
      row.innerHTML = `<strong>${event.type}</strong><span>${new Date(event.at).toLocaleString()}</span><p>${event.detail}</p>`;
      host.append(row);
    }
  } catch {
    host.className = 'audit-list empty-state';
    host.textContent = 'Audit unavailable for this report.';
  }
}
