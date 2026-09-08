import type { TreasuryResult } from '../types/treasury.js';
import { $, usd } from '../utils/formatters.js';

export function renderMetrics(result: TreasuryResult) {
  $('metric-value').textContent = usd(result.metrics.totalValueUsd);
  $('metric-stable').textContent = usd(result.metrics.stableValueUsd);
  $('metric-flow').textContent = usd(result.metrics.netFlowUsd);
  
  const riskElem = $('metric-risk');
  riskElem.textContent = result.metrics.riskScore;
  riskElem.className = result.metrics.riskScore.toLowerCase();
  
  $('metric-runway').textContent =
    result.metrics.runwayMonths === null
      ? 'No outbound burn detected'
      : `${result.metrics.runwayMonths.toFixed(1)} months estimated runway`;
      
  $('chain-label').textContent = result.chain.name;
}
