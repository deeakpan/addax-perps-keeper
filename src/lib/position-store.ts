import { createSupabaseService, indexerStateId, type PerpOpenPositionRow } from "./supabase";
import { config } from "./config";

/** In-memory open positions (loaded from Supabase once at startup). */
export type PositionCacheJson = Record<string, PerpOpenPositionRow>;

/**
 * Write-through cache: Supabase first, then in-memory JSON map.
 * Liquidation reads only from memory — no Supabase reads every tick.
 */
class PositionStore {
  private positions: PositionCacheJson = {};
  private lastProcessedByStorage: Record<string, number> = {};
  private hasIndexerStateByStorage: Record<string, boolean> = {};
  private initialized = false;

  getLastProcessedBlock(storage?: string): number {
    if (storage) {
      return this.lastProcessedByStorage[storage.toLowerCase()] ?? 0;
    }
    const blocks = Object.values(this.lastProcessedByStorage);
    return blocks.length > 0 ? Math.min(...blocks) : 0;
  }

  setLastProcessedBlock(storage: string, block: number): void {
    this.lastProcessedByStorage[storage.toLowerCase()] = block;
  }

  hasPersistedIndexerState(storage?: string): boolean {
    if (storage) {
      return this.hasIndexerStateByStorage[storage.toLowerCase()] ?? false;
    }
    return Object.values(this.hasIndexerStateByStorage).some(Boolean);
  }

  list(): PerpOpenPositionRow[] {
    return Object.values(this.positions);
  }

  snapshot(): PositionCacheJson {
    return { ...this.positions };
  }

  count(): number {
    return Object.keys(this.positions).length;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  bootstrapScanCursor(storage: string, safeHead: bigint, lookback = config.bootstrapLookbackBlocks): number {
    const n = BigInt(Math.max(1, lookback));
    const firstScanBlock = safeHead > n ? safeHead - n : 0n;
    const cursor = Number(firstScanBlock > 0n ? firstScanBlock - 1n : 0n);
    this.setLastProcessedBlock(storage, cursor);
    return cursor;
  }

  async loadFromSupabaseOnStart(): Promise<{
    positions: number;
    lastBlock: number;
    hasIndexerState: boolean;
  }> {
    const chainId = config.chainId;
    const supabase = createSupabaseService();
    const storages = config.stacks.map((s) => s.storage.toLowerCase());

    const { data: rows, error: posError } = await supabase
      .from("perp_open_positions")
      .select("*")
      .eq("chain_id", chainId)
      .in("vault_address", storages);

    if (posError) throw posError;

    this.positions = {};
    for (const row of (rows ?? []) as PerpOpenPositionRow[]) {
      this.positions[row.position_key] = row;
    }

    for (const stack of config.stacks) {
      const stateId = indexerStateId(stack.storage, chainId);
      const { data: stateRow } = await supabase
        .from("perp_vault_indexer_state")
        .select("last_synced_block")
        .eq("id", stateId)
        .maybeSingle();

      const synced = stateRow?.last_synced_block;
      const hasState = synced != null && synced > 0;
      this.hasIndexerStateByStorage[stack.storage.toLowerCase()] = hasState;
      this.lastProcessedByStorage[stack.storage.toLowerCase()] = hasState ? synced : 0;
    }

    this.initialized = true;

    return {
      positions: this.count(),
      lastBlock: this.getLastProcessedBlock(),
      hasIndexerState: this.hasPersistedIndexerState(),
    };
  }

  /** Refresh open positions from Supabase (UI writes rows directly on testnet). */
  async reloadFromSupabase(): Promise<number> {
    if (!this.initialized) return 0;
    const chainId = config.chainId;
    const supabase = createSupabaseService();
    const storages = config.stacks.map((s) => s.storage.toLowerCase());

    const { data: rows, error: posError } = await supabase
      .from("perp_open_positions")
      .select("*")
      .eq("chain_id", chainId)
      .in("vault_address", storages);

    if (posError) throw posError;

    this.positions = {};
    for (const row of (rows ?? []) as PerpOpenPositionRow[]) {
      this.positions[row.position_key] = row;
    }
    return this.count();
  }

  private assertReady() {
    if (!this.initialized) {
      throw new Error("PositionStore: call loadFromSupabaseOnStart() first");
    }
  }

  async upsertOpen(row: PerpOpenPositionRow): Promise<void> {
    this.assertReady();
    const supabase = createSupabaseService();
    const { error } = await supabase.from("perp_open_positions").upsert(row, {
      onConflict: "position_key",
    });
    if (error) throw error;
    this.positions[row.position_key] = row;
  }

  async updateOpen(
    positionKey: string,
    patch: Partial<PerpOpenPositionRow>,
  ): Promise<void> {
    this.assertReady();
    const key = positionKey.toLowerCase();
    const existing = this.positions[key];
    if (!existing) return;

    const supabase = createSupabaseService();
    const { error } = await supabase
      .from("perp_open_positions")
      .update(patch)
      .eq("position_key", key);
    if (error) throw error;

    this.positions[key] = { ...existing, ...patch, position_key: key };
  }

  async removeOpen(positionKey: string): Promise<void> {
    this.assertReady();
    const key = positionKey.toLowerCase();
    const supabase = createSupabaseService();
    const { error } = await supabase.from("perp_open_positions").delete().eq("position_key", key);
    if (error) throw error;
    delete this.positions[key];
  }

  async persistLastProcessedBlock(storage: string, block: number): Promise<void> {
    this.assertReady();
    const storageLower = storage.toLowerCase();
    const chainId = config.chainId;
    const stateId = indexerStateId(storage, chainId);
    const supabase = createSupabaseService();

    const { error } = await supabase.from("perp_vault_indexer_state").upsert(
      {
        id: stateId,
        vault_address: storageLower,
        chain_id: chainId,
        last_synced_block: block,
      },
      { onConflict: "id" },
    );
    if (error) throw error;
    this.lastProcessedByStorage[storageLower] = block;
    this.hasIndexerStateByStorage[storageLower] = true;
  }
}

export const positionStore = new PositionStore();
