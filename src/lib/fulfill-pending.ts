import type { Log, PublicClient, WalletClient } from "viem";
import { decodeEventLog } from "viem";
import type { KeeperStackConfig } from "./config";
import { config } from "./config";
import { log } from "./logger";

const BLOCK_CHUNK = 2_000n;

/** gTrade AggregatorInterfaceV6.OrderType.MARKET_OPEN / MARKET_CLOSE. */
const ORDER_MARKET_OPEN = 0;
const ORDER_MARKET_CLOSE = 1;

const tradingEventsAbi = [
  {
    type: "event",
    name: "MarketOrderInitiated",
    inputs: [
      { name: "trader", type: "address", indexed: false },
      { name: "pairIndex", type: "uint256", indexed: false },
      { name: "open", type: "bool", indexed: false },
      { name: "orderId", type: "uint256", indexed: false },
    ],
  },
] as const;

const aggregatorAbi = [
  {
    type: "function",
    name: "fulfillOrder",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_pairIndex", type: "uint256" },
      { name: "_orderType", type: "uint8" },
      { name: "orderId", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

const storageAbi = [
  {
    type: "function",
    name: "reqID_pendingMarketOrder",
    stateMutability: "view",
    inputs: [{ name: "orderId", type: "uint256" }],
    outputs: [
      {
        name: "trade",
        type: "tuple",
        components: [
          { name: "trader", type: "address" },
          { name: "pairIndex", type: "uint256" },
          { name: "index", type: "uint256" },
          { name: "initialPosToken", type: "uint256" },
          { name: "positionSizeDai", type: "uint256" },
          { name: "openPrice", type: "uint256" },
          { name: "buy", type: "bool" },
          { name: "leverage", type: "uint256" },
          { name: "tp", type: "uint256" },
          { name: "sl", type: "uint256" },
        ],
      },
      { name: "block", type: "uint256" },
      { name: "wantedPrice", type: "uint256" },
      { name: "slippageP", type: "uint256" },
      { name: "spreadReductionP", type: "uint256" },
      { name: "tokenId", type: "uint256" },
    ],
  },
] as const;

export type FulfillPendingResult = {
  scanned: number;
  fulfilled: number;
  skipped: number;
  txs: string[];
  errors: string[];
};

type MarketOrderInitiatedArgs = {
  trader: `0x${string}`;
  pairIndex: bigint;
  open: boolean;
  orderId: bigint;
};

function decodeMarketOrderInitiated(entry: Log): MarketOrderInitiatedArgs | null {
  if (!entry.topics?.length) return null;
  try {
    const d = decodeEventLog({
      abi: tradingEventsAbi,
      data: entry.data,
      topics: entry.topics,
    });
    if (d.eventName !== "MarketOrderInitiated" || !d.args) return null;
    const a = d.args as MarketOrderInitiatedArgs;
    if (a.orderId === undefined || a.pairIndex === undefined || a.open === undefined) return null;
    return a;
  } catch {
    return null;
  }
}

type PendingMarketOrderRow = readonly [
  {
    trader: `0x${string}`;
    pairIndex: bigint;
    index: bigint;
    initialPosToken: bigint;
    positionSizeDai: bigint;
    openPrice: bigint;
    buy: boolean;
    leverage: bigint;
    tp: bigint;
    sl: bigint;
  },
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
];

async function isPendingMarketOrder(
  publicClient: PublicClient,
  storage: `0x${string}`,
  orderId: bigint,
  open: boolean,
): Promise<boolean> {
  const row = (await publicClient.readContract({
    address: storage,
    abi: storageAbi,
    functionName: "reqID_pendingMarketOrder",
    args: [orderId],
  })) as PendingMarketOrderRow;
  const trade = row[0];
  const block = row[1];
  return block > 0n && (open ? trade.leverage > 0n : trade.leverage === 0n);
}

async function fetchMarketOrderInitiatedLogs(
  publicClient: PublicClient,
  trading: `0x${string}`,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<Log[]> {
  const all: Log[] = [];
  for (let start = fromBlock; start <= toBlock; start += BLOCK_CHUNK) {
    const end = start + BLOCK_CHUNK - 1n > toBlock ? toBlock : start + BLOCK_CHUNK - 1n;
    const chunk = await publicClient.getLogs({
      address: trading,
      events: tradingEventsAbi,
      fromBlock: start,
      toBlock: end,
    });
    all.push(...chunk);
  }
  return all;
}

async function fulfillPendingForStack(
  publicClient: PublicClient,
  wallet: WalletClient,
  stack: KeeperStackConfig,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<FulfillPendingResult> {
  const result: FulfillPendingResult = {
    scanned: 0,
    fulfilled: 0,
    skipped: 0,
    txs: [],
    errors: [],
  };

  if (fromBlock > toBlock) return result;

  let logs: Log[];
  try {
    logs = await fetchMarketOrderInitiatedLogs(publicClient, stack.trading, fromBlock, toBlock);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    result.errors.push(`[${stack.id}] ${msg}`);
    return result;
  }

  result.scanned = logs.length;

  for (const entry of logs) {
    const args = decodeMarketOrderInitiated(entry);
    if (!args) {
      result.skipped += 1;
      continue;
    }

    const { orderId, pairIndex } = args;

    try {
      const pending = await isPendingMarketOrder(publicClient, stack.storage, orderId, args.open);
      if (!pending) {
        result.skipped += 1;
        continue;
      }

      const orderType = args.open ? ORDER_MARKET_OPEN : ORDER_MARKET_CLOSE;
      const { request } = await publicClient.simulateContract({
        account: wallet.account!,
        address: stack.priceAggregator,
        abi: aggregatorAbi,
        functionName: "fulfillOrder",
        args: [pairIndex, orderType, orderId],
      });
      const hash = await wallet.writeContract({
        ...request,
        account: wallet.account!,
        chain: wallet.chain,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("fulfillOrder transaction reverted");
      result.fulfilled += 1;
      result.txs.push(hash);
      log.info(
        `[${stack.id}] fulfilled pending ${args.open ? "open" : "close"} — order ${orderId} pair ${pairIndex} tx ${hash.slice(0, 10)}…`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push(`[${stack.id}] order ${orderId}: ${msg}`);
    }
  }

  return result;
}

export async function fulfillPendingMarketOrders(
  publicClient: PublicClient,
  wallet: WalletClient,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<FulfillPendingResult> {
  // Use one wallet nonce stream across stacks; concurrent submissions can race nonce selection.
  const perStack: FulfillPendingResult[] = [];
  for (const stack of config.stacks) {
    perStack.push(await fulfillPendingForStack(publicClient, wallet, stack, fromBlock, toBlock));
  }

  return {
    scanned: perStack.reduce((n, r) => n + r.scanned, 0),
    fulfilled: perStack.reduce((n, r) => n + r.fulfilled, 0),
    skipped: perStack.reduce((n, r) => n + r.skipped, 0),
    txs: perStack.flatMap((r) => r.txs),
    errors: perStack.flatMap((r) => r.errors),
  };
}
