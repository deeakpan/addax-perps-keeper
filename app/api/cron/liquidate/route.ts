import { NextResponse } from "next/server";
import { assertLiquidationKeeperConfig } from "@/lib/config";
import { authorizeCron } from "@/lib/cron-auth";
import { getPublicClient, getKeeperWallet } from "@/lib/chain";
import { positionStore } from "@/lib/position-store";
import { catchUpAllStacksFromChain } from "@/lib/trade-events";
import { fulfillPendingMarketOrders } from "@/lib/fulfill-pending";
import { runLiquidationKeeper } from "@/bots/liquidation-keeper";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    assertLiquidationKeeperConfig();
    const publicClient = getPublicClient();
    if (!positionStore.isInitialized()) {
      await positionStore.loadFromSupabaseOnStart();
    }
    const sync = await catchUpAllStacksFromChain(publicClient);
    const head = await publicClient.getBlockNumber();
    const confirmations = BigInt(config.syncConfirmations);
    const toBlock = head > confirmations ? head - confirmations : 0n;
    const fulfillFrom = BigInt(Math.max(config.deployBlock ?? 0, sync.fromBlock));
    const fulfill = await fulfillPendingMarketOrders(
      publicClient,
      getKeeperWallet(),
      fulfillFrom,
      toBlock,
    );
    const liquidation = await runLiquidationKeeper(publicClient, getKeeperWallet());
    return NextResponse.json({
      ok: true,
      bot: "gtrade-liquidation-keeper",
      stacks: config.stacks.map((s) => s.id),
      lastProcessedBlock: positionStore.getLastProcessedBlock(),
      openPositions: positionStore.count(),
      sync,
      fulfill,
      liquidation,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
