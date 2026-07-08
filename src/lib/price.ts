import type { Address, PublicClient } from "viem";
import { DIA_DECIMALS, DIA_ORACLE, GTRADE_PRICE_PRECISION, diaKeyForPairIndex } from "./markets";

const diaOracleAbi = [
  {
    type: "function",
    name: "getValue",
    stateMutability: "view",
    inputs: [{ name: "key", type: "string" }],
    outputs: [
      { name: "price", type: "uint128" },
      { name: "timestamp", type: "uint128" },
    ],
  },
] as const;

/** DIA 8-dec USD → gTrade price precision (1e10). */
export function diaPriceToGtradePrecision(raw: bigint): bigint {
  return (raw * GTRADE_PRICE_PRECISION) / 10n ** BigInt(DIA_DECIMALS);
}

export async function fetchPairMarkPrice(
  publicClient: PublicClient,
  pairIndex: number,
  diaOracle: Address = DIA_ORACLE,
): Promise<bigint | null> {
  const diaKey = diaKeyForPairIndex(pairIndex);
  if (!diaKey) return null;

  const [rawPrice] = await publicClient.readContract({
    address: diaOracle,
    abi: diaOracleAbi,
    functionName: "getValue",
    args: [diaKey],
  });

  if (rawPrice <= 0n) return null;
  return diaPriceToGtradePrecision(rawPrice);
}
