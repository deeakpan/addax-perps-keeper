import type { Address, Hash, PublicClient, WalletClient } from "viem";
import {
  GTRADE_LIMIT_LIQ,
  gtradePairInfosAbi,
  gtradeStorageAbi,
  gtradeTradingAbi,
  parseOpenTrade,
  parseOpenTradeInfo,
} from "../lib/abis";
import { stackByStorage } from "../lib/config";
import { parseGtradePositionKey } from "../lib/gtrade-keys";
import { GTRADE_DAI_PRECISION } from "../lib/markets";
import { positionStore } from "../lib/position-store";
import { fetchPairMarkPrice } from "../lib/price";
import { config } from "../lib/config";

export type LiquidationCandidate = {
  positionKey: string;
  trader: Address;
  pairIndex: number;
  tradeIndex: number;
  isLong: boolean;
  markPrice: string;
  liquidationPrice: string;
  stackId: string;
};

export type LiquidationKeeperResult = {
  scanned: number;
  liquidatable: LiquidationCandidate[];
  txs: Hash[];
  skipped: { positionKey: string; reason: string }[];
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

function isLiquidatableAtMark(
  buy: boolean,
  markPrice: bigint,
  liqPrice: bigint,
): boolean {
  if (liqPrice === 0n) return false;
  return buy ? markPrice <= liqPrice : markPrice >= liqPrice;
}

/** Liquidate underwater gTrade positions via `executeNftOrder(LIQ)`. */
export async function runLiquidationKeeper(
  publicClient: PublicClient,
  wallet: WalletClient,
): Promise<LiquidationKeeperResult> {
  const rows = positionStore.list();
  const liquidatable: LiquidationCandidate[] = [];
  const skipped: { positionKey: string; reason: string }[] = [];
  const txs: Hash[] = [];

  for (const row of rows) {
    const stack = stackByStorage(row.vault_address);
    if (!stack) {
      skipped.push({ positionKey: row.position_key, reason: "unknown_stack" });
      continue;
    }

    const parsed = parseGtradePositionKey(row.position_key, row.vault_address);
    if (!parsed) {
      skipped.push({ positionKey: row.position_key, reason: "invalid_position_key" });
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

    const markPrice = await fetchPairMarkPrice(publicClient, pairIndex, config.diaOracle);
    if (markPrice === null) {
      skipped.push({ positionKey: row.position_key, reason: "no_mark_price" });
      continue;
    }

    if (!isLiquidatableAtMark(trade.buy, markPrice, liqPrice)) {
      continue;
    }

    if (
      trade.sl > 0n &&
      !(trade.buy ? liqPrice > trade.sl : liqPrice < trade.sl)
    ) {
      skipped.push({ positionKey: row.position_key, reason: "sl_blocks_liq" });
      continue;
    }

    liquidatable.push({
      positionKey: row.position_key,
      trader,
      pairIndex,
      tradeIndex,
      isLong: trade.buy,
      markPrice: markPrice.toString(),
      liquidationPrice: liqPrice.toString(),
      stackId: stack.id,
    });

    const hash = await wallet.writeContract({
      address: stack.trading,
      abi: gtradeTradingAbi,
      functionName: "executeNftOrder",
      args: [
        GTRADE_LIMIT_LIQ,
        trader,
        BigInt(pairIndex),
        BigInt(tradeIndex),
        BigInt(stack.keeperNftId),
        BigInt(stack.keeperNftType),
      ],
      account: wallet.account!,
      chain: wallet.chain,
    });

    await publicClient.waitForTransactionReceipt({ hash });
    txs.push(hash);
  }

  return { scanned: rows.length, liquidatable, txs, skipped };
}
