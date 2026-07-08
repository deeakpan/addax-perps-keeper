import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../lib/config";

const chain = {
  id: 4441,
  name: "LiteForge",
  nativeCurrency: { name: "zkLTC", symbol: "zkLTC", decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
} as const;

async function main() {
  const account = privateKeyToAccount(config.keeperPrivateKey!);
  const client = createPublicClient({ chain, transport: http(config.rpcUrl) });
  const wallet = createWalletClient({ account, chain, transport: http(config.rpcUrl) });

  const head = await client.getBlockNumber();
  const from = head - 5000n;
  const logs = await client.getLogs({
    address: config.trading!,
    event: parseAbi(["event MarketOrderInitiated(address trader, uint256 pairIndex, bool open, uint256 orderId)"])[0],
    fromBlock: from,
    toBlock: head,
  });
  console.log("recent MarketOrderInitiated:", logs.length);

  const aggAbi = parseAbi(["function fulfillOrder(uint256,uint8,uint256)"]);
  const storageAbi = parseAbi([
    "function reqID_pendingMarketOrder(uint256) view returns ((address,uint256,uint256,uint256,uint256,uint256,bool,uint256,uint256,uint256),uint256,uint256,uint256,uint256,uint256)",
  ]);

  for (const entry of logs) {
    const { open, orderId, pairIndex } = entry.args as { open: boolean; orderId: bigint; pairIndex: bigint };
    if (!open) continue;
    const pending = await client.readContract({
      address: config.storage!,
      abi: storageAbi,
      functionName: "reqID_pendingMarketOrder",
      args: [orderId],
    });
    const block = pending[1];
    const lev = pending[0][7];
    console.log(`order ${orderId} pair ${pairIndex} pending block=${block} lev=${lev}`);
    if (block === 0n || lev === 0n) continue;
    try {
      await client.simulateContract({
        address: config.priceAggregator!,
        abi: aggAbi,
        functionName: "fulfillOrder",
        args: [pairIndex, 0, orderId],
        account,
      });
      console.log(`  simulate OK`);
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; cause?: { shortMessage?: string } };
      console.log(`  simulate FAIL:`, err.shortMessage ?? err.cause?.shortMessage ?? e);
    }
  }
}

main().catch(console.error);
