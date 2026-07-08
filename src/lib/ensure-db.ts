import { readFileSync, existsSync } from "fs";
import path from "path";
import dns from "node:dns/promises";
import net from "node:net";
import pg from "pg";
import "./load-env";

const SCHEMA_FILES = [
  "perp_open_positions.sql",
  "perp_open_positions_gtrade.sql",
  "perp_trade_events.sql",
  "perp_open_limit_orders.sql",
] as const;

/** Resolve Postgres URL for DDL. Uses pooler session mode (5432) when only pooler URL is set. */
export function resolveSupabaseDbUrl(): string {
  const raw =
    process.env.SUPABASE_DB_URL?.trim() ??
    process.env.DATABASE_URL?.trim() ??
    process.env.POSTGRES_URL?.trim();
  if (!raw) {
    throw new Error(
      "SUPABASE_DB_URL (or DATABASE_URL) is required to create perps keeper tables",
    );
  }

  try {
    const normalized = raw.replace(/^postgresql:\/\//, "postgres://");
    const url = new URL(normalized);

    if (url.hostname.includes("pooler")) {
      url.searchParams.delete("pgbouncer");
      if (!url.port || url.port === "6543") {
        url.port = "5432";
      }
      return url.toString().replace(/^postgres:\/\//, "postgresql://");
    }

    if (url.hostname.startsWith("db.")) {
      url.search = "";
      url.port = url.port || "5432";
    }

    return url.toString().replace(/^postgres:\/\//, "postgresql://");
  } catch {
    return raw.replace("?pgbouncer=true", "");
  }
}

/**
 * Build a pg client config that connects via an explicitly-resolved IP (public
 * DNS) while keeping TLS SNI on the original hostname. Avoids OS-resolver DNS
 * failures on networks that can't resolve the Supabase pooler host.
 */
async function buildPgConfig(): Promise<pg.ClientConfig> {
  const url = new URL(resolveSupabaseDbUrl().replace(/^postgresql:\/\//, "postgres://"));
  const host = url.hostname;
  const base: pg.ClientConfig = {
    host,
    port: url.port ? Number(url.port) : 5432,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, "") || "postgres",
    ssl: { rejectUnauthorized: false, servername: host },
  };

  if (net.isIP(host)) return base;

  try {
    const addrs = await dns.resolve4(host);
    if (addrs.length > 0) {
      return { ...base, host: addrs[0], ssl: { rejectUnauthorized: false, servername: host } };
    }
  } catch {
    // Fall back to hostname (OS resolver) if public DNS lookup failed.
  }
  return base;
}

export async function ensurePerpsDbSchema(): Promise<void> {
  const client = new pg.Client(await buildPgConfig());
  await client.connect();

  try {
    for (const file of SCHEMA_FILES) {
      const sqlPath = path.join(process.cwd(), "..", "supabase", file);
      if (!existsSync(sqlPath)) {
        throw new Error(`Missing schema file: ${sqlPath}`);
      }
      const sql = readFileSync(sqlPath, "utf8");
      await client.query(sql);
    }
  } finally {
    await client.end();
  }
}
