export const GTRADE_DAI_PRECISION = 10n ** 18n;
export const GTRADE_PRICE_PRECISION = 10n ** 10n;

export function gtradeDaiToUsd(raw: bigint): number {
  return Number(raw) / 1e18;
}

export function gtradePriceToUsd(raw: bigint): number {
  return Number(raw) / 1e10;
}

export function usdToGtradeDai(usd: number): bigint {
  if (!Number.isFinite(usd) || usd <= 0) return 0n;
  const micro = BigInt(Math.round(usd * 1e6));
  return micro * 10n ** 12n;
}

/** Margin USD from event `positionSizeDai` (posDai) field at open. */
export function gtradePosDaiToUsd(posDai: bigint): number {
  if (posDai >= 10n ** 16n) return gtradeDaiToUsd(posDai);
  return gtradePriceToUsd(posDai);
}
