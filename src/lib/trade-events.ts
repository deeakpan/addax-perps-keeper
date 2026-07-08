import type { Address, Log, PublicClient } from "viem";
import { decodeEventLog } from "viem";
import { gtradeCallbacksEventsAbi } from "./abis";
import type { KeeperStackConfig } from "./config";
import { config } from "./config";
import { log as botLog } from "./logger";
import { gtradePosDaiToUsd, usdToGtradeDai } from "./gtrade-math";
import { gtradePositionKey } from "./gtrade-keys";
import { marketSymbolForPairIndex } from "./markets";
import { positionStore } from "./position-store";
import { recordTradeEventFromLog } from "./trade-history";
import { applyOpenLimitLog, scanOpenLimitEvents } from "./limit-order-events";
import { limitOrderKey, limitOrderStore } from "./limit-order-store";
import { gtradeOpenLimitEventsAbi } from "./abis";
import type { PerpOpenPositionRow } from "./supabase";

const BLOCK_CHUNK = 2_000n;

/** LimitOrder enum — OPEN fills open a trade; others close it. */
const LIMIT_OPEN = 3;

export type GtradeTrade = {
  trader: Address;
  pairIndex: bigint;
  index: bigint;
  initialPosToken: bigint;
  positionSizeDai: bigint;
  openPrice: bigint;
  buy: boolean;
  leverage: bigint;
  tp: bigint;
  sl: bigint;
};

function logSortKey(entry: Log): string {
  const block = entry.blockNumber ?? 0n;
  const index = entry.logIndex ?? 0;
  return `${block.toString().padStart(16, "0")}:${index.toString().padStart(8, "0")}`;
}

function tradeToRow(
  stack: KeeperStackConfig,
  t: GtradeTrade,
  blockNum: number,
  executionPrice: bigint,
  collateralUsdRaw: bigint,
): PerpOpenPositionRow {
  const pairIndex = Number(t.pairIndex);
  const tradeIndex = Number(t.index);
  const trader = t.trader.toLowerCase();
  const leverage = t.leverage > 0n ? t.leverage : 1n;
  const marginUsd = gtradePosDaiToUsd(collateralUsdRaw);
  const marginStored = usdToGtradeDai(marginUsd);
  const sizeStored = usdToGtradeDai(marginUsd * Number(leverage));

  return {
    position_key: gtradePositionKey(stack.storage, trader, pairIndex, tradeIndex),
    vault_address: stack.storage.toLowerCase(),
    chain_id: config.chainId,
    account: trader,
    collateral_token: stack.collateralToken.toLowerCase(),
    index_token: marketSymbolForPairIndex(pairIndex),
    is_long: t.buy,
    pair_index: pairIndex,
    trade_index: tradeIndex,
    size_usd: sizeStored.toString(),
    collateral_usd: marginStored.toString(),
    average_price: executionPrice.toString(),
    opened_at_block: blockNum,
    updated_at_block: blockNum,
  };
}

export type ApplyEventResult = { upserted: number; removed: number };

export async function applyDecodedCallbackEvent(
  stack: KeeperStackConfig,
  eventName: string,
  args: Record<string, unknown>,
  blockNum: number,
): Promise<ApplyEventResult> {
  if (eventName === "MarketExecuted") {
    const a = args as {
      t: GtradeTrade;
      open: boolean;
      price: bigint;
      positionSizeDai: bigint;
    };
    if (!a?.t) return { upserted: 0, removed: 0 };
    if (a.open) {
      const executionPrice = a.price > 0n ? a.price : a.t.openPrice;
      const row = tradeToRow(stack, a.t, blockNum, executionPrice, a.positionSizeDai);
      await positionStore.upsertOpen(row);
      botLog.info(
        `[${stack.id}] position opened — ${row.index_token} ${row.is_long ? "long" : "short"} ${row.account.slice(0, 10)}…`,
      );
      return { upserted: 1, removed: 0 };
    }
    const key = gtradePositionKey(stack.storage, a.t.trader, Number(a.t.pairIndex), Number(a.t.index));
    await positionStore.removeOpen(key);
    botLog.info(`[${stack.id}] position closed — ${key}`);
    return { upserted: 0, removed: 1 };
  }

  if (eventName === "LimitExecuted") {
    const a = args as {
      t: GtradeTrade;
      limitIndex: bigint;
      orderType: number;
      price: bigint;
      positionSizeDai: bigint;
    };
    if (!a?.t) return { upserted: 0, removed: 0 };
    if (a.orderType === LIMIT_OPEN) {
      const executionPrice = a.price > 0n ? a.price : a.t.openPrice;
      const row = tradeToRow(stack, a.t, blockNum, executionPrice, a.positionSizeDai);
      await positionStore.upsertOpen(row);
      // The pending open-limit order became a live position — drop it from the limit store.
      const limitIdx = a.limitIndex != null ? Number(a.limitIndex) : Number(a.t.index);
      await limitOrderStore.remove(
        limitOrderKey(stack.storage, a.t.trader, Number(a.t.pairIndex), limitIdx),
      );
      botLog.info(
        `[${stack.id}] position opened (limit) — ${row.index_token} ${row.is_long ? "long" : "short"} ${row.account.slice(0, 10)}…`,
      );
      return { upserted: 1, removed: 0 };
    }
    const key = gtradePositionKey(stack.storage, a.t.trader, Number(a.t.pairIndex), Number(a.t.index));
    await positionStore.removeOpen(key);
    botLog.info(`[${stack.id}] position closed (limit) — ${key}`);
    return { upserted: 0, removed: 1 };
  }

  return { upserted: 0, removed: 0 };
}

