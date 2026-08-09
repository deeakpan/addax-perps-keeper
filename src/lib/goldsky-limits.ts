import { config } from "./config";
import type { PerpOpenLimitOrderRow } from "./limit-order-store";
import { limitOrderKey } from "./limit-order-store";

const GOLDSKY_TRADING: Record<string, string> = {
  USDC:
    "https://api.goldsky.com/api/public/project_cmslbrg78r18d01vufxlm2gbb/subgraphs/gusdc-trading/1.0.0/gn",
  WZKLTC:
    "https://api.goldsky.com/api/public/project_cmslbrg78r18d01vufxlm2gbb/subgraphs/gwzkltc-trading/1.0.0/gn",
  ADDX:
    "https://api.goldsky.com/api/public/project_cmslbrg78r18d01vufxlm2gbb/subgraphs/gaddx-trading/1.0.0/gn",
};

const GOLDSKY_CALLBACKS: Record<string, string> = {
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

function num(v: string | number | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : Number(v);
}

function symbolForPairIndex(pairIndex: number): string {
  return MARKETS.find((m) => m.pairIndex === pairIndex)?.symbol ?? `PAIR${pairIndex}`;
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

/** Derive open limits: Placed − Canceled − LimitExecuted(LIMIT_OPEN). */
export async function fetchOpenLimitsFromGoldsky(): Promise<PerpOpenLimitOrderRow[]> {
  const open = new Map<string, PerpOpenLimitOrderRow>();

  await Promise.all(
    config.stacks.map(async (stack) => {
      const tradingUrl = GOLDSKY_TRADING[stack.id];
      const callbacksUrl = GOLDSKY_CALLBACKS[stack.id];
      if (!tradingUrl) return;
      const storage = stack.storage.toLowerCase();

      const data = await queryGoldsky<{
        openLimitPlaceds: {
          id: string;
          trader: string;
          pairIndex: string | number;
          index: string | number;
          block_number: string | number;
        }[];
        openLimitCanceleds: {
          id: string;
          trader: string;
          pairIndex: string | number;
          index: string | number;
          block_number: string | number;
        }[];
        openLimitUpdateds: {
          id: string;
          trader: string;
          pairIndex: string | number;
          index: string | number;
          block_number: string | number;
        }[];
      }>(
        tradingUrl,
        `{
          openLimitPlaceds(first: 1000, orderBy: block_number, orderDirection: asc) {
            id trader pairIndex index block_number
          }
          openLimitCanceleds(first: 1000, orderBy: block_number, orderDirection: asc) {
            id trader pairIndex index block_number
          }
          openLimitUpdateds(first: 1000, orderBy: block_number, orderDirection: asc) {
            id trader pairIndex index block_number
          }
        }`,
      );

      type Ev = {
        kind: "place" | "cancel" | "update" | "fill";
        block: number;
        id: string;
        trader: string;
        pair: number;
        index: number;
      };

      const timeline: Ev[] = [
        ...data.openLimitPlaceds.map((e) => ({
          kind: "place" as const,
          block: num(e.block_number),
          id: e.id,
          trader: e.trader.toLowerCase(),
          pair: num(e.pairIndex),
          index: num(e.index),
        })),
        ...data.openLimitCanceleds.map((e) => ({
          kind: "cancel" as const,
          block: num(e.block_number),
          id: e.id,
          trader: e.trader.toLowerCase(),
          pair: num(e.pairIndex),
          index: num(e.index),
        })),
        ...data.openLimitUpdateds.map((e) => ({
          kind: "update" as const,
          block: num(e.block_number),
          id: e.id,
          trader: e.trader.toLowerCase(),
          pair: num(e.pairIndex),
          index: num(e.index),
        })),
      ];

      if (callbacksUrl) {
        try {
          const fills = await queryGoldsky<{
            limitExecuteds: {
              id: string;
              orderType: string | number;
              limitIndex?: string | number | null;
              block_number: string | number;
              t_trader: string;
              t_pairIndex: string | number;
              t_index: string | number;
            }[];
          }>(
            callbacksUrl,
            `{
              limitExecuteds(first: 1000, orderBy: block_number, orderDirection: asc) {
                id orderType limitIndex block_number t_trader t_pairIndex t_index
              }
            }`,
          );
          for (const e of fills.limitExecuteds) {
            if (num(e.orderType) !== LIMIT_OPEN) continue;
            const limitIndex =
              e.limitIndex != null && e.limitIndex !== "" ? num(e.limitIndex) : num(e.t_index);
            timeline.push({
              kind: "fill",
              block: num(e.block_number),
              id: e.id,
              trader: e.t_trader.toLowerCase(),
              pair: num(e.t_pairIndex),
              index: limitIndex,
            });
          }
        } catch {
          /* optional */
        }
      }

      timeline.sort((a, b) => a.block - b.block || a.id.localeCompare(b.id));

      for (const ev of timeline) {
        const key = limitOrderKey(storage, ev.trader, ev.pair, ev.index);
        if (ev.kind === "place") {
          open.set(key, {
            order_key: key,
            vault_address: storage,
            chain_id: config.chainId,
            account: ev.trader,
            index_token: symbolForPairIndex(ev.pair),
            pair_index: ev.pair,
            limit_index: ev.index,
            is_long: null,
            created_at_block: ev.block,
            updated_at_block: ev.block,
          });
        } else if (ev.kind === "update") {
          const row = open.get(key);
          if (row) row.updated_at_block = ev.block;
        } else {
          open.delete(key);
        }
      }
    }),
  );

  return [...open.values()];
}
