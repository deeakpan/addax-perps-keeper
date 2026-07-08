/** gTrade Trade tuple — shared across storage reads and callback events. */
export const gtradeTradeComponents = [
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
] as const;

/** Callback events for position indexing (scan `callbacks` contract). */
export const gtradeCallbacksEventsAbi = [
  {
    type: "event",
    name: "MarketExecuted",
    inputs: [
      { name: "orderId", type: "uint256", indexed: false },
      { name: "t", type: "tuple", components: [...gtradeTradeComponents] },
      { name: "open", type: "bool", indexed: false },
      { name: "price", type: "uint256", indexed: false },
      { name: "priceImpactP", type: "uint256", indexed: false },
      { name: "positionSizeDai", type: "uint256", indexed: false },
      { name: "percentProfit", type: "int256", indexed: false },
      { name: "daiSentToTrader", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "LimitExecuted",
    inputs: [
      { name: "orderId", type: "uint256", indexed: false },
      { name: "limitIndex", type: "uint256", indexed: false },
      { name: "t", type: "tuple", components: [...gtradeTradeComponents] },
      { name: "nftHolder", type: "address", indexed: false },
      { name: "orderType", type: "uint8", indexed: false },
      { name: "price", type: "uint256", indexed: false },
      { name: "priceImpactP", type: "uint256", indexed: false },
      { name: "positionSizeDai", type: "uint256", indexed: false },
      { name: "percentProfit", type: "int256", indexed: false },
      { name: "daiSentToTrader", type: "uint256", indexed: false },
    ],
  },
] as const;

export const gtradeStorageAbi = [
  {
    name: "openTrades",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "trader", type: "address" },
      { name: "pairIndex", type: "uint256" },
      { name: "index", type: "uint256" },
    ],
    outputs: [
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
  {
    name: "openTradesInfo",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "trader", type: "address" },
      { name: "pairIndex", type: "uint256" },
      { name: "index", type: "uint256" },
    ],
    outputs: [
      { name: "tokenId", type: "uint256" },
      { name: "tokenPriceDai", type: "uint256" },
      { name: "openInterestDai", type: "uint256" },
      { name: "tpLastUpdated", type: "uint256" },
      { name: "slLastUpdated", type: "uint256" },
      { name: "beingMarketClosed", type: "bool" },
    ],
  },
  {
    name: "PRECISION",
    type: "function",
    stateMutability: "pure",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "hasOpenLimitOrder",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "trader", type: "address" },
      { name: "pairIndex", type: "uint256" },
      { name: "index", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    name: "getOpenLimitOrder",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "trader", type: "address" },
      { name: "pairIndex", type: "uint256" },
      { name: "index", type: "uint256" },
    ],
    outputs: [
      {
        name: "o",
        type: "tuple",
        components: [
          { name: "trader", type: "address" },
          { name: "pairIndex", type: "uint256" },
          { name: "index", type: "uint256" },
          { name: "positionSize", type: "uint256" },
          { name: "spreadReductionP", type: "uint256" },
          { name: "buy", type: "bool" },
          { name: "leverage", type: "uint256" },
          { name: "tp", type: "uint256" },
          { name: "sl", type: "uint256" },
          { name: "minPrice", type: "uint256" },
          { name: "maxPrice", type: "uint256" },
          { name: "block", type: "uint256" },
          { name: "tokenId", type: "uint256" },
        ],
      },
    ],
  },
  {
    name: "nftLastSuccess",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "nftId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "nftSuccessTimelock",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

/** Custom DIA aggregator — keeper runs the oracle callback via fulfillOrder. */
export const gtradeAggregatorAbi = [
  {
    name: "fulfillOrder",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_pairIndex", type: "uint256" },
      { name: "_orderType", type: "uint8" },
      { name: "orderId", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

/** AddaxNftRewards — reads the open-limit trigger style (LEGACY/REVERSAL/MOMENTUM). */
export const gtradeNftRewardsAbi = [
  {
    name: "openLimitOrderTypes",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "trader", type: "address" },
      { name: "pairIndex", type: "uint256" },
      { name: "index", type: "uint256" },
    ],
    outputs: [{ type: "uint8" }],
  },
] as const;

export const gtradePairInfosAbi = [
  {
    name: "getTradeLiquidationPrice",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "trader", type: "address" },
      { name: "pairIndex", type: "uint256" },
      { name: "index", type: "uint256" },
      { name: "openPrice", type: "uint256" },
      { name: "long", type: "bool" },
      { name: "collateral", type: "uint256" },
      { name: "leverage", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

export const gtradeTradingAbi = [
  {
    name: "executeNftOrder",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_orderType", type: "uint8" },
      { name: "_trader", type: "address" },
      { name: "_pairIndex", type: "uint256" },
      { name: "_index", type: "uint256" },
      { name: "_nftId", type: "uint256" },
      { name: "_nftType", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "NftOrderInitiated",
    inputs: [
      { name: "nftHolder", type: "address", indexed: false },
      { name: "trader", type: "address", indexed: false },
      { name: "pairIndex", type: "uint256", indexed: false },
      { name: "orderId", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "NftOrderSameBlock",
    inputs: [
      { name: "nftHolder", type: "address", indexed: false },
      { name: "trader", type: "address", indexed: false },
      { name: "pairIndex", type: "uint256", indexed: false },
    ],
  },
] as const;

/** Trading contract open-limit lifecycle events (scanned to track pending limits). */
export const gtradeOpenLimitEventsAbi = [
  {
    type: "event",
    name: "OpenLimitPlaced",
    inputs: [
      { name: "trader", type: "address", indexed: false },
      { name: "pairIndex", type: "uint256", indexed: false },
      { name: "index", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "OpenLimitUpdated",
    inputs: [
      { name: "trader", type: "address", indexed: false },
      { name: "pairIndex", type: "uint256", indexed: false },
      { name: "index", type: "uint256", indexed: false },
      { name: "newPrice", type: "uint256", indexed: false },
      { name: "newTp", type: "uint256", indexed: false },
      { name: "newSl", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "OpenLimitCanceled",
    inputs: [
      { name: "trader", type: "address", indexed: false },
      { name: "pairIndex", type: "uint256", indexed: false },
      { name: "index", type: "uint256", indexed: false },
    ],
  },
] as const;

/** StorageInterfaceV5.LimitOrder enum (executeNftOrder._orderType). */
export const GTRADE_LIMIT_TP = 0;
export const GTRADE_LIMIT_SL = 1;
export const GTRADE_LIMIT_LIQ = 2;
export const GTRADE_LIMIT_OPEN = 3;

/** AggregatorInterfaceV6.OrderType enum (fulfillOrder._orderType). */
export const GTRADE_ORDER_LIMIT_OPEN = 2;
export const GTRADE_ORDER_LIMIT_CLOSE = 3;

/** NftRewardsInterfaceV6.OpenLimitOrderType enum. */
export const GTRADE_OPEN_LIMIT_LEGACY = 0;
export const GTRADE_OPEN_LIMIT_REVERSAL = 1;
export const GTRADE_OPEN_LIMIT_MOMENTUM = 2;

export type GtradeTradeOnChain = {
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
};

export type GtradeTradeInfoOnChain = {
  tokenId: bigint;
  tokenPriceDai: bigint;
  openInterestDai: bigint;
  tpLastUpdated: bigint;
  slLastUpdated: bigint;
  beingMarketClosed: boolean;
};

export function parseOpenTrade(
  raw: readonly [
    `0x${string}`,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    boolean,
    bigint,
    bigint,
    bigint,
  ],
): GtradeTradeOnChain {
  return {
    trader: raw[0],
    pairIndex: raw[1],
    index: raw[2],
    initialPosToken: raw[3],
    positionSizeDai: raw[4],
    openPrice: raw[5],
    buy: raw[6],
    leverage: raw[7],
    tp: raw[8],
    sl: raw[9],
  };
}

export function parseOpenTradeInfo(
  raw: readonly [bigint, bigint, bigint, bigint, bigint, boolean],
): GtradeTradeInfoOnChain {
  return {
    tokenId: raw[0],
    tokenPriceDai: raw[1],
    openInterestDai: raw[2],
    tpLastUpdated: raw[3],
    slLastUpdated: raw[4],
    beingMarketClosed: raw[5],
  };
}
