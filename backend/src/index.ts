import { readConfig } from './config.js';
import { startSystem } from './system.js';
import { errorCode } from './agent/runner.js';
import { findRunningInstance } from './instance.js';

try {
  const config = readConfig();
  let system: Awaited<ReturnType<typeof startSystem>> | undefined;
  try {
    system = await startSystem(config);
  } catch (error) {
    const existing =
      errorCode(error) === 'DATABASE_ALREADY_IN_USE' ? await findRunningInstance(config) : null;
    if (!existing) throw error;
    console.log(
      `\nLedgerMind đã chạy trong một phiên khác.\nMở dashboard: ${existing}\nDữ liệu hiện tại được giữ nguyên; không cần khởi động thêm server.\nNếu vừa sửa cấu hình, hãy dừng phiên cũ trước khi khởi động lại.\n`,
    );
  }
  if (system) {
    console.log(
      `\nLedgerMind đang chạy: ${system.url}\nAgent: ${config.agentMode} | Payment: ${config.paymentMode} | Market: ${config.marketMode}\nCtrl+C để dừng.\n`,
    );
    const running = system;
    for (const signal of ['SIGINT', 'SIGTERM'] as const)
      process.once(signal, () => void running.close().then(() => process.exit(0)));
  }
} catch (error) {
  const code = errorCode(error);
  console.error('Không thể khởi động:', code);
  if (code === 'DATABASE_ALREADY_IN_USE') {
    console.error(
      'Một process đang giữ database nhưng chưa xác minh được dashboard tại port đã cấu hình. Hãy dừng cửa sổ LedgerMind cũ hoặc kiểm tra PORT. Không xóa database hay lock khi process còn chạy.',
    );
  }
  process.exitCode = 1;
}
