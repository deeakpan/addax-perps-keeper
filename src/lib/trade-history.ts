import type { Log } from "viem";
import { config } from "./config";
import type { KeeperStackConfig } from "./config";
import { gtradePosDaiToUsd, usdToGtradeDai } from "./gtrade-math";
import { marketSymbolForPairIndex } from "./markets";
import { createSupabaseService, type PerpTradeEventRow } from "./supabase";
import type { GtradeTrade } from "./trade-events";

const LIMIT_TP = 0;
const LIMIT_SL = 1;
const LIMIT_LIQ = 2;
const LIMIT_OPEN = 3;

function limitOrderTypeLabel(orderType: number): string {
  if (orderType === LIMIT_TP) return "tp";
  if (orderType === LIMIT_SL) return "sl";
  if (orderType === LIMIT_LIQ) return "liquidation";
  if (orderType === LIMIT_OPEN) return "limit";
  return "limit";
}

function marginAndSize(collateralUsdRaw: bigint, leverage: bigint) {
  const marginUsd = gtradePosDaiToUsd(collateralUsdRaw);
  const lev = leverage > 0n ? Number(leverage) : 1;
  return {
    collateral_usd: usdToGtradeDai(marginUsd).toString(),
    size_usd: usdToGtradeDai(marginUsd * lev).toString(),
    leverage: lev,
  };
}

export async function recordTradeEventFromLog(
  stack: KeeperStackConfig,
  entry: Log,
  eventName: "MarketExecuted" | "LimitExecuted",
  args: Record<string, unknown>,
): Promise<void> {
  if (entry.blockNumber == null || entry.logIndex == null) return;

  const storage = stack.storage.toLowerCase();
  const eventId = `${config.chainId}:${storage}:${entry.blockNumber}:${entry.logIndex}`;
  let row: PerpTradeEventRow | null = null;

  if (eventName === "MarketExecuted") {
    const a = args as {
      t: GtradeTrade;
      open: boolean;
      price: bigint;
      positionSizeDai: bigint;
      percentProfit: bigint;
      daiSentToTrader: bigint;
    };
    if (!a?.t) return;
    const { collateral_usd, size_usd, leverage } = marginAndSize(a.positionSizeDai, a.t.leverage);
    const executionPrice = a.price > 0n ? a.price : a.t.openPrice;
    row = {
      event_id: eventId,
      vault_address: storage,
      chain_id: config.chainId,
      account: a.t.trader.toLowerCase(),
      index_token: marketSymbolForPairIndex(Number(a.t.pairIndex)),
      pair_index: Number(a.t.pairIndex),
      trade_index: Number(a.t.index),
      event_name: eventName,
      action: a.open ? "open" : "close",
      order_type: "market",
      is_long: a.t.buy,
      price: executionPrice.toString(),
      entry_price: a.t.openPrice.toString(),
      size_usd,
      collateral_usd,
      leverage,
      percent_profit: a.open ? null : a.percentProfit.toString(),
      dai_sent_to_trader: a.open ? null : a.daiSentToTrader.toString(),
      block_number: Number(entry.blockNumber),
      tx_hash: entry.transactionHash ?? null,
      log_index: Number(entry.logIndex),
    };
  }

  if (eventName === "LimitExecuted") {
    const a = args as {
      t: GtradeTrade;
      orderType: number;
      price: bigint;
      positionSizeDai: bigint;
      percentProfit: bigint;
      daiSentToTrader: bigint;
    };
    if (!a?.t) return;
    const isOpen = a.orderType === LIMIT_OPEN;
    const { collateral_usd, size_usd, leverage } = marginAndSize(a.positionSizeDai, a.t.leverage);
    const executionPrice = a.price > 0n ? a.price : a.t.openPrice;
    row = {
      event_id: eventId,
      vault_address: storage,
      chain_id: config.chainId,
      account: a.t.trader.toLowerCase(),
      index_token: marketSymbolForPairIndex(Number(a.t.pairIndex)),
      pair_index: Number(a.t.pairIndex),
      trade_index: Number(a.t.index),
      event_name: eventName,
      action: isOpen ? "open" : "close",
      order_type: limitOrderTypeLabel(a.orderType),
      is_long: a.t.buy,
      price: executionPrice.toString(),
      entry_price: a.t.openPrice.toString(),
      size_usd,
      collateral_usd,
      leverage,
      percent_profit: isOpen ? null : a.percentProfit.toString(),
      dai_sent_to_trader: isOpen ? null : a.daiSentToTrader.toString(),
      block_number: Number(entry.blockNumber),
      tx_hash: entry.transactionHash ?? null,
      log_index: Number(entry.logIndex),
    };
  }

  if (!row) return;

  const supabase = createSupabaseService();
  const { error } = await supabase.from("perp_trade_events").upsert(row, { onConflict: "event_id" });
  if (error) throw error;
}
