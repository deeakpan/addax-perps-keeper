import { createSupabaseService } from "./supabase";
import { config } from "./config";

export type PerpOpenLimitOrderRow = {
  order_key: string;
  vault_address: string;
  chain_id: number;
  account: string;
  index_token: string;
  pair_index: number;
  limit_index: number;
  is_long: boolean | null;
  created_at_block: number;
  updated_at_block: number;
};

export function limitOrderKey(
  storage: string,
  trader: string,
  pairIndex: number,
  limitIndex: number,
): string {
  return `${storage.toLowerCase()}:${trader.toLowerCase()}:${pairIndex}:${limitIndex}`;
}

/** Write-through cache of pending open-limit orders (Supabase + in-memory). */
class LimitOrderStore {
  private orders: Record<string, PerpOpenLimitOrderRow> = {};
  private initialized = false;

  list(): PerpOpenLimitOrderRow[] {
    return Object.values(this.orders);
  }

  count(): number {
    return Object.keys(this.orders).length;
  }

  async loadFromSupabaseOnStart(): Promise<number> {
    try {
      const { fetchOpenLimitsFromGoldsky } = await import("./goldsky-limits");
      const rows = await fetchOpenLimitsFromGoldsky();
      this.orders = {};
      for (const row of rows) {
        this.orders[row.order_key] = row;
      }
      this.initialized = true;
      return this.count();
    } catch {
      const supabase = createSupabaseService();
      const storages = config.stacks.map((s) => s.storage.toLowerCase());
      const { data, error } = await supabase
        .from("perp_open_limit_orders")
        .select("*")
        .eq("chain_id", config.chainId)
        .in("vault_address", storages);
      if (error) throw error;

      this.orders = {};
      for (const row of (data ?? []) as PerpOpenLimitOrderRow[]) {
        this.orders[row.order_key] = row;
      }
      this.initialized = true;
      return this.count();
    }
  }

  /** Refresh pending limits from Goldsky (fallback Supabase). */
  async reloadFromSupabase(): Promise<number> {
    if (!this.initialized) return 0;
    try {
      const { fetchOpenLimitsFromGoldsky } = await import("./goldsky-limits");
      const rows = await fetchOpenLimitsFromGoldsky();
      this.orders = {};
      for (const row of rows) {
        this.orders[row.order_key] = row;
      }
      return this.count();
    } catch {
      const supabase = createSupabaseService();
      const storages = config.stacks.map((s) => s.storage.toLowerCase());
      const { data, error } = await supabase
        .from("perp_open_limit_orders")
        .select("*")
        .eq("chain_id", config.chainId)
        .in("vault_address", storages);
      if (error) throw error;

      this.orders = {};
      for (const row of (data ?? []) as PerpOpenLimitOrderRow[]) {
        this.orders[row.order_key] = row;
      }
      return this.count();
    }
  }

  private assertReady() {
    if (!this.initialized) {
      throw new Error("LimitOrderStore: call loadFromSupabaseOnStart() first");
    }
  }

  async upsert(row: PerpOpenLimitOrderRow): Promise<void> {
    this.assertReady();
    const supabase = createSupabaseService();
    const { error } = await supabase
      .from("perp_open_limit_orders")
      .upsert(row, { onConflict: "order_key" });
    if (error) throw error;
    this.orders[row.order_key] = row;
  }

  async remove(orderKey: string): Promise<void> {
    this.assertReady();
    const key = orderKey.toLowerCase();
    const supabase = createSupabaseService();
    const { error } = await supabase
      .from("perp_open_limit_orders")
      .delete()
      .eq("order_key", key);
    if (error) throw error;
    delete this.orders[key];
  }
}

export const limitOrderStore = new LimitOrderStore();
