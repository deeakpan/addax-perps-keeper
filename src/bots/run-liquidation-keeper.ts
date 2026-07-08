import { config, assertLiquidationKeeperConfig } from "../lib/config";
import { getPublicClient, getKeeperWallet } from "../lib/chain";
import { log } from "../lib/logger";
import { limitOrderStore } from "../lib/limit-order-store";
import { positionStore } from "../lib/position-store";
import { catchUpAllStacksFromChain } from "../lib/trade-events";
import { runTriggerKeeper } from "./trigger-keeper";

/** Single run (cron / manual). Syncs events then fires TP/SL/LIQ/open-limit triggers. */
async function main() {
  try {
    const { ensurePerpsDbSchema } = await import("../lib/ensure-db");
    await ensurePerpsDbSchema();
  } catch (e) {
    log.error("schema ensure skipped (continuing) — run `npm run db:init` if tables are missing", e);
  }
  assertLiquidationKeeperConfig();
  const publicClient = getPublicClient();
  await positionStore.loadFromSupabaseOnStart();
  await limitOrderStore.loadFromSupabaseOnStart();
  const sync = await catchUpAllStacksFromChain(publicClient);
  const trigger = await runTriggerKeeper(publicClient, getKeeperWallet());
  log.tick({
    block: positionStore.getLastProcessedBlock(),
    openPositions: positionStore.count(),
    openLimits: limitOrderStore.count(),
    sync,
    trigger,
    triggerLabel: "once",
  });
}

main().catch((e) => {
  log.error("fatal", e);
  process.exit(1);
});
