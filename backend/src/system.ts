import { randomBytes } from 'node:crypto';
import {
  openSync,
  closeSync,
  unlinkSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { dirname } from 'node:path';
import type { Server } from 'node:http';
import type { Config } from './config.js';
import { Store } from './store.js';
import { mockServices, realServices, realPolicies } from './services/registry.js';
import { startService, listen, address } from './services/server.js';
import { MockPaymentAdapter } from './payments/mock.js';
import { BinancePaymentAdapter, cliRunner } from './payments/binance.js';
import { PaymentGateway } from './payments/gateway.js';
import { AgentRunner } from './agent/runner.js';
import { createApp } from './app.js';

/** Một application instance/DB. Nếu chạy nhiều instances, recovery không được
 * đánh dấu request của process khác là interrupted. Lock file ngăn tình huống đó. */
export function lockFile(path: string): () => void {
  if (path === ':memory:') return () => {};
  mkdirSync(dirname(path), { recursive: true });
  const lock = `${path}.lock`;
  if (existsSync(lock)) {
    const pid = Number(readFileSync(lock, 'utf8'));
    let alive = true;
    try {
      if (!Number.isInteger(pid) || pid <= 0) throw new Error('INVALID_LOCK');
      process.kill(pid, 0);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ESRCH') alive = false;
    }
    if (alive) throw new Error('DATABASE_ALREADY_IN_USE');
    unlinkSync(lock);
  }
  const handle = openSync(lock, 'wx');
  writeFileSync(handle, String(process.pid));
  closeSync(handle);
  return () => {
    if (existsSync(lock)) unlinkSync(lock);
  };
}
async function closeServer(server: Server) {
  server.closeIdleConnections();
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
}

export async function startSystem(config: Config) {
  if (
    config.paymentMode === 'binance' &&
    (!config.realEnabled || !realServices.length || !realPolicies.length)
  )
    throw new Error('CONFIGURE_REAL_MERCHANTS_AND_ENABLE_PAYMENTS_FIRST');
  const unlock = lockFile(config.databasePath);
  const servers: Server[] = [];
  let store: Store | undefined;
  try {
    store = new Store(config.databasePath, {
      wallet: config.wallet,
      maxPayment: config.maxPayment,
      dailyBudget: config.dailyBudget,
    });
    store.recover();
    const secret = randomBytes(32).toString('hex');
    const services = config.paymentMode === 'mock' ? mockServices() : realServices;
    if (config.paymentMode === 'mock')
      for (let i = 0; i < services.length; i++)
        servers.push(await startService(services[i]!, config.servicePorts[i]!, secret));
    const adapter =
      config.paymentMode === 'mock'
        ? new MockPaymentAdapter(secret)
        : new BinancePaymentAdapter(cliRunner(config.bawCliJs), realPolicies, config.realEnabled);
    const gateway = new PaymentGateway(
      store,
      adapter,
      fetch,
      config.paymentMode === 'binance' ? 4000 : 0,
    );
    const runner = new AgentRunner(config, store, gateway, services);
    const app = createApp(config, store, runner, services);
    const server = await listen(app, config.port);
    servers.push(server);
    let closing = false;
    return {
      url: address(server),
      store,
      services,
      runner,
      gateway,
      async close() {
        if (closing) return;
        closing = true;
        await runner.idle();
        await Promise.all(servers.map(closeServer));
        store!.close();
        unlock();
      },
    };
  } catch (error) {
    await Promise.all(servers.map(closeServer));
    store?.close();
    unlock();
    throw error;
  }
}
