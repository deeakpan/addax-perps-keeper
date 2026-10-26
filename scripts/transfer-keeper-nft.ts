import { readFileSync } from "node:fs";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const chain = defineChain({
  id: 4441,
  name: "LitVM LiteForge",
  nativeCurrency: { name: "zkLTC", symbol: "zkLTC", decimals: 18 },
  rpcUrls: { default: { http: ["https://liteforge.rpc.caldera.xyz/http"] } },
});

const storageAbi = [
  {
    type: "function",
    name: "nfts",
    stateMutability: "view",
    inputs: [{ name: "index", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
] as const;

const nftAbi = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "transferFrom",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

async function main() {
  const targetArg = process.argv[2];
  if (!targetArg) throw new Error("Usage: npm run transfer:keeper-nft -- <target-address>");
  const target = getAddress(targetArg);

  // PRIVATE_KEY is loaded from the ignored contracts/.env deployment file.
  loadDotenv({ path: path.resolve(process.cwd(), "..", "contracts", ".env") });
  const rawKey = process.env.PRIVATE_KEY?.trim();
  if (!rawKey) throw new Error("PRIVATE_KEY missing from ../contracts/.env");
  const account = privateKeyToAccount(
    (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`,
  );

  const deploymentsPath = path.resolve(process.cwd(), "deployments", "liteforge-gtrade.json");
  const deployments = JSON.parse(readFileSync(deploymentsPath, "utf8")) as {
    contracts: { storage: `0x${string}` };
  };
  const publicClient = createPublicClient({ chain, transport: http() });
  const walletClient = createWalletClient({ account, chain, transport: http() });
  const tokenId = 1n;
  const nft = await publicClient.readContract({
    address: deployments.contracts.storage,
    abi: storageAbi,
    functionName: "nfts",
    args: [0n],
  });
  const owner = await publicClient.readContract({
    address: nft,
    abi: nftAbi,
    functionName: "ownerOf",
    args: [tokenId],
  });

  if (owner.toLowerCase() === target.toLowerCase()) {
    console.log(`NFT #${tokenId} already belongs to ${target}; no transaction sent.`);
    return;
  }
  if (owner.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(`Signer ${account.address} is not the current NFT owner ${owner}`);
  }

  const { request } = await publicClient.simulateContract({
    account,
    address: nft,
    abi: nftAbi,
    functionName: "transferFrom",
    args: [account.address, target, tokenId],
  });
  const hash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`Transfer reverted: ${hash}`);

  const newOwner = await publicClient.readContract({
    address: nft,
    abi: nftAbi,
    functionName: "ownerOf",
    args: [tokenId],
  });
  if (newOwner.toLowerCase() !== target.toLowerCase()) {
    throw new Error(`Transfer receipt succeeded, but NFT owner is ${newOwner}`);
  }
  console.log(`Transferred NFT #${tokenId} on ${chain.name} to ${target}; tx ${hash}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
