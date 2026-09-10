export const CATEGORY_PAGE_TYPES = ["about", "services", "contact"] as const;
export type CategoryPageType = (typeof CATEGORY_PAGE_TYPES)[number];

/**
 * Heuristic: same-origin <a href> only. Score pathname + visible link text.
 * About: about, about-us, our-story, who-we-are
 * Services: service(s), product(s), offerings, what-we-do
 * Contact: contact, contact-us, get-in-touch, reach-us
 * Prefer exact short paths (/about, /services, /contact). First highest score wins.
 */
const PATTERNS: Record<CategoryPageType, RegExp[]> = {
  about: [/\babout(?:-us)?\b/i, /\bour[-_\s]?story\b/i, /\bwho[-_\s]?we[-_\s]?are\b/i],
  services: [
    /\bservices?\b/i,
    /\bproducts?\b/i,
    /\bofferings?\b/i,
    /\bwhat[-_\s]?we[-_\s]?do\b/i,
  ],
  contact: [
    /\bcontact(?:-us)?\b/i,
    /\bget[-_\s]?in[-_\s]?touch\b/i,
    /\breach(?:-us)?\b/i,
  ],
};

const EXACT_PATHS: Record<CategoryPageType, string[]> = {
  about: ["/about", "/about-us"],
  services: ["/services", "/service", "/products"],
  contact: ["/contact", "/contact-us"],
};

export interface DiscoveredCategories {
  about: string | null;
  services: string | null;
  contact: string | null;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function isSkippableHref(href: string): boolean {
  const trimmed = href.trim();
  if (!trimmed || trimmed === "#") return true;
  const lower = trimmed.toLowerCase();
  return (
    lower.startsWith("javascript:") ||
    lower.startsWith("mailto:") ||
    lower.startsWith("tel:") ||
    lower.startsWith("data:")
  );
}

function collectAnchors(
  html: string,
  baseUrl: string,
): Array<{ url: URL; text: string }> {
  const found: Array<{ url: URL; text: string }> = [];
  const re = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const href = match[1];
    if (isSkippableHref(href)) continue;
    try {
      const url = new URL(href, baseUrl);
      if (url.hash && url.pathname === new URL(baseUrl).pathname && !url.search) {
        continue;
      }
      found.push({ url, text: stripTags(match[2] ?? "") });
    } catch {
      // ignore malformed hrefs
    }
  }
  return found;
}

function scoreCandidate(
  url: URL,
  text: string,
  type: CategoryPageType,
): number {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const patterns = PATTERNS[type];
  const pathHit = patterns.some((pattern) => pattern.test(path));
  const textHit = patterns.some((pattern) => pattern.test(text));
  if (!pathHit && !textHit) return 0;

  let score = 0;
  if (pathHit) score += 50;
  if (textHit) score += 30;
  if (EXACT_PATHS[type].includes(path)) score += 40;
  score -= Math.min(path.length, 30);
  return score;
}

export function selectCategoryUrls(
  html: string,
  homeUrl: string,
): DiscoveredCategories {
  const home = new URL(homeUrl);
  const selected: DiscoveredCategories = {
    about: null,
    services: null,
    contact: null,
  };
  const used = new Set<string>();

  const anchors = collectAnchors(html, home.href).filter(
    (anchor) =>
      anchor.url.protocol === home.protocol &&
      anchor.url.hostname === home.hostname,
  );

  for (const type of CATEGORY_PAGE_TYPES) {
    let best: { href: string; score: number } | null = null;
    for (const anchor of anchors) {
      const href = anchor.url.href;
      if (used.has(href)) continue;
      if (anchor.url.pathname.replace(/\/+$/, "") === home.pathname.replace(/\/+$/, "") &&
          !anchor.url.search) {
        continue;
      }
      const score = scoreCandidate(anchor.url, anchor.text, type);
      if (score <= 0) continue;
      if (!best || score > best.score) {
        best = { href, score };
      }
    }
    if (best) {
      selected[type] = best.href;
      used.add(best.href);
    }
  }

  return selected;
}

export function extractTitle(html: string, fallback: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = match?.[1]?.replace(/\s+/g, " ").trim();
  return title || fallback;
}

export function extractMetaDescription(html: string): string {
  const named = html.match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i,
  );
  if (named?.[1]) return named[1].trim();
  const reversed = html.match(
    /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i,
  );
  return reversed?.[1]?.trim() ?? "";
}
