import { createPublicClient, http } from "viem";
import { config } from "../lib/config";

const chain = {
  id: 4441,
  name: "LiteForge",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
} as const;

async function main() {
  const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });
  const receipt = await publicClient.getTransactionReceipt({
    hash: "0x679e5dd20df0e89ffbc2361612feeacd1d5c12c37eb25db4882773ed4767d208",
  });
  console.log("tx block:", receipt.blockNumber.toString());
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== config.trading!.toLowerCase()) continue;
    console.log("trading log topics:", log.topics);
    console.log("data:", log.data);
  }
}

main().catch(console.error);
