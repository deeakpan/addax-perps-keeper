import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "./config";

export type PerpOpenPositionRow = {
  position_key: string;
  vault_address: string;
  chain_id: number;
  account: string;
  collateral_token: string;
  /** Market symbol (BTC, LTC, …) for gTrade rows. */
  index_token: string;
  is_long: boolean;
  pair_index?: number | null;
  trade_index?: number | null;
  size_usd: string;
  collateral_usd: string;
  average_price: string | null;
  opened_at_block: number;
  updated_at_block: number;
};

export type PerpTradeEventRow = {
  event_id: string;
  vault_address: string;
  chain_id: number;
  account: string;
  index_token: string;
  pair_index: number;
  trade_index: number;
  event_name: string;
  action: "open" | "close";
  order_type: string;
  is_long: boolean;
  price: string;
  entry_price: string | null;
  size_usd: string | null;
  collateral_usd: string | null;
  leverage: number | null;
  percent_profit: string | null;
  dai_sent_to_trader: string | null;
  block_number: number;
  tx_hash: string | null;
  log_index: number;
};

export function createSupabaseService(): SupabaseClient {
  const url = config.supabaseUrl;
  const key = config.supabaseServiceRoleKey;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for perps keeper");
  }
  return createClient(url, key);
}

export function indexerStateId(storage: string, chainId: number): string {
  return `${chainId}:${storage.toLowerCase()}`;
}
