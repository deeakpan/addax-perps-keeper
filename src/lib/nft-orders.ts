import type { Address, Hash, PublicClient, WalletClient } from "viem";
import { decodeEventLog } from "viem";
import {
  gtradeAggregatorAbi,
  gtradeTradingAbi,
  GTRADE_LIMIT_OPEN,
  GTRADE_ORDER_LIMIT_CLOSE,
  GTRADE_ORDER_LIMIT_OPEN,
} from "./abis";
import type { KeeperStackConfig } from "./config";

export type NftTriggerType = "tp" | "sl" | "liq" | "open";

/** StorageInterfaceV5.LimitOrder value passed to executeNftOrder for each trigger. */
const LIMIT_ORDER_BY_TYPE: Record<NftTriggerType, number> = {
  tp: 0,
  sl: 1,
  liq: 2,
  open: 3,
};

export type NftTriggerResult =
  | { ok: true; executeTx: Hash; fulfillTx: Hash; orderId: string }
  | { ok: false; reason: string; skipped: boolean; executeTx?: Hash };

/** Reverts we treat as "position no longer triggerable" — skip quietly, not an error. */
const SKIP_REVERTS = [
  "NO_TRADE",
  "NO_SL",
  "HAS_SL",
  "NO_LIMIT",
  "SUCCESS_TIMELOCK",
  "PRICE_IMPACT_TOO_HIGH",
  "MAX_TRADES_PER_PAIR",
  "DONE",
];

function revertReason(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null) {
    const o = err as Record<string, unknown>;
    if (typeof o.shortMessage === "string") return o.shortMessage;
    if (typeof o.message === "string") return o.message;
  }
  return String(err);
}

function matchedSkipRevert(msg: string): string | null {
  for (const r of SKIP_REVERTS) {
    if (new RegExp(`\\b${r}\\b`).test(msg)) return r;
  }
  return null;
}

function parseOrderId(logs: readonly { data: `0x${string}`; topics: `0x${string}`[] }[]): bigint | null {
  for (const entry of logs) {
    try {
      const decoded = decodeEventLog({
        abi: gtradeTradingAbi,
        data: entry.data,
        topics: entry.topics,
      });
      if (decoded.eventName === "NftOrderInitiated" && decoded.args) {
        const { orderId } = decoded.args as { orderId: bigint };
        if (orderId !== undefined) return orderId;
      }
    } catch {
      // not an NftOrderInitiated log — ignore
    }
  }
  return null;
}

/**
 * Robust two-step NFT trigger for the DIA aggregator:
 *   1. executeNftOrder(orderType) — stores a pending NFT order, emits NftOrderInitiated(orderId)
 *   2. fulfillOrder(pairIndex, LIMIT_OPEN|LIMIT_CLOSE, orderId) — runs the callback with live price
 *
 * The contract re-validates the trigger condition inside the callback, so a firing that no longer
 * qualifies is a harmless no-op (position/limit simply stays open).
 */
export async function triggerNftOrder(
  publicClient: PublicClient,
  wallet: WalletClient,
  stack: KeeperStackConfig,
  params: {
    type: NftTriggerType;
    trader: Address;
    pairIndex: number;
    index: number;
  },
): Promise<NftTriggerResult> {
  const { type, trader, pairIndex, index } = params;
  const limitOrder = LIMIT_ORDER_BY_TYPE[type];
  const fulfillOrderType =
    type === "open" ? GTRADE_ORDER_LIMIT_OPEN : GTRADE_ORDER_LIMIT_CLOSE;

  const executeArgs = [
    limitOrder,
    trader,
    BigInt(pairIndex),
    BigInt(index),
    BigInt(stack.keeperNftId),
    BigInt(stack.keeperNftType),
  ] as const;

  // Simulate first so expected "not triggerable" reverts don't cost gas / spam errors.
  try {
    await publicClient.simulateContract({
      account: wallet.account!,
      address: stack.trading,
      abi: gtradeTradingAbi,
      functionName: "executeNftOrder",
      args: executeArgs,
    });
  } catch (e) {
    const msg = revertReason(e);
    const skip = matchedSkipRevert(msg);
    if (skip) return { ok: false, reason: skip, skipped: true };
    return { ok: false, reason: msg, skipped: false };
  }

  let executeTx: Hash;
  try {
    executeTx = await wallet.writeContract({
      address: stack.trading,
      abi: gtradeTradingAbi,
      functionName: "executeNftOrder",
      args: executeArgs,
      account: wallet.account!,
      chain: wallet.chain,
    });
  } catch (e) {
    return { ok: false, reason: revertReason(e), skipped: false };
  }

  const receipt = await publicClient.waitForTransactionReceipt({ hash: executeTx });
  if (receipt.status === "reverted") {
    return { ok: false, reason: "executeNftOrder reverted", skipped: false, executeTx };
  }

  const orderId = parseOrderId(receipt.logs);
  if (orderId === null) {
    // No NftOrderInitiated — order was already triggered in-flight (NftOrderSameBlock) or
    // consumed by another keeper. Nothing pending to fulfill.
    return { ok: false, reason: "no_pending_order", skipped: true, executeTx };
  }

  let fulfillTx: Hash;
  try {
    fulfillTx = await wallet.writeContract({
      address: stack.priceAggregator,
      abi: gtradeAggregatorAbi,
      functionName: "fulfillOrder",
      args: [BigInt(pairIndex), fulfillOrderType, orderId],
      account: wallet.account!,
      chain: wallet.chain,
    });
  } catch (e) {
    return { ok: false, reason: `fulfill failed: ${revertReason(e)}`, skipped: false, executeTx };
  }

  const fulfillReceipt = await publicClient.waitForTransactionReceipt({ hash: fulfillTx });
  if (fulfillReceipt.status === "reverted") {
    return { ok: false, reason: "fulfillOrder reverted", skipped: false, executeTx };
  }

  return { ok: true, executeTx, fulfillTx, orderId: orderId.toString() };
}

export { GTRADE_LIMIT_OPEN };
