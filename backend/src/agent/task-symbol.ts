import type { Symbol } from '../types.js';

/** Guard clear single-asset requests before creating a task or authorizing spending.
 * Multiple asset mentions can be intentional comparisons; do not guess a target.
 * This is a bounded alias check, not a general natural-language parser.
 */
export function mismatchedTaskSymbol(prompt: string, selected: Symbol): boolean {
  const aliases: Record<string, Symbol> = {
    ETH: 'ETH', ETHEREUM: 'ETH', BTC: 'BTC', BITCOIN: 'BTC',
    BNB: 'BNB', SOL: 'SOL', SOLANA: 'SOL',
  };
  const mentions = new Set<Symbol>();
  for (const match of prompt.toUpperCase().matchAll(/\b(ETHEREUM|BITCOIN|SOLANA|ETH|BTC|BNB|SOL)(?:USDT|USD)?\b/g))
    mentions.add(aliases[match[1]!]!);
  return mentions.size === 1 && !mentions.has(selected);
}
