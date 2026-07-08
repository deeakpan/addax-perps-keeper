import { ensurePerpsDbSchema } from "../lib/ensure-db";

async function main() {
  await ensurePerpsDbSchema();
  console.log("perps keeper tables ready");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
