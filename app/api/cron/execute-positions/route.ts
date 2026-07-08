import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Legacy GMX position-router cron — removed with GMX stack. */
export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      error: "Position queue bot was GMX-only. gTrade uses instant market orders via GNSTrading.",
    },
    { status: 410 },
  );
}