async function applyCallbackLog(
  stack: KeeperStackConfig,
  entry: Log,
): Promise<ApplyEventResult> {
  if (!entry.topics.length || !entry.blockNumber) {
    return { upserted: 0, removed: 0 };
  }

  let decoded: { eventName: string; args: Record<string, unknown> };
  try {
    const d = decodeEventLog({
      abi: gtradeCallbacksEventsAbi,
      data: entry.data,
      topics: entry.topics,
    });
    if (!d.eventName) return { upserted: 0, removed: 0 };
    decoded = { eventName: d.eventName, args: (d.args ?? {}) as Record<string, unknown> };
  } catch {
    return { upserted: 0, removed: 0 };
  }

  const blockNum = Number(entry.blockNumber);
  const result = await applyDecodedCallbackEvent(stack, decoded.eventName, decoded.args, blockNum);
  if (decoded.eventName === "MarketExecuted" || decoded.eventName === "LimitExecuted") {
    try {
      await recordTradeEventFromLog(stack, entry, decoded.eventName, decoded.args);
    } catch (e) {
      botLog.error("trade history insert failed", e);
    }
  }
  await positionStore.persistLastProcessedBlock(stack.storage, blockNum);
  return result;
}

export type SyncGtradePositionsResult = {
  fromBlock: number;
  toBlock: number;
  logsProcessed: number;
  upserted: number;
  removed: number;
  stackId?: string;
};

export async function catchUpGtradePositionsFromChain(
  publicClient: PublicClient,
  stack: KeeperStackConfig,
): Promise<SyncGtradePositionsResult> {
  const callbacks = stack.callbacks;
  const storage = stack.storage.toLowerCase();

  const head = await publicClient.getBlockNumber();
  const confirmations = BigInt(config.syncConfirmations);
  const toBlock = head > confirmations ? head - confirmations : 0n;

  if (!positionStore.hasPersistedIndexerState(stack.storage)) {
    const cursor = positionStore.bootstrapScanCursor(stack.storage, toBlock);
    botLog.syncBootstrap(cursor, Number(toBlock), config.bootstrapLookbackBlocks);
  }

  const lastSynced = positionStore.getLastProcessedBlock(stack.storage);
  let fromBlock = BigInt(lastSynced) + 1n;

  if (fromBlock > toBlock) {
    return {
      fromBlock: Number(fromBlock),
      toBlock: Number(toBlock),
      logsProcessed: 0,
      upserted: 0,
      removed: 0,
      stackId: stack.id,
    };
  }

  const gap = toBlock - fromBlock + 1n;

  if (!positionStore.hasPersistedIndexerState(stack.storage)) {
    const maxCatchup = BigInt(Math.max(config.bootstrapLookbackBlocks, config.maxCatchupBlocks));
    if (gap > maxCatchup) {
      const lookback = BigInt(config.bootstrapLookbackBlocks);
      const previousFrom = fromBlock;
      const firstScan = toBlock > lookback ? toBlock - lookback : 0n;
      fromBlock = firstScan > 0n ? firstScan : 0n;
      botLog.syncCatchupCapped(
        Number(fromBlock > previousFrom ? fromBlock - previousFrom : 0n),
        Number(fromBlock),
        Number(toBlock),
        config.bootstrapLookbackBlocks,
      );
    }
  } else if (gap > 5000n) {
    botLog.info(`[${stack.id}] sync catchup — scanning ${gap.toString()} blocks (${fromBlock} → ${toBlock})`);
  }

  const allLogs: Log[] = [];
  for (let start = fromBlock; start <= toBlock; start += BLOCK_CHUNK) {
    const end = start + BLOCK_CHUNK - 1n > toBlock ? toBlock : start + BLOCK_CHUNK - 1n;
    const chunk = await publicClient.getLogs({
      address: callbacks,
      events: gtradeCallbacksEventsAbi,
      fromBlock: start,
      toBlock: end,
    });
    allLogs.push(...chunk);
  }

  allLogs.sort((a, b) => (logSortKey(a) < logSortKey(b) ? -1 : 1));

  let upserted = 0;
  let removed = 0;

  for (const entry of allLogs) {
    const r = await applyCallbackLog(stack, entry);
    upserted += r.upserted;
    removed += r.removed;
  }

  // Track pending open-limit orders (Trading contract events) over the same window.
  try {
    await scanOpenLimitEvents(publicClient, stack, fromBlock, toBlock);
  } catch (e) {
    botLog.error(`[${stack.id}] open-limit scan failed`, e);
  }

  await positionStore.persistLastProcessedBlock(stack.storage, Number(toBlock));

  return {
    fromBlock: Number(fromBlock),
    toBlock: Number(toBlock),
    logsProcessed: allLogs.length,
    upserted,
    removed,
    stackId: stack.id,
  };
}

