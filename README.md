<p align="center">
  <img src="frontend/assets/logo.svg" alt="LedgerMind logo" width="72" />
</p>

# LedgerMind

**Onchain evidence. Human decisions.**

LedgerMind helps teams understand a public treasury wallet: what it holds, how concentrated it is, and what its recent native transfers reveal. It combines public-chain balances, market reference prices, explainable risk signals, and saved reports in a local web workspace.

Standard treasury analysis requires a public wallet address and internet access. It does not require connecting a wallet, signing a transaction, or configuring a model API key.

## Product experience

| Page          | Purpose                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------ |
| `/`           | Landing page with product overview, illustrative allocation preview, and Binance market tickers. |
| `/dashboard`  | Treasury workspace. Launch the app here to run an analysis and review a report.                  |
| `/assets`     | Recent native transfers from the selected report.                                                |
| `/risk-audit` | Risk register and report-linked audit events.                                                    |
| `/copilot`    | Report-specific questions and a treasury review draft.                                           |
| `/premium`    | Dedicated x402 Premium Intelligence page with EIP-3009 micropayments, Top 10 Whale Wallet Tracking, AI Portfolio Strategy, and Liquidation Heatmaps. |
| `/docs`       | Getting started, supported assets, metric methodology, API reference, and data limitations.      |

The landing page introduces the product; analysis controls, report history, and workflow tools live in the dashboard. `/overview` remains available as an alias for the dashboard overview.

### Live Deployments

