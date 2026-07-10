import type { Address, Hash, PublicClient, WalletClient } from "viem";
import {
  gtradeNftRewardsAbi,
  gtradePairInfosAbi,
  gtradeStorageAbi,
  GTRADE_OPEN_LIMIT_LEGACY,
  GTRADE_OPEN_LIMIT_MOMENTUM,
  GTRADE_OPEN_LIMIT_REVERSAL,
  parseOpenTrade,
  parseOpenTradeInfo,
} from "../lib/abis";
import { stackByStorage, type KeeperStackConfig } from "../lib/config";
import { parseGtradePositionKey } from "../lib/gtrade-keys";
import { GTRADE_DAI_PRECISION } from "../lib/markets";
import { limitOrderStore } from "../lib/limit-order-store";
import { positionStore } from "../lib/position-store";
import { fetchPairMarkPrice } from "../lib/price";
import { config } from "../lib/config";
import { log } from "../lib/logger";
import { triggerNftOrder } from "../lib/nft-orders";
import { loadPositionRowFromChain } from "../lib/position-from-chain";

export type TriggerKeeperResult = {
  scannedPositions: number;
  scannedLimits: number;
  triggered: { type: string; key: string; orderId?: string }[];
  txs: Hash[];
  skipped: { key: string; reason: string }[];
  errors: string[];
};

async function readOpenTrade(
  publicClient: PublicClient,
  storage: `0x${string}`,
  trader: Address,
  pairIndex: number,
  tradeIndex: number,
) {
  const trade = parseOpenTrade(
    await publicClient.readContract({
      address: storage,
      abi: gtradeStorageAbi,
      functionName: "openTrades",
      args: [trader, BigInt(pairIndex), BigInt(tradeIndex)],
    }),
  );
  if (trade.leverage === 0n) return null;
  const info = parseOpenTradeInfo(
    await publicClient.readContract({
      address: storage,
      abi: gtradeStorageAbi,
      functionName: "openTradesInfo",
      args: [trader, BigInt(pairIndex), BigInt(tradeIndex)],
    }),
  );
  return { trade, info };
}

function isLiquidatableAtMark(buy: boolean, markPrice: bigint, liqPrice: bigint): boolean {
  if (liqPrice === 0n) return false;
  return buy ? markPrice <= liqPrice : markPrice >= liqPrice;
}

function isTpTriggered(buy: boolean, markPrice: bigint, tp: bigint): boolean {
  if (tp === 0n) return false;
  return buy ? markPrice >= tp : markPrice <= tp;
}

function isSlTriggered(buy: boolean, markPrice: bigint, sl: bigint): boolean {
  if (sl === 0n) return false;
  return buy ? markPrice <= sl : markPrice >= sl;
}

/** Whether a pending open-limit order should fire at the current mark. */
function isOpenLimitTriggered(
  limitType: number,
  buy: boolean,
  markPrice: bigint,
  minPrice: bigint,
  maxPrice: bigint,
): boolean {
  if (limitType === GTRADE_OPEN_LIMIT_LEGACY) {
    return markPrice >= minPrice && markPrice <= maxPrice;
  }
  if (limitType === GTRADE_OPEN_LIMIT_REVERSAL) {
    // Buy limit below market: fire when price drops to maxPrice.
    // Sell limit above market: fire when price rises to minPrice.
    return buy ? markPrice <= maxPrice : markPrice >= minPrice;
  }
  if (limitType === GTRADE_OPEN_LIMIT_MOMENTUM) {
    return buy ? markPrice >= minPrice : markPrice <= maxPrice;
  }
  return false;
}

/**
 * Scan open positions for TP/SL/LIQ triggers and pending open-limit orders,
 * then execute via executeNftOrder + fulfillOrder (DIA two-step flow).
 */
