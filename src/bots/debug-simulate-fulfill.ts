import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../lib/config";

const chain = {
  id: 4441,
  name: "LiteForge",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
} as const;

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

const feedAbi = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
] as const;

async function main() {
  const account = privateKeyToAccount(config.keeperPrivateKey!);
  const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });
  const wallet = createWalletClient({ account, chain, transport: http(config.rpcUrl) });

  const ltcFeed = "0x280CcB394DE0C1FAA988d0e066EbDA631eD3D41A" as const;
  try {
    const feed = await publicClient.readContract({
      address: ltcFeed,
      abi: feedAbi,
      functionName: "latestRoundData",
    });
    console.log("LTC feed answer:", feed[1].toString());
  } catch (e) {
    console.error("LTC feed error:", e);
  }

  try {
    await publicClient.simulateContract({
      address: config.priceAggregator!,
      abi: aggregatorAbi,
      functionName: "fulfillOrder",
      args: [2n, 0, 1n],
      account,
    });
    console.log("simulate OK");
  } catch (e) {
    console.error("simulate failed:", e);
  }
}

main().catch(console.error);
