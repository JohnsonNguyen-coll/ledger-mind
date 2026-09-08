import express from 'express';
import type { Server } from 'node:http';
import type { Service, Symbol } from '../types.js';
import { verifyReceipt } from '../payments/mock.js';
import { fixture } from './fixtures.js';

export function listen(app: ReturnType<typeof express>, port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, '127.0.0.1', () => resolve(server));
    server.once('error', reject);
  });
}
export function address(server: Server): string {
  const a = server.address();
  if (!a || typeof a === 'string') throw new Error('SERVER_NOT_READY');
  return `http://127.0.0.1:${a.port}`;
}
export async function startService(service: Service, port: number, secret: string) {
  if (service.id === 'cmc_quote') throw new Error('REAL_SERVICE_CANNOT_BE_MOCKED');
  const fixtureId = service.id;
  const app = express();
  app.disable('x-powered-by');
  app.get('/health', (_req, res) => res.json({ ok: true, service: service.id, mode: 'fixture' }));
  app.get('/data/:symbol', (req, res) => {
    const symbol = req.params.symbol;
    if (!['ETH', 'BTC', 'BNB', 'SOL'].includes(symbol))
      return res.status(400).json({ error: 'UNSUPPORTED_SYMBOL' });
    const resource = service.baseUrl + `/data/${symbol}`;
    const token = req.header('X-AlphaMesh-Receipt');
    if (!token)
      return res.status(402).json({
        protocol: 'alphamesh-mock-v1',
        serviceId: service.id,
        resource,
        amount: service.price,
        currency: 'DEMO_USD',
        expiresAt: Date.now() + 60_000,
      });
    try {
      const receipt = verifyReceipt(token, secret);
      if (
        receipt.resource !== resource ||
        receipt.serviceId !== service.id ||
        receipt.amount !== service.price ||
        receipt.taskId !== req.header('X-AlphaMesh-Task')
      )
        throw new Error('RECEIPT_MISMATCH');
      res.setHeader('Cache-Control', 'no-store');
      res.json(fixture(fixtureId, symbol as Symbol));
    } catch {
      res.status(403).json({ error: 'PAYMENT_RECEIPT_REJECTED' });
    }
  });
  const server = await listen(app, port);
  service.baseUrl = address(server);
  return server;
}
