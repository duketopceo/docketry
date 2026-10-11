import { lookup as dnsLookup } from "node:dns";
import { promises as dns } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import { readEnv } from "@tallyline/types";

// One SSRF policy for every outbound request to a caller-supplied URL
// (OIDC discovery, webhook endpoints, agent dispatch endpoints).

const blocked = new BlockList();
const v4: Array<[string, number]> = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // RFC1918
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local + cloud metadata (169.254.169.254)
  ["172.16.0.0", 12], // RFC1918
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.168.0.0", 16], // RFC1918
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];
for (const [net, prefix] of v4) blocked.addSubnet(net, prefix, "ipv4");
const v6: Array<[string, number]> = [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["fc00::", 7], // ULA
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
  ["2001:db8::", 32], // documentation
  ["100::", 64], // discard-only
];
for (const [net, prefix] of v6) blocked.addSubnet(net, prefix, "ipv6");

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal"]);
const BLOCKED_SUFFIXES = [".localhost", ".internal", ".local", ".localdomain"];

/** True for loopback, private, link-local, CGNAT, ULA, multicast and metadata addresses. */
export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 0) return true; // not an IP: refuse rather than guess
  if (kind === 4) return blocked.check(ip, "ipv4");
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, "");
  // IPv4-mapped (::ffff:a.b.c.d / ::ffff:abcd:efgh) and NAT64 (64:ff9b::/96)
  const mapped = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return isPrivateAddress(mapped[1]!);
  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hex) {
    const hi = parseInt(hex[1]!, 16);
    const lo = parseInt(hex[2]!, 16);
    return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return blocked.check(lower, "ipv6");
}

/** Self-hosters on a LAN can opt out; evaluated per call so tests can toggle it. */
export function webhookAllowPrivate(): boolean {
  const v = readEnv(process.env, "TALLYLINE_WEBHOOK_ALLOW_PRIVATE") ?? "";
  return ["1", "true", "yes"].includes(v.toLowerCase());
}

function stripBrackets(host: string): string {
  return host.replace(/^\[|\]$/g, "");
}

function assertHostnameAllowed(host: string, what: string): void {
  const h = host.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(h) || BLOCKED_SUFFIXES.some((s) => h.endsWith(s))) {
    throw new Error(`${what} host is not public: ${host}`);
  }
}

/** Resolve a hostname (A + AAAA) and refuse if ANY answer is non-public. */
export async function assertResolvesPublic(
  host: string,
  what: string,
): Promise<void> {
  const h = stripBrackets(host);
  if (isIP(h)) {
    if (isPrivateAddress(h)) {
      throw new Error(`${what} resolves to a non-public address: ${host}`);
    }
    return;
  }
  const [a, aaaa] = await Promise.all([
    dns.resolve4(h).catch(() => [] as string[]),
    dns.resolve6(h).catch(() => [] as string[]),
  ]);
  const addrs = [...a, ...aaaa];
  if (addrs.length === 0) {
    throw new Error(`${what} host does not resolve: ${host}`);
  }
  if (addrs.some(isPrivateAddress)) {
    throw new Error(`${what} resolves to a non-public address: ${host}`);
  }
}

/**
 * Create/update-time validation for webhook and agent dispatch URLs.
 * http and https are accepted (https recommended); credentials in the URL are
 * refused. TALLYLINE_WEBHOOK_ALLOW_PRIVATE=1 skips the address checks.
 */
export async function assertSafeOutboundUrl(raw: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("invalid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("endpoint URL must be http or https");
  }
  if (url.username || url.password) {
    throw new Error("endpoint URL must not embed credentials");
  }
  if (webhookAllowPrivate()) return;
  const host = stripBrackets(url.hostname);
  if (!isIP(host)) assertHostnameAllowed(host, "endpoint");
  await assertResolvesPublic(host, "endpoint");
}

type LookupCb = (
  err: NodeJS.ErrnoException | null,
  address: string | Array<{ address: string; family: number }>,
  family?: number,
) => void;

// dns.lookup replacement used as the socket's resolver: the address that is
// validated is the address that is dialled, so DNS rebinding between check
// and connect cannot happen.
function guardedLookup(
  hostname: string,
  options: { all?: boolean; family?: number } | number,
  cb: LookupCb,
): void {
  const opts = typeof options === "number" ? { family: options } : options;
  dnsLookup(hostname, { ...opts, all: true }, (err, addrs) => {
    if (err) return cb(err, "");
    const list = addrs as unknown as Array<{ address: string; family: number }>;
    const bad = list.find((a) => isPrivateAddress(a.address));
    if (bad || list.length === 0) {
      const e: NodeJS.ErrnoException = new Error(
        `blocked: ${hostname} resolves to a non-public address`,
      );
      e.code = "ESSRF";
      return cb(e, "");
    }
    if (opts.all) return cb(null, list);
    cb(null, list[0]!.address, list[0]!.family);
  });
}

export interface SafePostInit {
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}

/**
 * POST to a caller-supplied URL with the SSRF policy enforced at connect time
 * and redirects NOT followed (a 3xx is an error — it could point anywhere).
 * Resolves with the HTTP status; rejects on network error, block or timeout.
 */
export async function safePost(rawUrl: string, init: SafePostInit): Promise<number> {
  const url = new URL(rawUrl);
  const allowPrivate = webhookAllowPrivate();
  const host = stripBrackets(url.hostname);
  if (!allowPrivate) {
    if (!isIP(host)) assertHostnameAllowed(host, "endpoint");
    else if (isPrivateAddress(host)) {
      return Promise.reject(
        new Error(`blocked: ${host} is a non-public address`),
      );
    }
  }
  const mod = url.protocol === "https:" ? https : url.protocol === "http:" ? http : null;
  if (!mod) return Promise.reject(new Error("endpoint URL must be http or https"));

  return new Promise<number>((resolve, reject) => {
    const req = mod.request(
      url,
      {
        method: "POST",
        headers: { ...init.headers, "content-length": Buffer.byteLength(init.body) },
        timeout: init.timeoutMs,
        ...(allowPrivate ? {} : { lookup: guardedLookup as never }),
      },
      (res) => {
        res.resume();
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          reject(new Error(`endpoint returned redirect ${status} (redirects are not followed)`));
        } else {
          resolve(status);
        }
      },
    );
    req.on("timeout", () => req.destroy(new Error("endpoint timed out")));
    req.on("error", reject);
    req.end(init.body);
  });
}
