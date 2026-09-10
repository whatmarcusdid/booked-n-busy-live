import { isIP } from "node:net";

const IPV4_BLOCKED_CIDRS = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "224.0.0.0/4",
  "240.0.0.0/4",
] as const;

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.",
  "ip6-localhost",
  "ip6-loopback",
]);

export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.has(host) || BLOCKED_HOSTNAMES.has(`${host}.`)) {
    return true;
  }
  if (host.endsWith(".localhost") || host === "localhost") {
    return true;
  }
  return false;
}

export function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet < 0 || octet > 255) return null;
    value = (value << 8) + octet;
  }
  return value >>> 0;
}

function ipv4InCidr(ip: string, cidr: string): boolean {
  const [range, prefixText] = cidr.split("/");
  const prefix = Number(prefixText);
  const ipInt = ipv4ToInt(ip);
  const rangeInt = ipv4ToInt(range);
  if (ipInt === null || rangeInt === null || Number.isNaN(prefix)) return false;
  if (prefix === 0) return true;
  const mask = prefix === 32 ? 0xffffffff : (~((1 << (32 - prefix)) - 1)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

export function isBlockedIPv4(ip: string): boolean {
  return IPV4_BLOCKED_CIDRS.some((cidr) => ipv4InCidr(ip, cidr));
}

function expandIPv6(ip: string): bigint | null {
  if (ip.includes(".")) {
    const lastColon = ip.lastIndexOf(":");
    const v4 = ip.slice(lastColon + 1);
    const v4Int = ipv4ToInt(v4);
    if (v4Int === null) return null;
    const head = ip.slice(0, lastColon + 1);
    const hi = (v4Int >>> 16).toString(16);
    const lo = (v4Int & 0xffff).toString(16);
    return expandIPv6(`${head}${hi}:${lo}`);
  }

  const [head, tail] = ip.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  if (headParts.length + tailParts.length > 8) return null;
  const missing = 8 - headParts.length - tailParts.length;
  const parts = [
    ...headParts,
    ...Array.from({ length: missing }, () => "0"),
    ...tailParts,
  ];
  if (parts.length !== 8) return null;

  let value = BigInt(0);
  for (const part of parts) {
    if (part === "" || !/^[0-9a-fA-F]{1,4}$/.test(part)) return null;
    value = (value << BigInt(16)) + BigInt(parseInt(part, 16));
  }
  return value;
}

function ipv6PrefixMatch(ip: string, prefix: string, bits: number): boolean {
  const value = expandIPv6(ip);
  const base = expandIPv6(prefix);
  if (value === null || base === null) return false;
  if (bits <= 0) return true;
  const shift = BigInt(128 - bits);
  return value >> shift === base >> shift;
}

export function isBlockedIPv6(ip: string): boolean {
  const mapped = ipv4MappedAddress(ip);
  if (mapped) return isBlockedIPv4(mapped);

  return (
    ipv6PrefixMatch(ip, "::1", 128) ||
    ipv6PrefixMatch(ip, "::", 128) ||
    ipv6PrefixMatch(ip, "fe80::", 10) ||
    ipv6PrefixMatch(ip, "fc00::", 7) ||
    ipv6PrefixMatch(ip, "ff00::", 8) ||
    ipv6PrefixMatch(ip, "fec0::", 10)
  );
}

function ipv4MappedAddress(ip: string): string | null {
  const value = expandIPv6(ip);
  if (value === null) return null;
  const mappedPrefix = BigInt(0xffff);
  if (value >> BigInt(32) !== mappedPrefix) return null;
  const v4 = Number(value & BigInt(0xffffffff)) >>> 0;
  return [
    (v4 >>> 24) & 255,
    (v4 >>> 16) & 255,
    (v4 >>> 8) & 255,
    v4 & 255,
  ].join(".");
}

export function isBlockedIp(address: string): boolean {
  const normalized = unwrapHostname(address);
  const version = isIP(normalized);
  if (version === 4) return isBlockedIPv4(normalized);
  if (version === 6) return isBlockedIPv6(normalized);
  return true;
}

export function unwrapHostname(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

export function hostnameIsIpLiteral(hostname: string): boolean {
  return isIP(unwrapHostname(hostname)) !== 0;
}