export async function runTriggerKeeper(
  publicClient: PublicClient,
  wallet: WalletClient,
): Promise<TriggerKeeperResult> {
  const result: TriggerKeeperResult = {
    scannedPositions: 0,
    scannedLimits: 0,
    triggered: [],
    txs: [],
    skipped: [],
    errors: [],
  };

  const markCache = new Map<number, bigint | null>();

  async function getMark(pairIndex: number): Promise<bigint | null> {
    if (!markCache.has(pairIndex)) {
      markCache.set(pairIndex, await fetchPairMarkPrice(publicClient, pairIndex, config.diaOracle));
    }
    return markCache.get(pairIndex) ?? null;
  }

  // ── Open positions: TP / SL / LIQ ──────────────────────────────────────────
  for (const row of positionStore.list()) {
    result.scannedPositions += 1;
    const stack = stackByStorage(row.vault_address);
    if (!stack) {
      result.skipped.push({ key: row.position_key, reason: "unknown_stack" });
      continue;
    }

    const parsed = parseGtradePositionKey(row.position_key, row.vault_address);
    if (!parsed) {
      result.skipped.push({ key: row.position_key, reason: "invalid_position_key" });
      continue;
    }

    const trader = parsed.trader as Address;
    const { pairIndex, tradeIndex } = parsed;

    const open = await readOpenTrade(publicClient, stack.storage, trader, pairIndex, tradeIndex);
    if (!open) {
      await positionStore.removeOpen(row.position_key);
      continue;
    }

    const { trade, info } = open;
    const markPrice = await getMark(pairIndex);
    if (markPrice === null) {
      result.skipped.push({ key: row.position_key, reason: "no_mark_price" });
      continue;
    }

    const collateral =
      (trade.initialPosToken * info.tokenPriceDai) / GTRADE_DAI_PRECISION;

    const liqPrice = await publicClient.readContract({
      address: stack.pairInfos,
      abi: gtradePairInfosAbi,
      functionName: "getTradeLiquidationPrice",
      args: [
        trader,
        BigInt(pairIndex),
        BigInt(tradeIndex),
        trade.openPrice,
        trade.buy,
        collateral,
        trade.leverage,
      ],
    });

    let triggerType: "tp" | "sl" | "liq" | null = null;

    if (isTpTriggered(trade.buy, markPrice, trade.tp)) {
      triggerType = "tp";
    } else if (isSlTriggered(trade.buy, markPrice, trade.sl)) {
      triggerType = "sl";
    } else if (isLiquidatableAtMark(trade.buy, markPrice, liqPrice)) {
      if (trade.sl > 0n && !(trade.buy ? liqPrice > trade.sl : liqPrice < trade.sl)) {
        result.skipped.push({ key: row.position_key, reason: "sl_blocks_liq" });
        continue;
      }
      triggerType = "liq";
    }

    if (!triggerType) continue;

    const trigger = await triggerNftOrder(publicClient, wallet, stack, {
      type: triggerType,
      trader,
      pairIndex,
      index: tradeIndex,
    });

    if (trigger.ok) {
      result.triggered.push({
        type: triggerType,
        key: row.position_key,
        orderId: trigger.orderId,
      });
      result.txs.push(trigger.fulfillTx);
      await positionStore.removeOpen(row.position_key);
      log.info(
        `[${stack.id}] ${triggerType.toUpperCase()} triggered — ${row.position_key} order ${trigger.orderId}`,
      );
    } else if (trigger.skipped) {
      result.skipped.push({ key: row.position_key, reason: trigger.reason });
    } else {
      result.errors.push(`${row.position_key} ${triggerType}: ${trigger.reason}`);
    }
  }

  // ── Pending open-limit orders ─────────────────────────────────────────────
  for (const limit of limitOrderStore.list()) {
    result.scannedLimits += 1;
    const stack = stackByStorage(limit.vault_address);
    if (!stack) {
      result.skipped.push({ key: limit.order_key, reason: "unknown_stack" });
      continue;
    }

    const trader = limit.account as Address;
    const { pair_index: pairIndex, limit_index: limitIndex } = limit;

    const stillPending = await publicClient.readContract({
      address: stack.storage,
      abi: gtradeStorageAbi,
      functionName: "hasOpenLimitOrder",
      args: [trader, BigInt(pairIndex), BigInt(limitIndex)],
    });
    if (!stillPending) {
      await limitOrderStore.remove(limit.order_key);
      continue;
    }

    const rawLimit = await publicClient.readContract({
      address: stack.storage,
      abi: gtradeStorageAbi,
      functionName: "getOpenLimitOrder",
      args: [trader, BigInt(pairIndex), BigInt(limitIndex)],
    });
    const o = rawLimit as {
      buy: boolean;
      minPrice: bigint;
      maxPrice: bigint;
    };

    const limitType = Number(
      await publicClient.readContract({
        address: stack.nftRewards,
        abi: gtradeNftRewardsAbi,
        functionName: "openLimitOrderTypes",
        args: [trader, BigInt(pairIndex), BigInt(limitIndex)],
      }),
    );

    const markPrice = await getMark(pairIndex);
    if (markPrice === null) {
      result.skipped.push({ key: limit.order_key, reason: "no_mark_price" });
      continue;
    }

    if (!isOpenLimitTriggered(limitType, o.buy, markPrice, o.minPrice, o.maxPrice)) {
      continue;
    }

    const trigger = await triggerNftOrder(publicClient, wallet, stack, {
      type: "open",
      trader,
      pairIndex,
      index: limitIndex,
    });

    if (trigger.ok) {
      result.triggered.push({
        type: "open",
        key: limit.order_key,
        orderId: trigger.orderId,
      });
      result.txs.push(trigger.fulfillTx);
      const blockNum = Number(await publicClient.getBlockNumber());
      const positionRow = await loadPositionRowFromChain(
        publicClient,
        stack,
        trader,
        pairIndex,
        limitIndex,
        blockNum,
      );
      if (positionRow) {
        await positionStore.upsertOpen(positionRow);
      }
      await limitOrderStore.remove(limit.order_key);
      log.info(
        `[${stack.id}] open-limit triggered — ${limit.order_key} order ${trigger.orderId}`,
      );
    } else if (trigger.skipped) {
      result.skipped.push({ key: limit.order_key, reason: trigger.reason });
    } else {
      result.errors.push(`${limit.order_key} open: ${trigger.reason}`);
    }
  }

  return result;
}
