/** Đơn vị nội bộ là 1/1.000.000 USD; tuyệt đối không cộng tiền bằng float.
 * Với tiền thật, đây là giá USD do policy cho phép, không phải token decimals.
 * Token amount luôn là chuỗi integer riêng trong x402 requirements. */
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

/** Giá USD tham khảo từ wallet có thể dài hơn 6 số lẻ. Làm tròn LÊN bằng
 * integer để không ghi thiếu ngân sách. Không nới parser tiền do user nhập. */
export function usdCeiling(value: string): number {
  if (!/^\d+(\.\d+)?$/.test(value) || value.length > 200) throw new Error('INVALID_MONEY');
  const [whole = '0', fraction = ''] = value.split('.');
  const base = usd(`${whole}.${fraction.slice(0, 6).padEnd(6, '0')}`);
  const amount = base + (/[1-9]/.test(fraction.slice(6)) ? 1 : 0);
  if (!Number.isSafeInteger(amount)) throw new Error('MONEY_TOO_LARGE');
  return amount;
}