- **Vercel Frontend App:** [https://ledger-mind-kappa.vercel.app](https://ledger-mind-kappa.vercel.app)
- **Railway Production Backend:** [https://ledger-mind-production.up.railway.app](https://ledger-mind-production.up.railway.app)

### What you can do

- Read native and selected ERC-20 balances on **Base, Ethereum, BNB Smart Chain, Arbitrum, Polygon, and Optimism**.
- Review priced asset allocation and native inflow/outflow charts grouped by UTC date.
- Inspect treasury value, stablecoin buffer, concentration, estimated burn, and runway.
- Read rule-based risk explanations and data source statuses.
- Load saved reports, view a treasury brief, and export Markdown.
- Ask questions about the selected report powered by zero-config **Groq Free API** (`llama-3.3-70b-versatile`) or configurable providers.
- Inspect local audit evidence and unlock institutional telemetry on the dedicated `/premium` page.

Workflow drafts do not execute trades or submit multisig transactions. The current dashboard Q&A endpoint answers from report fields using rule-based responses; configurable model providers serve the separate agent task runner.

## Quick start

Requires **Node.js 22 or newer** and npm. Run these commands from the repository root:

```sh
npm ci
npm run build
npm start
```

Open [LedgerMind](http://127.0.0.1:3000), then select **Launch app**. The [documentation page](http://127.0.0.1:3000/docs) is available from the navbar.

On Windows PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`.

No environment file is needed for the default configuration. To customize it, copy [.env.example](.env.example) to `.env` and edit the relevant values. The default server port is `3000`; local mock services use ports `4101`–`4103`.

### Analyze a wallet

1. Launch the dashboard and select **Run Analysis**.
2. Enter a valid public EVM address or choose from presets (`vitalik.eth`, `Binance Hot`, `Justin Sun`, `EF Treasury`, `Uniswap`, `Kraken 1`).
3. Choose from 6 EVM networks (Base, Ethereum, BSC, Arbitrum, Polygon, Optimism) and select a 7, 30, or 90 day timeframe.
4. Review the source statuses, allocation, native cash flow, and risk register.
5. Open the brief, ask a report-specific question, or export a review draft.

Reports retain their observation time. Opening a saved report does not refresh its balances or prices; run a new analysis to obtain a new snapshot.

## Networks and assets

| Network         | Chain ID | Native asset | Tracked tokens       |
| --------------- | -------- | ------------ | -------------------- |
| Base            | `8453`   | ETH          | USDC, WETH, cbBTC    |
| Ethereum        | `1`      | ETH          | USDC, USDT, WETH, WBTC |
| BNB Smart Chain | `56`     | BNB          | USDT, USDC, WBNB     |
| Arbitrum One    | `42161`  | ETH          | USDC, USDT, ARB      |
| Polygon         | `137`    | POL          | USDC, USDT, WMATIC   |
| Optimism        | `10`     | ETH          | USDC, USDT, OP       |

Base uses ETH as its native asset. Wrapped assets retain their own tickers in reports; WETH, WBNB, and cbBTC use their underlying asset’s market reference price.

## Data and methodology

| Source                     | Use                                                                              |
| -------------------------- | -------------------------------------------------------------------------------- |
| Public RPC                 | Native balances and configured ERC-20 `balanceOf` calls.                         |
| Blockscout                 | Recent native transfer sample, when available.                                   |
| Binance public market data | Non-stable asset reference prices and BTC/ETH/BNB market tickers quoted in USDT. |
| Storage (Supabase) | Saved reports, task state, payment budget records, and audit events. Uses Cloud Supabase PostgreSQL with high-performance memory synchronization. |

- **Treasury value:** sum of tracked balances multiplied by available reference prices. Unpriced assets are excluded from the priced allocation chart.
- **Stablecoin buffer:** tracked USDC and USDT balances valued using a fixed $1 assumption. This is not a live depeg check.
- **Net native flow:** sampled native inflows minus sampled native outflows, valued at the analysis reference price.
- **Monthly burn estimate:** sampled native outflow × 30 ÷ selected timeframe in days.
- **Runway estimate:** stablecoin buffer ÷ monthly burn. Without observed outbound burn, runway cannot be estimated.
- **Concentration:** largest tracked holding’s share of total tracked value. Risk signals also consider source availability, stablecoin coverage, and runway.

### Coverage limits

The analyzer uses up to **20 returned native transfers** within the selected timeframe. It does not reconstruct a complete transaction ledger, ERC-20 transfer history, internal calls, or DeFi positions. Flow and runway estimates inherit this sampling limit.

USD values use market references and stablecoin assumptions, not historical execution prices. RPC failures, missing prices, and unavailable explorer data can make a report incomplete; review source statuses before interpreting the numbers.

The landing allocation preview is explicitly illustrative. Market tickers use fetched quotes with observation metadata; cached quotes are labeled and unavailable quotes are not replaced with invented prices. They are independent of prices in saved reports.

The SHA-256 audit chain can detect modifications against a trusted checkpoint. It is not external notarization.

## Configuration and optional paid data

Default configuration uses built-in fallback defaults for demo and fixture modes, keeping `.env` clean and minimal.

| Setting | Purpose |
| --- | --- |
| `PORT` | Web server port; defaults to `3000`. |
| `SUPABASE_URL` | Supabase Project URL (e.g. `https://xxxx.supabase.co`). |
| `SUPABASE_ANON_KEY` | Supabase anonymous public API key. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role secret key. |
| `AGENT_MODE` | Task runner provider: `demo` or `groq`. Defaults to `groq`. |
| `GROQ_API_KEY` | Groq API Key for LPU inference. |
| `GROQ_MODEL` | Groq Model; defaults to `llama-3.3-70b-versatile`. |
| `PAYMENT_MODE` | `mock` or `binance` payment adapter. Defaults to `mock`. |
| `REAL_PAYMENTS_ENABLED` | Explicit gate for real payments; defaults to `false`. |
| `BROWSER_PREMIUM_ENABLED` | Enables browser x402 payment authorization modal; defaults to `true`. |

x402 supports optional paid data access. The dashboard uses **RainbowKit, wagmi, and viem** to connect a browser wallet and sign a one-time USDC authorization. This flow is independent of the Binance Agentic Wallet task runner and does not require a model key or backend wallet CLI.

1. Run an analysis or load a saved report, then find the **Premium / CoinMarketCap** panel.
2. Select **Connect Wallet** and choose an installed wallet. For mobile QR connections, set `WALLETCONNECT_PROJECT_ID` to a public project ID from the [Reown dashboard](https://dashboard.reown.com).
3. Select a supported report asset and **Get premium quote**. Switch to Base when prompted. The backend checks USDC balance and the merchant’s payment requirements.
4. Review the paying wallet, recipient, price, and expiry. Select **Confirm & pay 0.01 USDC** and approve the typed authorization in your wallet.
5. The dashboard displays the merchant settlement receipt and market data, with a Base explorer link and Markdown supplement export. Reopening the report loads saved purchases.

`BROWSER_PREMIUM_ENABLED=true` enables this flow; set it to `false` to disable browser payment submissions. Extension wallets work without a WalletConnect project ID. The currently supported signers are standard EOA wallets; smart contract wallets are rejected during preflight. The paying wallet can differ from the analyzed address.

Purchases are persisted by report, payer, and asset. Pending or uncertain submissions cannot be automatically charged again. Use **Refresh status** after a network interruption. A merchant-confirmed payment with failed data delivery retains its receipt. Supplements do not rewrite the original report snapshot. Daily limits apply per paying wallet in the browser flow.

See [x402 documentation](backend/docs/X402.md) for both payment paths. Configure standard environment values using [.env.example](.env.example). Model-provider charges are separate from paid-data budgets. The application remains a local, loopback-bound workspace; wallet connection is not a multi-user login system.

## API

### Create a treasury report

`POST /api/treasury/analyze`

```json
{
  "walletAddress": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  "chainId": 8453,
  "timeframeDays": 30,
  "usePremiumData": false,
  "authorizePremiumPayment": false
}
```

Replace the example address with the wallet you want to inspect. The API accepts an integer timeframe from 7 to 90 days. Responses include report metadata, assets, transactions, metrics, risks, source statuses, a brief, a workflow draft, and premium-data status.

| Endpoint                        | Purpose                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------ |
| `GET /api/health`               | Server health.                                                                                   |
| `GET /api/tickers`              | BTC, ETH, and BNB quotes in USDT; observation and stale status are returned in response headers. |
| `GET /api/reports`              | List saved reports.                                                                              |
| `GET /api/reports/:id`          | Load a saved report.                                                                             |
| `GET /api/reports/:id/markdown` | Export Markdown.                                                                                 |
| `GET /api/reports/:id/audit`    | Read report-linked audit evidence.                                                               |
| `POST /api/agent/ask`           | Ask a question using `reportId` and `question`.                                                  |
| `POST /api/workflows/draft`     | Retrieve a workflow draft using `reportId`.                                                      |

## Development

The frontend uses TypeScript, native browser APIs, SVG, and modular CSS, with an isolated React/RainbowKit premium panel loaded when opening the dashboard. esbuild bundles the wallet UI into browser modules. The backend uses TypeScript, Express, Zod, viem signature verification, and Supabase.

```text
frontend/
  index.html              Page shells and dashboard markup
  app.ts                  Application bootstrap and report rendering
  src/components/         Routing, marketing/docs, charts, and dashboard panels
  src/api/                Typed API client
  src/types/              Treasury report types
  css/                    Shared and responsive styles
  assets/logo.svg         Folded-ledger brand mark
  favicon.svg             Browser icon
backend/
  src/                    API, storage, agent runner, services, and payments
  scripts/                Setup, diagnostics, and browser verification
  tests/                  Automated backend tests
  docs/                   Architecture and workflow notes
dist/                     Generated build output
data/                     Local runtime data and UI verification artifacts
```

| Command                  | Purpose                                                                   |
| ------------------------ | ------------------------------------------------------------------------- |
| `npm run dev`            | Build the frontend once and watch the backend.                            |
| `npm run build:frontend` | Compile browser code and copy HTML, CSS, and assets into `dist/frontend`. |
| `npm run build`          | Build the backend and frontend.                                           |
| `npm test`               | Run the backend test suite.                                               |
| `npm run check`          | Build and run backend tests.                                              |

After frontend edits, rerun `npm run build:frontend` and refresh the browser. `npm run dev` does not watch frontend files. Restart the server after rebuilding backend changes when using `npm start`.

Browser verification is available with `node --import tsx backend/scripts/verify-ui.ts`. The script currently expects Chrome at `C:/Program Files/Google/Chrome/Application/chrome.exe`; adjust its executable path for another installation. It uses an isolated test database and mocked report/quote responses to check navigation, page reloads, chart rendering, dialogs, and mobile overflow. Screenshots are saved in `data/ui-check/`; they do not verify live provider availability.

## Further reading

- [In-app documentation](http://127.0.0.1:3000/docs)
- [Architecture](backend/docs/ARCHITECTURE.md)
- [Demo walkthrough](backend/docs/DEMO.md)
- [x402 paid data](backend/docs/X402.md)

### Private reports and premium purchases

Connect the wallet, then sign the login challenge to prove ownership. This login signature does not authorize a payment; paying requires a separate confirmation. Premium history and receipts are restricted to the authenticated paying wallet, including purchases with `reportId: global`. Here `global` means a standalone market purchase, not public access.

Anonymous reports belong to the current browser session. Signing in attaches those reports to that wallet. Report URLs, downloads, and report-based actions enforce ownership on the server. Sessions expire after seven days. Legacy reports without recorded ownership remain stored but are hidden; they are not automatically assigned to the next visitor.

The WalletConnect project ID is public application configuration, not a user ID or an access-control mechanism. Legacy operator/task APIs still require a separate authorization review before a public multi-user deployment.

### Wallet sign-in behind the Vercel proxy

Set `APP_ORIGIN=https://ledger-mind-kappa.vercel.app` in the Railway backend variables (no trailing slash). Deploy the updated backend and frontend, then refresh the browser. The Vercel API rewrite changes the backend Host, so the exact public frontend origin must be explicitly allowed. This setting also supplies the HTTPS domain/URI in the sign-in message and enables Secure session cookies. Keep API calls on the same frontend `/api` proxy so browser session cookies remain first-party. Leave APP_ORIGIN blank for direct localhost development.

