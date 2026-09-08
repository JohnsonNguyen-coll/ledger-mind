import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Config } from './config.js';

/** Health chỉ trả dấu định danh, không công khai đường dẫn database trên máy.
 * Dùng realpath để cùng một DB không bị nhận là khác chỉ vì đường dẫn tương đối. */
export function databaseIdentity(path: string): string {
  let absolute = resolve(path);
  try {
    absolute = realpathSync(absolute);
  } catch {
    /* DB có thể chưa được tạo. */
  }
  if (process.platform === 'win32') absolute = absolute.toLowerCase();
  return createHash('sha256').update(absolute).digest('hex');
}

/** Chỉ tái sử dụng phiên có cả PID giữ lock và DB giống cấu hình hiện tại.
 * Một server LedgerMind khác tình cờ ở cùng port không đủ để kết luận.
 * Hàm này không xóa lock, không mở SQLite và không chạy recovery. */
export async function findRunningInstance(
  config: Pick<Config, 'databasePath' | 'port'>,
): Promise<string | null> {
  if (config.databasePath === ':memory:') return null;
  try {
    const pid = Number(readFileSync(`${config.databasePath}.lock`, 'utf8'));
    if (!Number.isInteger(pid) || pid <= 0) return null;
    const url = `http://127.0.0.1:${config.port}`;
    const response = await fetch(`${url}/api/health`, {
      redirect: 'error',
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return null;
    const health = (await response.json()) as Record<string, unknown>;
    return health.ok === true &&
      health.name === 'LedgerMind' &&
      health.processId === pid &&
      health.databaseId === databaseIdentity(config.databasePath)
      ? url
      : null;
  } catch {
    return null;
  }
}
