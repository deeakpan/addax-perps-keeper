import { createPublicClient, createWalletClient, decodeEventLog, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../lib/config";
import { fulfillPendingMarketOrders } from "../lib/fulfill-pending";

const chain = {
  id: 4441,
  name: "LiteForge",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
} as const;

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

async function main() {
  const account = privateKeyToAccount(config.keeperPrivateKey!);
  const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });
  const wallet = createWalletClient({ account, chain, transport: http(config.rpcUrl) });

  const logs = await publicClient.getLogs({
    address: config.trading!,
    events: tradingEventsAbi,
    fromBlock: 23307679n,
    toBlock: 23307679n,
  });
  console.log("logs at 23307679:", logs.length);
  for (const entry of logs) {
    const d = decodeEventLog({
      abi: tradingEventsAbi,
      data: entry.data,
      topics: entry.topics,
    });
    console.log("decoded:", d.eventName, d.args);
  }

  const pending = await publicClient.readContract({
    address: config.storage!,
    abi: storageAbi,
    functionName: "reqID_pendingMarketOrder",
    args: [1n],
  });
  console.log("pending raw:", pending);
  console.log("block:", pending.block, "leverage:", pending.trade?.leverage ?? (pending as unknown as { trade: bigint[] }).trade?.[7]);

  const result = await fulfillPendingMarketOrders(publicClient, wallet, 23307679n, 23307679n);
  console.log("fulfill:", result);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
