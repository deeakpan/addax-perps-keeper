import { config, assertLiquidationKeeperConfig } from "../lib/config";
import { getPublicClient, getKeeperWallet } from "../lib/chain";
import { log } from "../lib/logger";
import { limitOrderStore } from "../lib/limit-order-store";
import { positionStore } from "../lib/position-store";
import { runTriggerKeeper } from "./trigger-keeper";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Testnet mode: UI syncs Supabase after txs; keeper only reloads DB + runs triggers. */
async function reloadStoresFromSupabase() {
  await Promise.all([positionStore.reloadFromSupabase(), limitOrderStore.reloadFromSupabase()]);
}

async function runTriggerSweep(triggerLabel: string) {
  const publicClient = getPublicClient();
  await reloadStoresFromSupabase();
  const triggerResult = await runTriggerKeeper(publicClient, getKeeperWallet());
  log.tick({
    block: positionStore.getLastProcessedBlock(),
    openPositions: positionStore.count(),
    openLimits: limitOrderStore.count(),
    sync: {
      fromBlock: 0,
      toBlock: 0,
      logsProcessed: 0,
      upserted: 0,
      removed: 0,
    },
    trigger: triggerResult,
    triggerLabel,
  });
}

async function runPollLoop() {
  for (;;) {
    try {
      await runTriggerSweep("trigger-only");
    } catch (e) {
      log.error("tick failed", e);
    }
    await sleep(config.pollIntervalMs);
  }
}

async function main() {
  try {
    const { ensurePerpsDbSchema } = await import("../lib/ensure-db");
    await ensurePerpsDbSchema();
  } catch (e) {
    log.error("schema ensure skipped (continuing) — run `npm run db:init` if tables are missing", e);
  }
  assertLiquidationKeeperConfig();

  const hydrated = await positionStore.loadFromSupabaseOnStart();
  const openLimits = await limitOrderStore.loadFromSupabaseOnStart();

  log.watchStarted({
    mode: "poll",
    stacks: config.stacks.map((s) => s.id).join(", "),
    storages: config.stacks.map((s) => s.storage).join(", "),
    intervalMs: config.pollIntervalMs,
    positions: hydrated.positions,
    openLimits,
    lastBlock: hydrated.lastBlock,
    hasIndexerState: hydrated.hasIndexerState,
  });
  log.info("indexer — disabled (testnet UI sync); keeper runs TP/SL/liq/limit triggers only");

  await runPollLoop();
}

main().catch((e) => {
  log.error("fatal", e);
  process.exit(1);
});
