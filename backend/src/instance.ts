import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Config } from './config.js';

/** Health endpoint only returns database identity hash, keeping local file paths private.
 * Uses realpath so the same DB is not misidentified due to relative paths. */
export function databaseIdentity(path?: string): string {
  return createHash('sha256').update(path || 'supabase-cloud').digest('hex');
}

export async function findRunningInstance(
  config: { port: number; databasePath?: string },
): Promise<string | null> {
  if (!config.port) return null;
  try {
    const url = `http://127.0.0.1:${config.port}`;
    const response = await fetch(`${url}/api/health`, {
      redirect: 'error',
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return null;
    const health = (await response.json()) as Record<string, unknown>;
    return health.ok === true && health.name === 'LedgerMind' ? url : null;
  } catch {
    return null;
  }
}
