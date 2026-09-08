# LedgerMind Architecture

LedgerMind is split into a small web frontend and a local TypeScript backend.

```text
frontend/
  index.html
  app.ts
  style.css

backend/
  src/
    app.ts              Express API, SPA fallback router, and Treasury Analyzer routes
    system.ts           Server assembly and lifecycle
    store.ts            Storage manager (SQLite local / Supabase PostgreSQL Cloud) and audit ledger
    payments/           x402 browser wallet & payment adapters
    services/           Binance, CoinMarketCap, fixtures and registry
    agent/              Task runner and model providers (OpenAI, OpenRouter, Gemini)
  tests/
  scripts/
  docs/
```

## Treasury Analysis Flow

1. The browser posts wallet, chain, timeframe, and premium-data preference to `/api/treasury/analyze`.
2. The backend verifies the address and selected chain.
3. The analyzer reads native and token balances through public RPC calls.
4. It reads recent native transfers from Blockscout when available.
5. It prices tracked assets through Binance public market data.
6. It calculates treasury value, stablecoin buffer, net flow, burn estimate, runway, concentration, and risk score.
7. It saves a report record with a deterministic report hash.
8. It returns source statuses, a Markdown report, and a multisig-safe workflow draft.
9. Report history, report-bound chat, Markdown export, workflow draft, and audit endpoints operate from saved reports.
10. A compact audit event is appended to the local SHA-256 hash chain.

## x402 Boundary

x402 is treated as paid data access, not trading or custody. The existing payment adapter can preview, reserve budget, sign through Binance Agentic Wallet, replay the paid request, and store the merchant receipt. The UI reports x402 as unavailable unless the configured live payment mode is present.
