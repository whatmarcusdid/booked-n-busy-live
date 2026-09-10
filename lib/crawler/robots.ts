import { CRAWLER_PRODUCT_TOKEN } from "./identity";

/**
 * robots.txt parsing and matching (PRD "Robots.txt and crawler
 * identification" → locked decision).
 *
 * Deliberately narrow: this exists to decide "may we fetch this URL", and to
 * record which rule made that decision. It is not a general-purpose robots
 * library.
 *
 * Two locked behaviours worth stating plainly:
 *
 *   - `Crawl-delay` is parsed only so it can be REPORTED, never obeyed. The
 *     decision is to ignore it entirely — no sleep, no queue, no throttle.
 *     Audits are single-visit and a handful of pages, so honouring a delay
 *     would blow the timing promise for no benefit to the site owner.
 *   - An unreachable or malformed robots.txt means ALLOW. A site that cannot
 *     serve robots.txt has not disallowed anything, and treating a 500 or a
 *     timeout as a blanket disallow would turn a transient server problem
 *     into an Unsupported audit.
 */

export type RobotsFetchStatus =
  | "found"
  | "not_found"
  | "unreachable"
  | "malformed";

export interface RobotsRule {
  /** `allow` or `disallow`, as written in the file. */
  directive: "allow" | "disallow";
  /** The raw path pattern, e.g. `/private/` or `/*.pdf$`. */
  pattern: string;
  /** Which `User-agent:` group the rule came from. */
  userAgent: string;
}

export interface RobotsTxt {
  status: RobotsFetchStatus;
  url: string;
  httpStatus?: number;
  /** Rules from the group that applies to us, most specific group wins. */
  rules: RobotsRule[];
  /** The `User-agent:` value of the group we matched, for evidence. */
  matchedUserAgent: string | null;
  /**
   * Parsed but never acted on. Recorded so evidence can show the site asked
   * for a delay and we knowingly did not honour it.
   */
  crawlDelaySeconds: number | null;
  reasonCode?: string;
  rejectedHop?: number;
  rejectedUrl?: string;
}

export interface RobotsDecision {
  allowed: boolean;
  /** The rule that decided this URL, or null when nothing matched. */
  matchedRule: RobotsRule | null;
}

const ALLOW_ALL: RobotsTxt = {
  status: "not_found",
  url: "",
  rules: [],
  matchedUserAgent: null,
  crawlDelaySeconds: null,
};

export function robotsUrlFor(pageUrl: string | URL): string {
  const url = new URL(String(pageUrl));
  return new URL("/robots.txt", url.origin).href;
}

/**
 * Parses robots.txt into the single rule group that applies to us.
 *
 * Group selection follows the usual precedence: a group naming our product
 * token wins over the `*` wildcard group, and all other groups are ignored.
 * Consecutive `User-agent:` lines share one group's rules.
 */
export function parseRobotsTxt(body: string): {
  rules: RobotsRule[];
  matchedUserAgent: string | null;
  crawlDelaySeconds: number | null;
} {
  const groups = new Map<string, RobotsRule[]>();
  const crawlDelays = new Map<string, number>();

  let currentAgents: string[] = [];
  // A `User-agent:` line after a rule line starts a new group rather than
  // adding to the previous one.
  let expectingAgents = true;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.split("#")[0].trim();
    if (!line) continue;

    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === "user-agent") {
      if (!expectingAgents) {
        currentAgents = [];
        expectingAgents = true;
      }
      const agent = value.toLowerCase();
      currentAgents.push(agent);
      if (!groups.has(agent)) groups.set(agent, []);
      continue;
    }

    if (currentAgents.length === 0) continue;

    if (field === "allow" || field === "disallow") {
      expectingAgents = false;
      for (const agent of currentAgents) {
        groups.get(agent)?.push({
          directive: field,
          pattern: value,
          userAgent: agent,
        });
      }
      continue;
    }

    if (field === "crawl-delay") {
      expectingAgents = false;
      const seconds = Number.parseFloat(value);
      if (Number.isFinite(seconds)) {
        for (const agent of currentAgents) crawlDelays.set(agent, seconds);
      }
    }
  }

  // Our own product token wins over the wildcard group.
  const specific = [...groups.keys()].find(
    (agent) => agent === CRAWLER_PRODUCT_TOKEN,
  );
  const matchedUserAgent = specific ?? (groups.has("*") ? "*" : null);
  if (matchedUserAgent == null) {
    return { rules: [], matchedUserAgent: null, crawlDelaySeconds: null };
  }

  return {
    rules: groups.get(matchedUserAgent) ?? [],
    matchedUserAgent,
    crawlDelaySeconds: crawlDelays.get(matchedUserAgent) ?? null,
  };
}

