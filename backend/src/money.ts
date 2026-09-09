/** Internal unit is 1/1,000,000 USD; never sum money using float.
 * For real money, this is policy-permitted USD price, not token decimals.
 * Token amount is always a separate integer string in x402 requirements. */
export function usd(value: string): number {
  if (!/^\d+(\.\d{1,6})?$/.test(value)) throw new Error('INVALID_MONEY');
  const [whole = '0', fraction = ''] = value.split('.');
  const result = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('MONEY_TOO_LARGE');
  return Number(result);
}
export function money(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('INVALID_MICRO_USD');
  return (value / 1_000_000).toFixed(6).replace(/0{1,4}$/, '');
}
export function positive(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('INVALID_AMOUNT');
}

/** USD reference price from wallet may have more than 6 decimal places. Round UP using
 * integer so budget is never underestimated. Do not loosen user input money parser. */
export function usdCeiling(value: string): number {
  if (!/^\d+(\.\d+)?$/.test(value) || value.length > 200) throw new Error('INVALID_MONEY');
  const [whole = '0', fraction = ''] = value.split('.');
  const base = usd(`${whole}.${fraction.slice(0, 6).padEnd(6, '0')}`);
  const amount = base + (/[1-9]/.test(fraction.slice(6)) ? 1 : 0);
  if (!Number.isSafeInteger(amount)) throw new Error('MONEY_TOO_LARGE');
  return amount;
}
