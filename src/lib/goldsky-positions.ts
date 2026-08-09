import { config } from "./config";
import type { PerpOpenPositionRow } from "./supabase";

const GOLDSKY_SUBGRAPHS: Record<string, string> = {
  USDC:
    "https://api.goldsky.com/api/public/project_cmskla92utbea01vm4nyr1kk2/subgraphs/addax-trades-gusdc/1.0.0/gn",
  WZKLTC:
    "https://api.goldsky.com/api/public/project_cmskla92utbea01vm4nyr1kk2/subgraphs/addax-trades-gwzkltc/1.0.0/gn",
  ADDX:
    "https://api.goldsky.com/api/public/project_cmskla92utbea01vm4nyr1kk2/subgraphs/addax-trades-gaddx/1.0.0/gn",
};

const MARKETS = [
  { symbol: "BTC", pairIndex: 0 },
  { symbol: "ETH", pairIndex: 1 },
  { symbol: "LTC", pairIndex: 2 },
  { symbol: "XAU", pairIndex: 3 },
  { symbol: "TSLA", pairIndex: 4 },
  { symbol: "SPCX", pairIndex: 5 },
  { symbol: "SOL", pairIndex: 6 },
  { symbol: "HYPE", pairIndex: 7 },
] as const;

const LIMIT_OPEN = 3;

function gtradePosDaiToUsd(raw: bigint): number {
  if (raw >= 10n ** 16n) return Number(raw) / 1e18;
  return Number(raw) / 1e10;
}

function usdToGtradeDai(usd: number): bigint {
  if (!Number.isFinite(usd) || usd <= 0) return 0n;
  return BigInt(Math.round(usd * 1e18));
}

type MarketExecutedEntity = {
  id: string;
  open: boolean;
  price: string;
  positionSizeDai: string;
  block_number: string | number;
  t_trader: string;
  t_pairIndex: string | number;
  t_index: string | number;
  t_buy: boolean;
  t_leverage: string | number;
  t_openPrice: string;
};

type LimitExecutedEntity = {
  id: string;
  orderType: string | number;
  price: string;
  positionSizeDai: string;
  block_number: string | number;
  t_trader: string;
  t_pairIndex: string | number;
  t_index: string | number;
  t_buy: boolean;
  t_leverage: string | number;
  t_openPrice: string;
};

function num(v: string | number | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : Number(v);
}

function symbolForPairIndex(pairIndex: number): string {
  return MARKETS.find((m) => m.pairIndex === pairIndex)?.symbol ?? `PAIR${pairIndex}`;
}

function positionKey(storage: string, trader: string, pairIndex: number, tradeIndex: number) {
  return `${storage.toLowerCase()}:${trader.toLowerCase()}:${pairIndex}:${tradeIndex}`;
}

function sizeCollateralFromPosDai(positionSizeDai: string, leverageRaw: string | number) {
  const leverage = Math.max(1, num(leverageRaw));
  const marginUsd = gtradePosDaiToUsd(BigInt(positionSizeDai || "0"));
  return {
    collateral_usd: usdToGtradeDai(marginUsd).toString(),
    size_usd: usdToGtradeDai(marginUsd * leverage).toString(),
  };
}

async function queryGoldsky<T>(url: string, query: string): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Goldsky HTTP ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  if (!json.data) throw new Error("Goldsky empty");
  return json.data;
}

/** Load open positions for all configured stacks from Goldsky. */
export async function fetchOpenPositionsFromGoldsky(): Promise<PerpOpenPositionRow[]> {
  const open = new Map<string, PerpOpenPositionRow>();

  await Promise.all(
    config.stacks.map(async (stack) => {
      const url = GOLDSKY_SUBGRAPHS[stack.id];
      if (!url) return;
      const storage = stack.storage.toLowerCase();
      const data = await queryGoldsky<{
        marketExecuteds: MarketExecutedEntity[];
        limitExecuteds: LimitExecutedEntity[];
      }>(
        url,
        `{
          marketExecuteds(first: 1000, orderBy: block_number, orderDirection: asc) {
            id open price positionSizeDai block_number
            t_trader t_pairIndex t_index t_buy t_leverage t_openPrice
          }
          limitExecuteds(first: 1000, orderBy: block_number, orderDirection: asc) {
            id orderType price positionSizeDai block_number
            t_trader t_pairIndex t_index t_buy t_leverage t_openPrice
          }
        }`,
      );

      type Ev =
        | { kind: "m"; block: number; id: string; e: MarketExecutedEntity }
        | { kind: "l"; block: number; id: string; e: LimitExecutedEntity };

      const timeline: Ev[] = [
        ...data.marketExecuteds.map((e) => ({
          kind: "m" as const,
          block: num(e.block_number),
          id: e.id,
          e,
        })),
        ...data.limitExecuteds.map((e) => ({
          kind: "l" as const,
          block: num(e.block_number),
          id: e.id,
          e,
        })),
      ].sort((a, b) => a.block - b.block || a.id.localeCompare(b.id));

      for (const ev of timeline) {
        if (ev.kind === "m") {
          const e = ev.e;
          const key = positionKey(storage, e.t_trader, num(e.t_pairIndex), num(e.t_index));
          if (e.open) {
            const { size_usd, collateral_usd } = sizeCollateralFromPosDai(
              e.positionSizeDai,
              e.t_leverage,
            );
            const avg = BigInt(e.price || "0") > 0n ? e.price : e.t_openPrice;
            open.set(key, {
              position_key: key,
              vault_address: storage,
              chain_id: config.chainId,
              account: e.t_trader.toLowerCase(),
              collateral_token: stack.collateralToken.toLowerCase(),
              index_token: symbolForPairIndex(num(e.t_pairIndex)),
              is_long: e.t_buy,
              pair_index: num(e.t_pairIndex),
              trade_index: num(e.t_index),
              size_usd,
              collateral_usd,
              average_price: avg,
              opened_at_block: ev.block,
              updated_at_block: ev.block,
            });
          } else {
            open.delete(key);
          }
          continue;
        }

        const e = ev.e;
        const key = positionKey(storage, e.t_trader, num(e.t_pairIndex), num(e.t_index));
        if (num(e.orderType) === LIMIT_OPEN) {
          const { size_usd, collateral_usd } = sizeCollateralFromPosDai(
            e.positionSizeDai,
            e.t_leverage,
          );
          const avg = BigInt(e.price || "0") > 0n ? e.price : e.t_openPrice;
          open.set(key, {
            position_key: key,
            vault_address: storage,
            chain_id: config.chainId,
            account: e.t_trader.toLowerCase(),
            collateral_token: stack.collateralToken.toLowerCase(),
            index_token: symbolForPairIndex(num(e.t_pairIndex)),
            is_long: e.t_buy,
            pair_index: num(e.t_pairIndex),
            trade_index: num(e.t_index),
            size_usd,
            collateral_usd,
            average_price: avg,
            opened_at_block: ev.block,
            updated_at_block: ev.block,
          });
        } else {
          open.delete(key);
        }
      }
    }),
  );

  return [...open.values()];
}
