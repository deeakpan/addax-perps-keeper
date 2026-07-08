/**
 * Some networks (e.g. phone hotspots) fail to resolve certain Cloudflare-fronted
 * hosts via the OS resolver (getaddrinfo → ENOTFOUND) while public resolvers work.
 *
 * Node's `dns.lookup` (used by fetch/undici) goes through getaddrinfo. This patch
 * falls back to c-ares (`dns.resolve*`), which we point at public DNS servers, so
 * outbound requests keep working without touching the system hosts file or admin.
 */
import dns from "node:dns";

const PUBLIC_DNS = ["8.8.8.8", "1.1.1.1", "8.8.4.4"];

let installed = false;

export function installDnsFallback(): void {
  if (installed) return;
  installed = true;

  try {
    dns.setServers([...new Set([...dns.getServers(), ...PUBLIC_DNS])]);
  } catch {
    dns.setServers(PUBLIC_DNS);
  }

  const originalLookup = dns.lookup.bind(dns);

  type LookupCb = (
    err: NodeJS.ErrnoException | null,
    address: string | { address: string; family: number }[],
    family?: number,
  ) => void;

  const isPlainHostname = (h: string) => !h.includes(".") || h === "localhost";

  const patched = (
    hostname: string,
    options: unknown,
    callback?: LookupCb,
  ): void => {
    const cb = (typeof options === "function" ? options : callback) as LookupCb;
    const opts = (typeof options === "object" && options ? options : {}) as {
      all?: boolean;
      family?: number;
    };

    const osFallback = () => originalLookup(hostname, opts as never, cb as never);

    // Local/hosts-file names (localhost, host.docker.internal) only resolve via
    // the OS resolver — don't route those through public DNS.
    if (isPlainHostname(hostname)) {
      osFallback();
      return;
    }

    // Public hostnames: resolve via c-ares (public DNS) first — it's fast and
    // reliable on networks where getaddrinfo fails for some hosts. Fall back to
    // the OS resolver only if public DNS returns nothing.
    dns.resolve4(hostname, (err4, addrs4) => {
      if (!err4 && addrs4.length > 0) {
        if (opts.all) cb(null, addrs4.map((a) => ({ address: a, family: 4 })));
        else cb(null, addrs4[0], 4);
        return;
      }
      dns.resolve6(hostname, (err6, addrs6) => {
        if (!err6 && addrs6.length > 0) {
          if (opts.all) cb(null, addrs6.map((a) => ({ address: a, family: 6 })));
          else cb(null, addrs6[0], 6);
          return;
        }
        osFallback();
      });
    });
  };

  (dns as unknown as { lookup: unknown }).lookup = patched;
  const dnsPromises = dns.promises as unknown as { lookup?: unknown };
  if (dnsPromises) {
    dnsPromises.lookup = (hostname: string, options?: { all?: boolean; family?: number }) =>
      new Promise((resolve, reject) => {
        patched(hostname, options ?? {}, (err, address, family) => {
          if (err) reject(err);
          else resolve(options?.all ? address : { address, family });
        });
      });
  }
}