export async function catchUpAllStacksFromChain(
  publicClient: PublicClient,
): Promise<SyncGtradePositionsResult> {
  const results = await Promise.all(
    config.stacks.map((stack) => catchUpGtradePositionsFromChain(publicClient, stack)),
  );
  return {
    fromBlock: Math.min(...results.map((r) => r.fromBlock)),
    toBlock: Math.max(...results.map((r) => r.toBlock)),
    logsProcessed: results.reduce((n, r) => n + r.logsProcessed, 0),
    upserted: results.reduce((n, r) => n + r.upserted, 0),
    removed: results.reduce((n, r) => n + r.removed, 0),
  };
}

export type PositionEventSubscription = {
  stop: () => void;
};

const WS_FATAL_COUNT = 3;
const WS_FATAL_WINDOW_MS = 45_000;

export function subscribeGtradePositionEvents(
  wsClient: PublicClient,
  onEvent?: (result: ApplyEventResult) => void,
  opts?: { onFatal?: (err: unknown) => void },
): PositionEventSubscription {
  let errorBurst = 0;
  let lastErrAt = 0;
  let fatal = false;
  const unwatchers: (() => void)[] = [];

  const onSubscriptionError = (label: string) => (err: unknown) => {
    if (fatal) return;
    const now = Date.now();
    errorBurst = now - lastErrAt < WS_FATAL_WINDOW_MS ? errorBurst + 1 : 1;
    lastErrAt = now;
    if (errorBurst === 1) {
      botLog.error(`${label} subscription error`, err);
    }
    if (errorBurst >= WS_FATAL_COUNT) {
      fatal = true;
      botLog.error(`${label} subscription failed repeatedly — WebSocket unusable`);
      opts?.onFatal?.(err);
    }
  };

  for (const stack of config.stacks) {
    const handleLogs = (logs: Log[]) => {
      void (async () => {
        for (const entry of logs) {
          try {
            const result = await applyCallbackLog(stack, entry);
            onEvent?.(result);
          } catch (e) {
            botLog.error(`[${stack.id}] event handler failed`, e);
          }
        }
      })();
    };

    unwatchers.push(
      wsClient.watchContractEvent({
        address: stack.callbacks,
        abi: gtradeCallbacksEventsAbi,
        eventName: "MarketExecuted",
        onLogs: handleLogs,
        onError: onSubscriptionError(`[${stack.id}] MarketExecuted`),
      }),
    );

    unwatchers.push(
      wsClient.watchContractEvent({
        address: stack.callbacks,
        abi: gtradeCallbacksEventsAbi,
        eventName: "LimitExecuted",
        onLogs: handleLogs,
        onError: onSubscriptionError(`[${stack.id}] LimitExecuted`),
      }),
    );

    const handleOpenLimitLogs = (logs: Log[]) => {
      void (async () => {
        for (const entry of logs) {
          try {
            await applyOpenLimitLog(stack, entry);
          } catch (e) {
            botLog.error(`[${stack.id}] open-limit event handler failed`, e);
          }
        }
      })();
    };

    for (const eventName of ["OpenLimitPlaced", "OpenLimitUpdated", "OpenLimitCanceled"] as const) {
      unwatchers.push(
        wsClient.watchContractEvent({
          address: stack.trading,
          abi: gtradeOpenLimitEventsAbi,
          eventName,
          onLogs: handleOpenLimitLogs,
          onError: onSubscriptionError(`[${stack.id}] ${eventName}`),
        }),
      );
    }

    botLog.info(
      `subscribed — [${stack.id}] MarketExecuted + LimitExecuted + open-limit events`,
    );
  }

  return {
    stop: () => {
      for (const unwatch of unwatchers) unwatch();
    },
  };
}
