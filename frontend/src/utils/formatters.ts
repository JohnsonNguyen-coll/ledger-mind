export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export const usd = (value: number): string =>
  value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: value >= 1000 ? 0 : 2 });

export const shortAddress = (address: string): string =>
  address && address.length > 12 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address || '-';
