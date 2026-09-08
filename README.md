# LedgerMind

LedgerMind is an Agent OS treasury intelligence workflow for onchain teams. It reads real public chain data, Binance market prices, and local audit state to produce treasury metrics, risk signals, and human-approved workflow drafts.

## Project Structure

```text
LedgerMind/
  frontend/
    index.html
    app.ts
    style.css
    favicon.svg

  backend/
    src/
    scripts/
    tests/
    docs/

  package.json
  package-lock.json
  README.md
  .env.example
  .env.live.example
```

## What It Does

- Analyzes a public treasury wallet on Base or BNB Smart Chain.
- Fetches native and selected ERC-20 balances through live RPC calls.
- Fetches recent native transfers from Blockscout when available.
- Prices tracked assets with Binance public market data.
- Calculates treasury value, stablecoin buffer, net flow, burn estimate, runway, concentration, and risk score.
- Drafts a multisig-safe treasury review proposal.
- Saves report history locally with a report hash.
- Answers treasury questions from the selected report.
- Exports the full report as Markdown.
- Shows report-linked audit events from the append-only audit chain.
- Reports x402 premium data status without pretending a payment occurred.

## x402 Positioning

LedgerMind keeps x402 as paid data access, not trading. The existing server still contains the Binance Agentic Wallet + x402 payment gateway, budget reservations, and SHA-256 audit ledger. Real payment mode is gated by configuration:

```dotenv
PAYMENT_MODE=binance
REAL_PAYMENTS_ENABLED=true
BAW_CLI_JS=C:/absolute/path/to/@binance/agentic-wallet/dist/index.js
```

If x402 is not configured, the UI says so. It does not show fake receipts or fake settlement links.

## Quick Start

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd start
```

Open `http://127.0.0.1:3000`.

## Demo Flow

1. Enter a real treasury wallet.
2. Select Base or BNB Smart Chain.
3. Run Treasury Analysis.
4. Show live RPC balances, market pricing, source statuses, risk register, and workflow draft.
5. Explain that premium x402 data can be enabled through Binance Agentic Wallet configuration and is audited under spending caps.

## Main API

`POST /api/treasury/analyze`

```json
{
  "walletAddress": "0x...",
  "chainId": 8453,
  "timeframeDays": 30,
  "usePremiumData": true
}
```

The endpoint returns verified assets, recent transfers, treasury metrics, risk signals, data provenance, and a Markdown workflow draft.

Additional endpoints:

- `GET /api/reports`
- `GET /api/reports/:id`
- `GET /api/reports/:id/markdown`
- `GET /api/reports/:id/audit`
- `POST /api/agent/ask`
- `POST /api/workflows/draft`

## Docs

- `backend/docs/ARCHITECTURE.md`
- `backend/docs/DEMO.md`
- `backend/docs/X402.md`
