import type { TreasuryResult } from './src/types/treasury.js';
import { $ } from './src/utils/formatters.js';
import { updateAuditState } from './src/components/Navbar.js';
import { initControlPanel } from './src/components/ControlPanel.js';
import { renderMetrics } from './src/components/MetricsGrid.js';
import { renderAllocation } from './src/components/AssetAllocation.js';
import { renderBrief } from './src/components/MorningBrief.js';
import { renderRisks } from './src/components/RiskRegister.js';
import { renderWorkflow, initWorkflowCopy } from './src/components/WorkflowPanel.js';
import { initChatCopilot } from './src/components/ChatCopilot.js';
import { renderAudit } from './src/components/AuditTrail.js';
import { renderTransactions } from './src/components/TransactionTable.js';
import { renderSources, loadHistory } from './src/components/HistoryPanel.js';
import { initModalManager, closeModal } from './src/components/ModalManager.js';
import { initRouter, navigateTo } from './src/components/Router.js';

import { initMarketing } from './src/components/Marketing.js';
import { renderCharts } from './src/components/TreasuryCharts.js';

let currentReportId: string | null = null;

function renderResult(result: TreasuryResult) {
  currentReportId = result.reportId;
  
  // Show Workspace and close analysis modal if open
  navigateTo('/dashboard');
  closeModal('analysis-modal');

  renderMetrics(result);
  renderAllocation(result);
  renderCharts(result);
  $('report-context').textContent = result.chain.name + ' · ' + result.walletAddress + ' · Observed ' + new Date(result.observedAt).toLocaleString();
  renderRisks(result);
  renderSources(result);
  renderBrief(result);
  renderWorkflow(result);
  renderTransactions(result);
  updateAuditState('Ready', result.walletAddress);
  
  const statusElem = $('chat-status');
  if (statusElem) statusElem.textContent = 'Ready';

  void renderAudit(result.reportId);
  void loadHistory((saved) => renderResult(saved));
}

function boot() {
  // Initialize Visual Systems & Interactive Navigation
  initMarketing();
  initModalManager();


  initRouter();

  // Initialize Components
  initControlPanel((result) => renderResult(result));
  initWorkflowCopy();
  initChatCopilot(() => currentReportId);

  const refreshBtn = $('refresh-history');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      void loadHistory((saved) => renderResult(saved));
    });
  }

  void loadHistory((saved) => renderResult(saved));
}

boot();
