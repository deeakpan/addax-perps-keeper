# Addax Perps Keepers

The `start` process is the continuously running keeper service. It polls all configured vault stacks for pending market opens and closes, simulates each fulfillment, and submits valid orders. It also sweeps TP/SL, liquidation, and limit-order work on `PERPS_POLL_INTERVAL_MS`. Market orders are checked every `PERPS_MARKET_ORDER_POLL_INTERVAL_MS` (3 seconds by default). No cron is needed for market-order fulfillment; run this process under a persistent process manager such as systemd, PM2, or the hosting platform's worker service.

## Run

1. Copy `.env.example` to `.env` and set `KEEPER_PRIVATE_KEY` for the wallet that owns the keeper NFT. The default deployment is NFT ID `1`, type `1`.
2. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for the existing trigger and position stores. `PONDER_RPC_URL` defaults to the LitVM RPC.
3. Run `npm install`, then `npm start`.

The watcher scans the last `PERPS_MARKET_ORDER_RECOVERY_BLOCKS` blocks at startup (10,000 by default), then advances its in-memory block cursor. Keep the worker running continuously; after a restart, the recovery scan catches recent events again.

## Deployment and subgraph configuration

- `deployments/liteforge-gtrade.json` is the keeper's current chain deployment manifest, including all three collateral stacks, keeper NFT, official DIA oracle, and pair feeds.
- `config/stacks.json` is the runtime stack-address configuration and can be used for overrides when no deployment manifest is available.
- `config/subgraphs.json` records the unified Goldsky endpoint, chain, contract deployment block, actual indexed-from block, and trading/callback addresses for each stack. Runtime queries filter by each stack's contract address. `GOLDSKY_PERPS_URL` can override the endpoint.
- The manifest points to the app's existing Goldsky deployment. Updating this JSON does not deploy or alter the hosted Goldsky subgraph itself.

`npm run once` performs a single trigger keeper pass; use `npm start` for automatic market-order processing.
