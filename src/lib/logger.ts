import type { TriggerKeeperResult } from "../bots/trigger-keeper";
import type { SyncGtradePositionsResult } from "./trade-events";

function ts(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function line(label: string, value: string | number): string {
  return `  ${label.padEnd(14)} ${value}`;
}

function formatErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null) {
    const o = err as Record<string, unknown>;
    if (typeof o.message === "string") return o.message;
    if (typeof o.details === "string") return o.details;
    if (typeof o.shortMessage === "string") return o.shortMessage;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

export const log = {
  info(msg: string) {
    console.log(`[${ts()}] ${msg}`);
  },

  detail(lines: string[]) {
    for (const l of lines) console.log(l);
  },

  error(msg: string, err?: unknown) {
    const extra = err !== undefined ? `: ${formatErr(err)}` : "";
    console.error(`[${ts()}] ERROR ${msg}${extra}`);
  },

  watchStarted(opts: {
    mode: "poll" | "websocket";
    stacks: string;
    storages: string;
    intervalMs: number;
    wsUrl?: string;
    positions: number;
    openLimits: number;
    lastBlock: number;
    hasIndexerState: boolean;
  }) {
    this.info(`perps keeper watch started (${opts.mode})`);
    this.detail([
      line("stacks", opts.stacks),
      line("storages", opts.storages),
      ...(opts.mode === "websocket"
        ? [line("websocket", opts.wsUrl ?? "—")]
        : [line("poll every", `${opts.intervalMs / 1000}s`)]),
      line("positions", `${opts.positions} open`),
      line("open limits", `${opts.openLimits} pending`),
      line("last block", opts.lastBlock),
      line("indexer", opts.hasIndexerState ? "resuming cursor" : "fresh bootstrap"),
    ]);
    console.log("");
  },

  syncBootstrap(fromBlock: number, toBlock: number, lookback: number) {
    this.info(`sync bootstrap — scanning last ${lookback} blocks`);
    this.detail([line("blocks", `${fromBlock + 1} → ${toBlock}`)]);
  },

  syncCatchupCapped(
    skipped: number,
    fromBlock: number,
    toBlock: number,
    lookback: number,
  ) {
    this.info(`sync catchup capped — skipped ${skipped} stale blocks`);
    this.detail([
      line("blocks", `${fromBlock} → ${toBlock}`),
      line("lookback", lookback),
    ]);
  },

  tick(opts: {
    block: number;
    openPositions: number;
    openLimits: number;
    sync: SyncGtradePositionsResult;
    trigger: TriggerKeeperResult;
    triggerLabel?: string;
  }) {
    const { sync, trigger } = opts;
    const label = opts.triggerLabel ? ` (${opts.triggerLabel})` : "";
    this.info(`tick${label}`);
    this.detail([
      line(
        "sync",
        `blocks ${sync.fromBlock}→${sync.toBlock} | logs ${sync.logsProcessed} | +${sync.upserted} −${sync.removed}`,
      ),
      line("positions", `${opts.openPositions} open`),
      line("open limits", `${opts.openLimits} pending`),
      line(
        "trigger",
        `pos ${trigger.scannedPositions} lim ${trigger.scannedLimits} | fired ${trigger.triggered.length} | txs ${trigger.txs.length}`,
      ),
      line("cursor", opts.block),
    ]);

    for (const t of trigger.triggered) {
      this.detail([line("  → fired", `${t.type} ${t.key}${t.orderId ? ` order=${t.orderId}` : ""}`)]);
    }
    for (const tx of trigger.txs) {
      this.detail([line("  tx", tx)]);
    }
    for (const s of trigger.skipped.slice(0, 8)) {
      this.detail([line("  skip", `${s.key}: ${s.reason}`)]);
    }
    if (trigger.skipped.length > 8) {
      this.detail([line("  skip", `…and ${trigger.skipped.length - 8} more`)]);
    }
    for (const e of trigger.errors) {
      this.detail([line("  err", e.slice(0, 200))]);
    }
    console.log("");
  },
};
