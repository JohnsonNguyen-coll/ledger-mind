import type { TreasuryResult } from '../types/treasury.js';
import { $, usd } from '../utils/formatters.js';

export function renderMetrics(result: TreasuryResult) {
  $('metric-value').textContent = usd(result.metrics.totalValueUsd);
  $('metric-stable').textContent = usd(result.metrics.stableValueUsd);
  const missingTransfers = result.dataSources.some(
    (s) => /explorer/i.test(s.name) && s.status === 'unavailable',
  );
  $('metric-flow').textContent = missingTransfers ? 'Unavailable' : usd(result.metrics.netFlowUsd);

  const riskElem = $('metric-risk');
  riskElem.textContent = result.metrics.riskScore;
  riskElem.className = result.metrics.riskScore.toLowerCase();

  $('metric-runway').textContent = missingTransfers
    ? 'Runway unavailable · Missing transfers'
    : result.metrics.runwayMonths === null
      ? 'Runway not estimable from sampled transfers'
      : `${result.metrics.runwayMonths.toFixed(1)} months estimated runway`;

  $('chain-label').textContent = result.chain.name;
}
