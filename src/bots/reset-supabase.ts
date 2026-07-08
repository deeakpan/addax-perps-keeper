/** Wipe perps indexer tables and reset cursors to deploy block for a full re-sync. */
import { createPublicClient, http } from "viem";
import { config } from "../lib/config";
import { ensurePerpsDbSchema } from "../lib/ensure-db";
import { createSupabaseService, indexerStateId } from "../lib/supabase";

async function clearTable(
  table: "perp_open_positions" | "perp_open_limit_orders" | "perp_trade_events" | "perp_vault_indexer_state",
  keyColumn: string,
) {
  const supabase = createSupabaseService();
  const { error, count } = await supabase
    .from(table)
    .delete({ count: "exact" })
    .neq(keyColumn, "");
  if (error) throw error;
  return count ?? 0;
}

async function main() {
  await ensurePerpsDbSchema();

  const posCount = await clearTable("perp_open_positions", "position_key");
  const limitCount = await clearTable("perp_open_limit_orders", "order_key");
  const eventCount = await clearTable("perp_trade_events", "event_id");
  const stateCount = await clearTable("perp_vault_indexer_state", "id");

  const chain = {
    id: config.chainId,
    rpcUrls: { default: { http: [config.rpcUrl] } },
  } as const;
  const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });
  const head = await publicClient.getBlockNumber();
  const confirmations = BigInt(config.syncConfirmations);
  const headCursor = Number(head > confirmations ? head - confirmations : head);
  const deployCursor =
    typeof config.deployBlock === "number" && config.deployBlock > 0
      ? Math.max(0, config.deployBlock - 1)
      : headCursor;

  const supabase = createSupabaseService();

  for (const stack of config.stacks) {
    const storage = stack.storage.toLowerCase();
    const stateId = indexerStateId(stack.storage, config.chainId);
    const { error } = await supabase.from("perp_vault_indexer_state").upsert(
      {
        id: stateId,
        vault_address: storage,
        chain_id: config.chainId,
        last_synced_block: deployCursor,
      },
      { onConflict: "id" },
    );
    if (error) throw error;
    console.log(`[${stack.id}] cursor set — ${stateId} @ block ${deployCursor}`);
  }

  console.log(
    `cleared ${posCount} positions, ${limitCount} limits, ${eventCount} trade events, ${stateCount} indexer rows`,
  );
  console.log(`chain head ${head} | confirmations ${confirmations}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
