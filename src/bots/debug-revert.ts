/** Trace why fulfillOrder reverts */
import { createPublicClient, http, parseAbi, encodeFunctionData } from "viem";
import { config } from "../lib/config";

const chain = {
  id: 4441,
  name: "LiteForge",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
} as const;

async function main() {
  const client = createPublicClient({ chain, transport: http(config.rpcUrl) });
  const head = await client.getBlockNumber();
  console.log("chain head:", head.toString());

  const receipt = await client.getTransactionReceipt({
    hash: "0x679e5dd20df0e89ffbc2361612feeacd1d5c12c37eb25db4882773ed4767d208",
  });
  console.log("open tx block:", receipt.blockNumber.toString());

  const aggAbi = parseAbi([
    "function fulfillOrder(uint256 _pairIndex, uint8 _orderType, uint256 orderId)",
    "function storageT() view returns (address)",
    "function callbacks() view returns (address)",
  ]);

  // static call fulfill
  try {
    await client.call({
      to: config.priceAggregator!,
      data: encodeFunctionData({
        abi: aggAbi,
        functionName: "fulfillOrder",
        args: [2n, 0, 1n],
      }),
    });
    console.log("fulfillOrder static call: OK");
  } catch (e: unknown) {
    const err = e as { shortMessage?: string; cause?: { shortMessage?: string; data?: string } };
    console.log("fulfillOrder static call FAILED:", err.shortMessage ?? e);
    if (err.cause?.data) console.log("revert data:", err.cause.data);
  }

  const pairInfosAbi = parseAbi([
    "function getTradePriceImpact(uint256 price, uint256 pairIndex, bool buy, uint256 leveragedPosDai) view returns (uint256, uint256)",
    "function maxNegativePnlOnOpenP() view returns (uint256)",
  ]);

  const price = 41799000000n; // LTC ~41.799 * 1e10
  const leveraged = 400000000000000000000n * 5n;
  try {
    const impact = await client.readContract({
      address: config.pairInfos!,
      abi: pairInfosAbi,
      functionName: "getTradePriceImpact",
      args: [price, 2n, true, leveraged],
    });
    console.log("price impact:", impact.map(String));
  } catch (e) {
    console.log("getTradePriceImpact FAILED:", e);
  }

  const storageAbi = parseAbi([
    "function openInterestDai(uint256,uint256) view returns (uint256)",
    "function pendingMarketOpenCount(address,uint256) view returns (uint256)",
  ]);
  const trader = "0x7A981A271E12Dd22B61f9028F8CAf526ba53c3C5" as const;
  const oi = await client.readContract({
    address: config.storage!,
    abi: storageAbi,
    functionName: "openInterestDai",
    args: [2n, 0n],
  });
  console.log("LTC long OI:", oi.toString());
}

main().catch(console.error);
