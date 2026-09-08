import { $, shortAddress } from '../utils/formatters.js';

export function updateAuditState(state: string, walletAddress?: string) {
  const elem = $('audit-state');
  if (walletAddress) {
    elem.textContent = `Audit logged · ${shortAddress(walletAddress)}`;
  } else {
    elem.textContent = state;
  }
}
