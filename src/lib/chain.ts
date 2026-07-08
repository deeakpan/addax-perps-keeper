import {
  createWalletClient,
  createPublicClient,
  http,
  webSocket,
  type WalletClient,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config";

const liteforge = {
  id: config.chainId,
  name: "LiteForge",
  nativeCurrency: { name: "zkLTC", symbol: "zkLTC", decimals: 18 },
  rpcUrls: {
    default: {
      http: [config.rpcUrl],
      webSocket: [config.rpcWsUrl],
    },
  },
} as const;

/** Generous timeout + retries for flaky links (e.g. phone hotspots). */
const httpTransport = () =>
  http(config.rpcUrl, { timeout: 30_000, retryCount: 3, retryDelay: 800 });

export function getPublicClient(): PublicClient {
  return createPublicClient({ chain: liteforge, transport: httpTransport() });
}

/** WebSocket client for `watchBlocks` / live subscriptions. */
export function getWsPublicClient(): PublicClient {
  return createPublicClient({ chain: liteforge, transport: webSocket(config.rpcWsUrl) });
}

export function getKeeperWallet(): WalletClient {
  if (!config.keeperPrivateKey) throw new Error("KEEPER_PRIVATE_KEY is required");
  const account = privateKeyToAccount(config.keeperPrivateKey);
  return createWalletClient({
    account,
    chain: liteforge,
    transport: httpTransport(),
  });
}
