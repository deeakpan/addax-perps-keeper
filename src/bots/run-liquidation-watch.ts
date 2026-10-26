import { config, assertLiquidationKeeperConfig } from "../lib/config";
import { getPublicClient, getKeeperWallet } from "../lib/chain";
import { log } from "../lib/logger";
import { limitOrderStore } from "../lib/limit-order-store";
import { positionStore } from "../lib/position-store";
import { fulfillPendingMarketOrders } from "../lib/fulfill-pending";
import { runTriggerKeeper } from "./trigger-keeper";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Reload open positions + open limits from Goldsky (Supabase fallback inside stores). */
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
  let marketOrderCursor: bigint | null = null;
  let lastTriggerSweepAt = 0;

  for (;;) {
    try {
      const publicClient = getPublicClient();
      const head = await publicClient.getBlockNumber();
      const fromBlock: bigint = marketOrderCursor === null
        ? BigInt(Math.max(config.deployBlock ?? 0, Number(head) - config.marketOrderRecoveryBlocks))
        : marketOrderCursor + 1n;

      if (fromBlock <= head) {
        if (marketOrderCursor === null) marketOrderCursor = fromBlock - 1n;
        const result = await fulfillPendingMarketOrders(
          publicClient,
          getKeeperWallet(),
          fromBlock,
          head,
        );
        if (result.errors.length === 0) marketOrderCursor = head;
        log.info(
          `market-order scan block ${fromBlock}→${head} | scanned ${result.scanned} | fulfilled ${result.fulfilled} | skipped ${result.skipped} | errors ${result.errors.length}`,
        );
        for (const error of result.errors) log.error("market-order fulfillment failed", error);
      }

      const now = Date.now();
      if (now - lastTriggerSweepAt >= config.pollIntervalMs) {
        await runTriggerSweep("trigger-and-limit-orders");
        lastTriggerSweepAt = now;
      }
    } catch (e) {
      log.error("auto keeper tick failed", e);
    }
    await sleep(config.marketOrderPollIntervalMs);
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
    intervalMs: config.marketOrderPollIntervalMs,
    stacks: config.stacks.map((s) => s.id).join(", "),
    storages: config.stacks.map((s) => s.storage).join(", "),
    positions: hydrated.positions,
    openLimits,
    lastBlock: hydrated.lastBlock,
    hasIndexerState: hydrated.hasIndexerState,
  });
  log.info("automatic keeper active — pending market orders polled continuously; TP/SL/liquidations/limits swept on interval");

  await runPollLoop();
}

main().catch((e) => {
  log.error("fatal", e);
  process.exit(1);
});
