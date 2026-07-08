/** Set perp_vault_indexer_state.last_synced_block to chain head - confirmations for all stacks. */
import { createPublicClient, http } from "viem";
import { config } from "../lib/config";
import { createSupabaseService, indexerStateId } from "../lib/supabase";

async function main() {
  const chain = {
    id: config.chainId,
    name: "LiteForge",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  } as const;

  const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });
  const head = await publicClient.getBlockNumber();
  const confirmations = BigInt(config.syncConfirmations);
  const cursor = Number(head > confirmations ? head - confirmations : head);

  const supabase = createSupabaseService();

  for (const stack of config.stacks) {
    const storage = stack.storage.toLowerCase();
    const stateId = indexerStateId(stack.storage, config.chainId);
    const { error } = await supabase.from("perp_vault_indexer_state").upsert(
      {
        id: stateId,
        vault_address: storage,
        chain_id: config.chainId,
        last_synced_block: cursor,
      },
      { onConflict: "id" },
    );
    if (error) throw error;
    console.log(`[${stack.id}] cursor set — id ${stateId} | block ${cursor}`);
  }

  console.log(`done — head ${head}, confirmations ${confirmations}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
