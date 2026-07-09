import "./load-env";
import { readFileSync, existsSync } from "fs";
import path from "path";
import { DIA_ORACLE } from "./markets";

export type GtradeDeployments = {
  deployBlock?: number;
  contracts: {
    storage?: string;
    trading?: string;
    callbacks?: string;
    pairInfos?: string;
    priceAggregator?: string;
    nftRewards?: string;
    gWzkLTCStack?: {
      storage?: string;
      trading?: string;
      callbacks?: string;
      pairInfos?: string;
      priceAggregator?: string;
      nftRewards?: string;
    };
    gADDXStack?: {
      storage?: string;
      trading?: string;
      callbacks?: string;
      pairInfos?: string;
      priceAggregator?: string;
      nftRewards?: string;
    };
  };
  tokens: {
    usdc: string;
    addx?: string;
    wzkLtc?: string;
  };
  keeper?: {
    nftId?: number;
    nftType?: number;
  };
  dia?: {
    oracle?: string;
    addaxPriceFeed?: string;
  };
};

export type KeeperStackConfig = {
  id: "USDC" | "ADDX" | "WZKLTC";
  storage: `0x${string}`;
  trading: `0x${string}`;
  callbacks: `0x${string}`;
  pairInfos: `0x${string}`;
  priceAggregator: `0x${string}`;
  nftRewards: `0x${string}`;
  collateralToken: `0x${string}`;
  keeperNftId: number;
  keeperNftType: number;
};

function loadDeployments(): GtradeDeployments | null {
  const p = path.join(process.cwd(), "..", "contracts", "deployments", "liteforge-gtrade.json");
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as GtradeDeployments;
}

function loadRepoStacksConfig(): GtradeDeployments | null {
  const p = path.join(process.cwd(), "config", "stacks.json");
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as GtradeDeployments;
}

const repoConfigured = loadRepoStacksConfig();
const deployed = loadDeployments();
const addressSource = repoConfigured ?? deployed;

function addrFromEnvOrDeploy(
  envKey: string,
  deployedVal: string | undefined,
): `0x${string}` | undefined {
  const raw = process.env[envKey]?.trim();
  if (raw) return raw as `0x${string}`;
  return deployedVal as `0x${string}` | undefined;
}

/** Accepts 64-char hex with or without 0x (MetaMask / Hardhat export style). */
function normalizePrivateKey(raw: string | undefined): `0x${string}` | undefined {
  if (!raw?.trim()) return undefined;
  const hex = raw.trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("KEEPER_PRIVATE_KEY must be 64 hex characters (optional 0x prefix)");
  }
  return `0x${hex}` as `0x${string}`;
}

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (!raw?.trim()) return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

const keeperNftId =
  parsePositiveInt(process.env.PERPS_KEEPER_NFT_ID) ?? addressSource?.keeper?.nftId ?? 1;
const keeperNftType =
  parsePositiveInt(process.env.PERPS_KEEPER_NFT_TYPE) ?? addressSource?.keeper?.nftType ?? 1;