/** Injectable so tests and the pipeline can supply the transport. */
export type FetchRobotsTxt = (input: {
  url: string;
  timeoutMs: number;
}) => Promise<
  | { ok: true; body: string; httpStatus: number }
  | {
      ok: false;
      httpStatus?: number;
      notFound?: boolean;
      reasonCode?: string;
      rejectedHop?: number;
      rejectedUrl?: string;
    }
>;

export async function fetchRobotsTxt(
  pageUrl: string,
  fetcher: FetchRobotsTxt,
  timeoutMs: number,
): Promise<RobotsTxt> {
  const url = robotsUrlFor(pageUrl);

  let result: Awaited<ReturnType<FetchRobotsTxt>>;
  try {
    result = await fetcher({ url, timeoutMs });
  } catch {
    return { ...ALLOW_ALL, status: "unreachable", url };
  }

  if (!result.ok) {
    return {
      ...ALLOW_ALL,
      status: result.notFound ? "not_found" : "unreachable",
      url,
      httpStatus: result.httpStatus,
      reasonCode: result.reasonCode,
      rejectedHop: result.rejectedHop,
      rejectedUrl: result.rejectedUrl,
    };
  }

  // A robots.txt that is actually an HTML error page tells us nothing. Treat
  // it as absent rather than trying to find rules in markup.
  if (/^\s*<(?:!doctype|html)\b/i.test(result.body)) {
    return {
      ...ALLOW_ALL,
      status: "malformed",
      url,
      httpStatus: result.httpStatus,
    };
  }

  const parsed = parseRobotsTxt(result.body);
  return {
    status: "found",
    url,
    httpStatus: result.httpStatus,
    rules: parsed.rules,
    matchedUserAgent: parsed.matchedUserAgent,
    crawlDelaySeconds: parsed.crawlDelaySeconds,
  };
}

/**
 * Does `pattern` match `path`?
 *
 * Supports the two widely-honoured wildcards: `*` for any run of characters
 * and `$` anchoring the end of the path.
 */
function patternMatches(pattern: string, path: string): boolean {
  if (pattern === "") return false;

  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;

  const source = body
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");

  return new RegExp(`^${source}${anchored ? "$" : ""}`).test(path);
}

/**
 * Applies the matched rule group to one URL.
 *
 * Longest matching pattern wins; an `Allow` beats a `Disallow` of the same
 * length, which is how a site carves an exception out of a broad block. An
 * empty `Disallow:` value means "nothing is disallowed" and is skipped by
 * `patternMatches`.
 */
export function isPathAllowed(
  robots: RobotsTxt,
  pageUrl: string,
): RobotsDecision {
  if (robots.status !== "found" || robots.rules.length === 0) {
    return { allowed: true, matchedRule: null };
  }

  const url = new URL(pageUrl);
  const path = `${url.pathname}${url.search}`;

  let best: RobotsRule | null = null;
  for (const rule of robots.rules) {
    if (!patternMatches(rule.pattern, path)) continue;
    if (best == null) {
      best = rule;
      continue;
    }
    if (rule.pattern.length > best.pattern.length) {
      best = rule;
      continue;
    }
    if (
      rule.pattern.length === best.pattern.length &&
      rule.directive === "allow"
    ) {
      best = rule;
    }
  }

  if (best == null) return { allowed: true, matchedRule: null };
  return { allowed: best.directive === "allow", matchedRule: best };
}
