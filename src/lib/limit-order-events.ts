import type { Log, PublicClient } from "viem";
import { decodeEventLog } from "viem";
import { gtradeOpenLimitEventsAbi } from "./abis";
import type { KeeperStackConfig } from "./config";
import { limitOrderKey, limitOrderStore } from "./limit-order-store";
import { config } from "./config";
import { log as botLog } from "./logger";
import { marketSymbolForPairIndex } from "./markets";

const BLOCK_CHUNK = 2_000n;

type OpenLimitArgs = {
  trader: `0x${string}`;
  pairIndex: bigint;
  index: bigint;
};

export async function applyOpenLimitLog(
  stack: KeeperStackConfig,
  entry: Log,
): Promise<void> {
  if (!entry.topics.length || entry.blockNumber == null) return;

  let decoded: { eventName: string; args: OpenLimitArgs };
  try {
    const d = decodeEventLog({
      abi: gtradeOpenLimitEventsAbi,
      data: entry.data,
      topics: entry.topics,
    });
    if (!d.eventName || !d.args) return;
    decoded = { eventName: d.eventName, args: d.args as unknown as OpenLimitArgs };
  } catch {
    return;
  }

  const { trader, pairIndex, index } = decoded.args;
  if (trader === undefined || pairIndex === undefined || index === undefined) return;

  const key = limitOrderKey(stack.storage, trader, Number(pairIndex), Number(index));
  const blockNum = Number(entry.blockNumber);

  if (decoded.eventName === "OpenLimitCanceled") {
    await limitOrderStore.remove(key);
    botLog.info(`[${stack.id}] open-limit canceled — ${key}`);
    return;
  }

  // OpenLimitPlaced / OpenLimitUpdated → upsert as pending.
  await limitOrderStore.upsert({
    order_key: key,
    vault_address: stack.storage.toLowerCase(),
    chain_id: config.chainId,
    account: trader.toLowerCase(),
    index_token: marketSymbolForPairIndex(Number(pairIndex)),
    pair_index: Number(pairIndex),
    limit_index: Number(index),
    is_long: null,
    created_at_block: blockNum,
    updated_at_block: blockNum,
  });
  if (decoded.eventName === "OpenLimitPlaced") {
    botLog.info(`[${stack.id}] open-limit placed — ${key}`);
  }
}

/** Scan the Trading contract for open-limit lifecycle events in [fromBlock, toBlock]. */
export async function scanOpenLimitEvents(
  publicClient: PublicClient,
  stack: KeeperStackConfig,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<number> {
  if (fromBlock > toBlock) return 0;
  const allLogs: Log[] = [];
  for (let start = fromBlock; start <= toBlock; start += BLOCK_CHUNK) {
    const end = start + BLOCK_CHUNK - 1n > toBlock ? toBlock : start + BLOCK_CHUNK - 1n;
    const chunk = await publicClient.getLogs({
      address: stack.trading,
      events: gtradeOpenLimitEventsAbi,
      fromBlock: start,
      toBlock: end,
    });
    allLogs.push(...chunk);
  }

  allLogs.sort((a, b) => {
    const ab = (a.blockNumber ?? 0n) - (b.blockNumber ?? 0n);
    if (ab !== 0n) return ab < 0n ? -1 : 1;
    return (a.logIndex ?? 0) - (b.logIndex ?? 0);
  });

  for (const entry of allLogs) {
    await applyOpenLimitLog(stack, entry);
  }
  return allLogs.length;
}