function buildStacks(): KeeperStackConfig[] {
  const stacks: KeeperStackConfig[] = [];

  const usdcStorage = addrFromEnvOrDeploy("PERPS_STORAGE", addressSource?.contracts.storage);
  const usdcTrading = addrFromEnvOrDeploy("PERPS_TRADING", addressSource?.contracts.trading);
  const usdcCallbacks = addrFromEnvOrDeploy("PERPS_CALLBACKS", addressSource?.contracts.callbacks);
  const usdcPairInfos = addrFromEnvOrDeploy("PERPS_PAIR_INFOS", addressSource?.contracts.pairInfos);
  const usdcAggregator = addrFromEnvOrDeploy(
    "PERPS_PRICE_AGGREGATOR",
    addressSource?.contracts.priceAggregator,
  );
  const usdcNftRewards = addrFromEnvOrDeploy(
    "PERPS_NFT_REWARDS",
    addressSource?.contracts.nftRewards,
  );
  const usdc =
    addrFromEnvOrDeploy("PERPS_USDC", addressSource?.tokens.usdc) ??
    ("0x72F4efAC9133d28fa05aEbc9edCd8fC3dE14BB50" as const);

  if (usdcStorage && usdcTrading && usdcCallbacks && usdcPairInfos && usdcAggregator && usdcNftRewards) {
    stacks.push({
      id: "USDC",
      storage: usdcStorage,
      trading: usdcTrading,
      callbacks: usdcCallbacks,
      pairInfos: usdcPairInfos,
      priceAggregator: usdcAggregator,
      nftRewards: usdcNftRewards,
      collateralToken: usdc,
      keeperNftId,
      keeperNftType,
    });
  }

  const wzkStorage = addrFromEnvOrDeploy(
    "PERPS_WZKLTC_STORAGE",
    addressSource?.contracts.gWzkLTCStack?.storage,
  );
  const wzkTrading = addrFromEnvOrDeploy(
    "PERPS_WZKLTC_TRADING",
    addressSource?.contracts.gWzkLTCStack?.trading,
  );
  const wzkCallbacks = addrFromEnvOrDeploy(
    "PERPS_WZKLTC_CALLBACKS",
    addressSource?.contracts.gWzkLTCStack?.callbacks,
  );
  const wzkPairInfos = addrFromEnvOrDeploy(
    "PERPS_WZKLTC_PAIR_INFOS",
    addressSource?.contracts.gWzkLTCStack?.pairInfos,
  );
  const wzkAggregator = addrFromEnvOrDeploy(
    "PERPS_WZKLTC_PRICE_AGGREGATOR",
    addressSource?.contracts.gWzkLTCStack?.priceAggregator,
  );
  const wzkNftRewards = addrFromEnvOrDeploy(
    "PERPS_WZKLTC_NFT_REWARDS",
    addressSource?.contracts.gWzkLTCStack?.nftRewards,
  );
  const wzkLtc =
    addrFromEnvOrDeploy("PERPS_WZKLTC", addressSource?.tokens.wzkLtc) ??
    ("0xA52F83592b9216C574e11324d4468F078aEA05BE" as const);

  if (wzkStorage && wzkTrading && wzkCallbacks && wzkPairInfos && wzkAggregator && wzkNftRewards) {
    stacks.push({
      id: "WZKLTC",
      storage: wzkStorage,
      trading: wzkTrading,
      callbacks: wzkCallbacks,
      pairInfos: wzkPairInfos,
      priceAggregator: wzkAggregator,
      nftRewards: wzkNftRewards,
      collateralToken: wzkLtc,
      keeperNftId,
      keeperNftType,
    });
  }

  const addxStorage = addrFromEnvOrDeploy(
    "PERPS_ADDX_STORAGE",
    addressSource?.contracts.gADDXStack?.storage,
  );
  const addxTrading = addrFromEnvOrDeploy(
    "PERPS_ADDX_TRADING",
    addressSource?.contracts.gADDXStack?.trading,
  );
  const addxCallbacks = addrFromEnvOrDeploy(
    "PERPS_ADDX_CALLBACKS",
    addressSource?.contracts.gADDXStack?.callbacks,
  );
  const addxPairInfos = addrFromEnvOrDeploy(
    "PERPS_ADDX_PAIR_INFOS",
    addressSource?.contracts.gADDXStack?.pairInfos,
  );
  const addxAggregator = addrFromEnvOrDeploy(
    "PERPS_ADDX_PRICE_AGGREGATOR",
    addressSource?.contracts.gADDXStack?.priceAggregator,
  );
  const addxNftRewards = addrFromEnvOrDeploy(
    "PERPS_ADDX_NFT_REWARDS",
    addressSource?.contracts.gADDXStack?.nftRewards,
  );
  const addx =
    addrFromEnvOrDeploy("PERPS_ADDX", addressSource?.tokens.addx) ??
    ("0xf6078Be81aBCC95BAC306356963E7adB986783f9" as const);

  if (addxStorage && addxTrading && addxCallbacks && addxPairInfos && addxAggregator && addxNftRewards) {
    stacks.push({
      id: "ADDX",
      storage: addxStorage,
      trading: addxTrading,
      callbacks: addxCallbacks,
      pairInfos: addxPairInfos,
      priceAggregator: addxAggregator,
      nftRewards: addxNftRewards,
      collateralToken: addx,
      keeperNftId,
      keeperNftType,
    });
  }

  const onlyStack = process.env.PERPS_STACK?.trim().toUpperCase();
  if (onlyStack) {
    return stacks.filter((s) => s.id === onlyStack);
  }
  return stacks;
}

