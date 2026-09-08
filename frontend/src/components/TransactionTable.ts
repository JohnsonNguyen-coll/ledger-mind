import type { TreasuryResult } from '../types/treasury.js';
import { $, usd, shortAddress } from '../utils/formatters.js';

export function renderTransactions(result: TreasuryResult) {
  const body = $('transactions');
  body.replaceChildren();
  $('tx-count').textContent = `${result.transactions.length} loaded`;

  if (!result.transactions.length) {
    body.innerHTML = '<tr><td colspan="6" class="empty-cell">No recent native transfers loaded from explorer.</td></tr>';
    return;
  }

  for (const tx of result.transactions) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${tx.time ? new Date(tx.time).toLocaleDateString() : '-'}</td>
      <td><span class="direction ${tx.direction}">${tx.direction}</span></td>
      <td>${tx.asset}</td>
      <td>${tx.amount.toLocaleString('en-US', { maximumFractionDigits: 6 })}</td>
      <td>${usd(tx.valueUsd)}</td>
      <td><a href="#" title="${tx.counterparty}">${shortAddress(tx.counterparty)}</a></td>
    `;
    body.append(row);
  }
}
