export function gtradePositionKey(
  storage: string,
  trader: string,
  pairIndex: number,
  tradeIndex: number,
): string {
  return `${storage.toLowerCase()}:${trader.toLowerCase()}:${pairIndex}:${tradeIndex}`;
}

export function parseGtradePositionKey(
  key: string,
  fallbackStorage?: string,
): {
  storage: string;
  trader: string;
  pairIndex: number;
  tradeIndex: number;
} | null {
  const parts = key.toLowerCase().split(":");
  if (parts.length === 4 && /^0x[a-f0-9]{40}$/.test(parts[0])) {
    const pairIndex = Number(parts[2]);
    const tradeIndex = Number(parts[3]);
    if (!Number.isInteger(pairIndex) || !Number.isInteger(tradeIndex)) return null;
    if (!/^0x[a-f0-9]{40}$/.test(parts[1])) return null;
    return { storage: parts[0], trader: parts[1], pairIndex, tradeIndex };
  }
  if (parts.length === 3 && fallbackStorage) {
    const pairIndex = Number(parts[1]);
    const tradeIndex = Number(parts[2]);
    if (!Number.isInteger(pairIndex) || !Number.isInteger(tradeIndex)) return null;
    if (!/^0x[a-f0-9]{40}$/.test(parts[0])) return null;
    return {
      storage: fallbackStorage.toLowerCase(),
      trader: parts[0],
      pairIndex,
      tradeIndex,
    };
  }
  return null;
}
