/** Keep pair indexes and DIA keys aligned with the deployed trading stacks. */
export const PERPS_MARKETS = [
  { symbol: "BTC", diaKey: "BTC/USD", pairIndex: 0 },
  { symbol: "ETH", diaKey: "ETH/USD", pairIndex: 1 },
  { symbol: "LTC", diaKey: "LTC/USD", pairIndex: 2 },
  { symbol: "XAU", diaKey: "XAU/USD", pairIndex: 3 },
  { symbol: "TSLA", diaKey: "TSLA", pairIndex: 4 },
  { symbol: "SPCX", diaKey: "SPCX", pairIndex: 5 },
  { symbol: "SOL", diaKey: "SOL/USD", pairIndex: 6 },
] as const;

export const DIA_ORACLE = "0xEd7f45c29FE6676e1eB7096aD5D6966abd62Bd1a" as const;
export const DIA_DECIMALS = 18;
export const DIA_MAX_AGE_SECONDS = 1800;
export const GTRADE_PRICE_PRECISION = 10n ** 10n;
export const GTRADE_DAI_PRECISION = 10n ** 18n;

const marketByPairIndex = new Map<number, (typeof PERPS_MARKETS)[number]>(
  PERPS_MARKETS.map((m) => [m.pairIndex, m]),
);

export function marketSymbolForPairIndex(pairIndex: number): string {
  return marketByPairIndex.get(pairIndex)?.symbol ?? `PAIR${pairIndex}`;
}

export function diaKeyForPairIndex(pairIndex: number): string | undefined {
  return marketByPairIndex.get(pairIndex)?.diaKey;
}
