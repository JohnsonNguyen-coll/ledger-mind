import type { TreasuryResult } from '../types/treasury.js';
import { analyzeTreasury } from '../api/client.js';
import { $ } from '../utils/formatters.js';

export function setLoading(isLoading: boolean) {
  const button = $<HTMLButtonElement>('run-analysis');
  button.disabled = isLoading;
  button.textContent = isLoading ? 'Verifying Live Data...' : 'Run Treasury Analysis';
  if (isLoading) $('audit-state').textContent = 'Analyzing…';
}

export function initControlPanel(onResult: (result: TreasuryResult) => void) {
  // Bind Quick Preset Buttons
  document.querySelectorAll<HTMLButtonElement>('.preset-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const address = btn.dataset.address;
      if (address) {
        $<HTMLInputElement>('wallet-address').value = address;
      }
    });
  });

  // Bind Form Submit Handler
  $('analysis-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = $('form-error');
    error.hidden = true;
    setLoading(true);

    try {
      const result = await analyzeTreasury({
        walletAddress: $<HTMLInputElement>('wallet-address').value.trim(),
        chainId: Number($<HTMLSelectElement>('chain-id').value),
        timeframeDays: Number($<HTMLSelectElement>('timeframe-days').value),
        usePremiumData: false,
        authorizePremiumPayment: false,
      });
      onResult(result);
    } catch (err) {
      $('audit-state').textContent = 'Analysis failed · Previous report retained, if available';
      error.hidden = false;
      error.textContent = err instanceof Error ? err.message : 'Analysis failed';
    } finally {
      setLoading(false);
    }
  });
}
