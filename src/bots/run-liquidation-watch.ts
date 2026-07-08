import { config, assertLiquidationKeeperConfig } from "../lib/config";
import { getPublicClient, getWsPublicClient, getKeeperWallet } from "../lib/chain";
import { log } from "../lib/logger";
import { limitOrderStore } from "../lib/limit-order-store";
import { positionStore } from "../lib/position-store";
import {
  catchUpAllStacksFromChain,
  subscribeGtradePositionEvents,
} from "../lib/trade-events";
import { runTriggerKeeper } from "./trigger-keeper";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runTriggerSweep(trigger: string) {
  const publicClient = getPublicClient();
  const wallet = getKeeperWallet();
  const triggerResult = await runTriggerKeeper(publicClient, wallet);
  log.tick({
    block: positionStore.getLastProcessedBlock(),
    openPositions: positionStore.count(),
    openLimits: limitOrderStore.count(),
    sync: {
      fromBlock: positionStore.getLastProcessedBlock(),
      toBlock: positionStore.getLastProcessedBlock(),
      logsProcessed: 0,
      upserted: 0,
      removed: 0,
    },
    trigger: triggerResult,
    triggerLabel: trigger,
  });
}

async function runPollLoop() {
  const publicClient = getPublicClient();
  for (;;) {
    try {
      const sync = await catchUpAllStacksFromChain(publicClient);
      const trigger = await runTriggerKeeper(publicClient, getKeeperWallet());
      log.tick({
        block: positionStore.getLastProcessedBlock(),
        openPositions: positionStore.count(),
        openLimits: limitOrderStore.count(),
        sync,
        trigger,
        triggerLabel: "poll",
      });
    } catch (e) {
      log.error("tick failed", e);
    }
    await sleep(config.pollIntervalMs);
  }
}

async function runEventSubscriptionLoop() {
  const httpClient = getPublicClient();
  const wsClient = getWsPublicClient();
  let triggerRunning = false;

  const maybeTrigger = async (label: string) => {
    if (triggerRunning) return;
    triggerRunning = true;
    try {
      await runTriggerSweep(label);
    } catch (e) {
      log.error("trigger sweep failed", e);
    } finally {
      triggerRunning = false;
    }
  };

  // Best-effort, non-blocking: on RPCs with slow/broken eth_getLogs the catch-up
  // can hang or fail — run it in the background so the live WS subscription
  // (which doesn't use getLogs) comes up immediately.
  void catchUpAllStacksFromChain(httpClient)
    .then((catchup) => {
      if (catchup.logsProcessed > 0) {
        log.info(
          `startup catch-up — ${catchup.logsProcessed} events | +${catchup.upserted} −${catchup.removed}`,
        );
      }
    })
    .catch((e) => log.error("startup catch-up skipped (continuing on live subscription)", e));

  await maybeTrigger("startup");

  let subscription: ReturnType<typeof subscribeGtradePositionEvents> | null = null;
  let triggerTimer: ReturnType<typeof setInterval> | null = null;

  return new Promise<void>((resolve, reject) => {
    const shutdown = () => {
      subscription?.stop();
      if (triggerTimer) clearInterval(triggerTimer);
      resolve();
    };

    subscription = subscribeGtradePositionEvents(
      wsClient,
      () => {
        void maybeTrigger("trade event");
      },
      {
        onFatal: (err) => {
          subscription?.stop();
          if (triggerTimer) clearInterval(triggerTimer);
          reject(err instanceof Error ? err : new Error(String(err)));
        },
      },
    );

    // Marks move without new trades — periodic TP/SL/LIQ/limit sweep.
    triggerTimer = setInterval(() => {
      void maybeTrigger("mark sweep");
    }, config.pollIntervalMs);

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
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
  const mode = config.syncMode === "websocket" ? "websocket" : "poll";

  log.watchStarted({
    mode,
    stacks: config.stacks.map((s) => s.id).join(", "),
    storages: config.stacks.map((s) => s.storage).join(", "),
    intervalMs: config.pollIntervalMs,
    wsUrl: config.rpcWsUrl,
    positions: hydrated.positions,
    openLimits,
    lastBlock: hydrated.lastBlock,
    hasIndexerState: hydrated.hasIndexerState,
  });

  if (mode === "websocket") {
    try {
      log.info("position sync — WS event subscription (no log polling)");
      await runEventSubscriptionLoop();
    } catch (e) {
      log.error("websocket subscription failed — falling back to poll", e);
      await runPollLoop();
    }
  } else {
    await runPollLoop();
  }
}

main().catch((e) => {
  log.error("fatal", e);
  process.exit(1);
});
