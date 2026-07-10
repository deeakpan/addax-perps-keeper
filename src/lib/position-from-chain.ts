import type { Address, PublicClient } from "viem";
import { gtradeStorageAbi, parseOpenTrade, parseOpenTradeInfo } from "./abis";
import type { KeeperStackConfig } from "./config";
import { config } from "./config";
import { gtradePositionKey } from "./gtrade-keys";
import { gtradePosDaiToUsd, usdToGtradeDai } from "./gtrade-math";
import { GTRADE_DAI_PRECISION, marketSymbolForPairIndex } from "./markets";
import type { PerpOpenPositionRow } from "./supabase";

/** Build a Supabase position row from live gTrade storage (after keeper trigger). */
export async function loadPositionRowFromChain(
  publicClient: PublicClient,
  stack: KeeperStackConfig,
  trader: Address,
  pairIndex: number,
  tradeIndex: number,
  blockNum: number,
): Promise<PerpOpenPositionRow | null> {
  const trade = parseOpenTrade(
    await publicClient.readContract({
      address: stack.storage,
      abi: gtradeStorageAbi,
      functionName: "openTrades",
      args: [trader, BigInt(pairIndex), BigInt(tradeIndex)],
    }),
  );
  if (trade.leverage === 0n) return null;

  const info = parseOpenTradeInfo(
    await publicClient.readContract({
      address: stack.storage,
      abi: gtradeStorageAbi,
      functionName: "openTradesInfo",
      args: [trader, BigInt(pairIndex), BigInt(tradeIndex)],
    }),
  );

  const collateral = (trade.initialPosToken * info.tokenPriceDai) / GTRADE_DAI_PRECISION;
  const marginUsd = gtradePosDaiToUsd(collateral);
  const leverage = trade.leverage > 0n ? trade.leverage : 1n;
  const marginStored = usdToGtradeDai(marginUsd);
  const sizeStored = usdToGtradeDai(marginUsd * Number(leverage));
  const storage = stack.storage.toLowerCase();
  const traderLower = trader.toLowerCase();

  return {
    position_key: gtradePositionKey(storage, traderLower, pairIndex, tradeIndex),
    vault_address: storage,
    chain_id: config.chainId,
    account: traderLower,
    collateral_token: stack.collateralToken.toLowerCase(),
    index_token: marketSymbolForPairIndex(pairIndex),
    is_long: trade.buy,
    pair_index: pairIndex,
    trade_index: tradeIndex,
    size_usd: sizeStored.toString(),
    collateral_usd: marginStored.toString(),
    average_price: trade.openPrice.toString(),
    opened_at_block: blockNum,
    updated_at_block: blockNum,
  };
}