const stacks = buildStacks();
const primary = stacks[0];

export const config = {
  rpcUrl: process.env.PONDER_RPC_URL ?? "https://liteforge.rpc.caldera.xyz/http",
  chainId: 4441,
  keeperPrivateKey: normalizePrivateKey(
    process.env.KEEPER_PRIVATE_KEY ?? process.env.PERPS_KEEPER_PRIVATE_KEY,
  ),
  cronSecret: process.env.CRON_SECRET,
  supabaseUrl: process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  deployBlock: process.env.PERPS_DEPLOY_BLOCK
    ? parseInt(process.env.PERPS_DEPLOY_BLOCK, 10)
    : process.env.PERPS_VAULT_DEPLOY_BLOCK
      ? parseInt(process.env.PERPS_VAULT_DEPLOY_BLOCK, 10)
      : addressSource?.deployBlock,
  bootstrapLookbackBlocks: parseInt(process.env.PERPS_BOOTSTRAP_LOOKBACK_BLOCKS ?? "50", 10),
  maxCatchupBlocks: parseInt(process.env.PERPS_MAX_CATCHUP_BLOCKS ?? "10000", 10),
  syncConfirmations: parseInt(process.env.PERPS_SYNC_CONFIRMATIONS ?? "3", 10),
  pollIntervalMs: parseInt(process.env.PERPS_POLL_INTERVAL_MS ?? "120000", 10),
  rpcWsUrl:
    process.env.PERPS_RPC_WS_URL?.trim() ||
    process.env.PONDER_RPC_WS_URL?.trim() ||
    "wss://liteforge.rpc.caldera.xyz/ws",
  syncMode:
    (process.env.PERPS_SYNC_MODE?.trim().toLowerCase() as "poll" | "websocket" | undefined) ??
    "poll",
  stacks,
  /** Primary stack — backward compatible accessors. */
  storage: primary?.storage,
  trading: primary?.trading,
  callbacks: primary?.callbacks,
  pairInfos: primary?.pairInfos,
  priceAggregator: primary?.priceAggregator,
  usdc: primary?.collateralToken,
  diaOracle:
    (process.env.PERPS_DIA_ORACLE as `0x${string}` | undefined) ??
    (addressSource?.dia?.addaxPriceFeed as `0x${string}` | undefined) ??
    (addressSource?.dia?.oracle as `0x${string}` | undefined) ??
    DIA_ORACLE,
  keeperNftId: primary?.keeperNftId,
  keeperNftType: primary?.keeperNftType,
};

export function stackByStorage(storage: string): KeeperStackConfig | undefined {
  const needle = storage.toLowerCase();
  return stacks.find((s) => s.storage.toLowerCase() === needle);
}

export function assertIndexerConfig() {
  if (config.stacks.length === 0) {
    throw new Error(
      "No perps stacks configured — check perps-keepers/config/stacks.json or PERPS_* env vars",
    );
  }
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }
}

export function assertLiquidationKeeperConfig() {
  assertIndexerConfig();
  if (!config.keeperPrivateKey) {
    throw new Error(
      "KEEPER_PRIVATE_KEY is required in perps-keepers/.env (64 hex chars, 0x optional)",
    );
  }
  for (const stack of config.stacks) {
    if (!stack.trading) {
      throw new Error(`PERPS trading address missing for stack ${stack.id}`);
    }
    if (!stack.pairInfos) {
      throw new Error(`PERPS pairInfos address missing for stack ${stack.id}`);
    }
    if (!stack.priceAggregator) {
      throw new Error(`PERPS priceAggregator missing for stack ${stack.id}`);
    }
    if (stack.keeperNftId === undefined) {
      throw new Error(`PERPS_KEEPER_NFT_ID is required for stack ${stack.id}`);
    }
    if (stack.keeperNftType < 1 || stack.keeperNftType > 5) {
      throw new Error("PERPS_KEEPER_NFT_TYPE must be between 1 and 5");
    }
  }
}
