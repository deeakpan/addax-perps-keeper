import { config } from "@/lib/config";

export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 640, margin: "2rem auto", padding: "0 1rem" }}>
      <h1>Addax gTrade liquidation bot</h1>
      <p>
        Indexes <code>MarketExecuted</code> / <code>LimitExecuted</code> from the gTrade callbacks
        contract, then submits <code>executeNftOrder(LIQ)</code> when mark price crosses liquidation
        price.
      </p>

      <h2>Run locally (continuous)</h2>
      <pre style={{ background: "#111", color: "#eee", padding: "1rem", borderRadius: 8, overflow: "auto" }}>
        {`cd perps-keepers
cp .env.example .env   # fill in values
npm install
npm run bot:liquidate:watch`}
      </pre>
      <p>Polls every {config.pollIntervalMs / 1000}s.</p>

      <h2>Required env</h2>
      <ul>
        <li>
          <code>KEEPER_PRIVATE_KEY</code> — funded wallet on LiteForge (4441)
        </li>
        <li>
          <code>PERPS_KEEPER_NFT_ID</code> — gTrade NFT token id owned by keeper (for LIQ rewards)
        </li>
        <li>
          <code>SUPABASE_URL</code> + <code>SUPABASE_SERVICE_ROLE_KEY</code>
        </li>
        <li>
          Contract addresses via <code>contracts/deployments/liteforge-gtrade.json</code> or env:
          <code> PERPS_STORAGE</code>, <code>PERPS_CALLBACKS</code>, <code>PERPS_TRADING</code>,{" "}
          <code>PERPS_PAIR_INFOS</code>
        </li>
      </ul>
    </main>
  );
}
