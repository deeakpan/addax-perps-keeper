/** JSON.stringify that supports bigint (viem return values). */
export function stringifyForLog(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v));
}
