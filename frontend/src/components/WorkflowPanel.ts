import type { TreasuryResult } from '../types/treasury.js';
import { $ } from '../utils/formatters.js';

export function renderWorkflow(result: TreasuryResult) {
  $('workflow-draft').textContent = result.workflowDraft;
}

export function initWorkflowCopy() {
  $('copy-workflow').addEventListener('click', async () => {
    await navigator.clipboard.writeText($('workflow-draft').textContent ?? '');
    $('copy-workflow').textContent = 'Copied';
    window.setTimeout(() => ($('copy-workflow').textContent = 'Copy Markdown'), 1200);
  });
}
