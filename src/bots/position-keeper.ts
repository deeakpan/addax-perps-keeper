import type { Hash, PublicClient, WalletClient } from "viem";

export type PositionKeeperResult = {
  increaseTx?: Hash;
  decreaseTx?: Hash;
  pendingIncrease: number;
  pendingDecrease: number;
};

/** @deprecated GMX PositionRouter — gTrade uses instant market orders. */
export async function runPositionKeeper(
  _publicClient: PublicClient,
  _wallet: WalletClient,
): Promise<PositionKeeperResult> {
  throw new Error("GMX position keeper removed — gTrade uses instant market orders");
}
