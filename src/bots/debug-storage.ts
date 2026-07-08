import { createPublicClient, http, parseAbi } from "viem";
import { config } from "../lib/config";

const chain = {
  id: 4441,
  name: "LiteForge",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
} as const;

async function main() {
  const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });
  const abi = parseAbi([
    "function priceAggregator() view returns (address)",
    "function isPaused() view returns (bool)",
    "function reqID_pendingMarketOrder(uint256) view returns ((address,uint256,uint256,uint256,uint256,uint256,bool,uint256,uint256,uint256),uint256,uint256,uint256,uint256,uint256)",
  ]);
  const agg = await publicClient.readContract({
    address: config.storage!,
    abi,
    functionName: "priceAggregator",
  });
  console.log("storage.priceAggregator:", agg);
  console.log("config.priceAggregator:", config.priceAggregator);

  const callbacksAbi = parseAbi(["function isPaused() view returns (bool)"]);
  const paused = await publicClient.readContract({
    address: config.callbacks!,
    abi: callbacksAbi,
    functionName: "isPaused",
  });
  console.log("callbacks paused:", paused);

  const pending = await publicClient.readContract({
    address: config.storage!,
    abi,
    functionName: "reqID_pendingMarketOrder",
    args: [1n],
  });
  console.log("pending tuple:", pending);
  console.log("block field:", pending[1].toString());
}

main().catch(console.error);
