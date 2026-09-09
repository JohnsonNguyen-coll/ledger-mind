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
      `\nLedgerMind is already running in another session.\nOpen dashboard: ${existing}\nCurrent data is preserved; no need to start an extra server.\nIf configuration was modified, stop the previous session before restarting.\n`,
    );
  }
  if (system) {
    console.log(
      `\nLedgerMind is running: ${system.url}\nAgent: ${config.agentMode} | Payment: ${config.paymentMode} | Market: ${config.marketMode}\nPress Ctrl+C to stop.\n`,
    );
    const running = system;
    for (const signal of ['SIGINT', 'SIGTERM'] as const)
      process.once(signal, () => void running.close().then(() => process.exit(0)));
  }
} catch (error) {
  const code = errorCode(error);
  console.error('Failed to start:', code);
  if (code === 'DATABASE_ALREADY_IN_USE') {
    console.error(
      'Another process holds the database lock but dashboard could not be verified on the configured port. Stop previous LedgerMind processes or check PORT. Do not delete the database or lock while running.',
    );
  }
  process.exitCode = 1;
}
