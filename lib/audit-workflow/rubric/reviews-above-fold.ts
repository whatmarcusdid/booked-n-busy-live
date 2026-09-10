/**
 * Catalog key: reviews_above_fold.
 *
 * "Above the fold" is the same `isProminent()` heuristic every other
 * above-the-fold-flavored check uses (header/nav, or the first 4000
 * characters of stripped HTML). This check does not measure viewport
 * position and does not look at screenshots.
 *
 * v1 never emits `fail`. A missing signal in the Browserless `waitUntil:
 * "load"` snapshot is inconclusive — a JS review widget may simply not
 * have survived — so absence is `needs_review`, never a high-confidence
 * "no social proof" fail.
 */
import type { CheckOutcome } from "./model";
import {
  firstSnippet,
  innerByTag,
  isProminent,
  locate,
  stripChrome,
  type HtmlLocator,
} from "./html-regions";

const JSON_LD_RE =
  /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

const HEADING_RE = /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi;

const TESTIMONIAL_HEADING_RE =
  /\b(?:testimonials?|reviews?|what\s+(?:our\s+)?(?:customers?|clients?|homeowners?)\s+say)\b/i;

const IFRAME_RE = /<iframe\b[^>]*>/gi;
const IMG_RE = /<img\b[^>]*>/gi;

const STAR_GLYPH_RE = /[★⭐]{3,}/;
const NUMERIC_RATING_RE =
  /\b\d(?:\.\d)?\s*(?:\/\s*5|out of 5)\b|\b\d(?:\.\d)?\s*stars?\b/i;
const RATING_ITEMPROP_RE =
  /itemprop\s*=\s*["'](?:ratingValue|ratingCount|reviewCount|aggregateRating)["']/i;
const STAR_ARIA_RE =
  /aria-label\s*=\s*["'][^"']*\b\d(?:\.\d)?\s*(?:out of 5|stars?)/i;

const REVIEW_ALT_RE =
  /\b(?:google\s+reviews?|testimonials?|customer\s+reviews?|\d(?:\.\d)?\s*stars?)\b/i;

/**
 * Hostnames (and suffixes) of known review-widget embeds. Matched against
 * an iframe `src` only — a mention in copy is not an embed.
 */
const REVIEW_IFRAME_HOSTS = [
  "trustpilot.com",
  "yelp.com",
  "tripadvisor.com",
  "birdeye.com",
  "elfsight.com",
  "elfsightcdn.com",
  "reviews.io",
  "shopperapproved.com",
  "grade.us",
  "reviewsonmywebsite.com",
  "kudobuzz.com",
] as const;

export type ReviewsKind =
  | "aggregaterating_jsonld"
  | "review_jsonld"
  | "testimonial_heading"
  | "star_rating"
  | "review_alt"
  | "review_iframe"
  | "snapshot_inconclusive";

export interface ReviewsMatch {
  kind: ReviewsKind;
  value: string;
  locator: HtmlLocator;
  prominent: boolean;
  snippet: string;
}

export interface ReviewsResult {
  outcome: CheckOutcome;
  match?: ReviewsMatch;
}

function bodyHtml(html: string): string {
  const body = innerByTag(html, "body");
  return body || html;
}

function visibleText(html: string): string {
  return stripChrome(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function attr(tag: string, name: string): string | undefined {
  const re = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i");
  return re.exec(tag)?.[1];
}

function toMatch(
  html: string,
  kind: ReviewsKind,
  value: string,
  extra: Partial<ReviewsMatch> = {},
): ReviewsMatch {
  const locator = extra.locator ?? locate(html, value);
  const prominent =
    extra.prominent ??
    (kind === "aggregaterating_jsonld" || kind === "review_jsonld"
      ? true
      : isProminent(html, locator, value));
  return {
    kind,
    value: value.replace(/\s+/g, " ").trim().slice(0, 64),
    locator,
    prominent,
    snippet: firstSnippet(html, value) || value.slice(0, 80),
    ...extra,
  };
}

function normalizeSchemaType(type: string): string {
  return type.replace(/^https?:\/\/schema\.org\//i, "").toLowerCase();
}

function collectSchemaTypes(node: unknown, found: Set<string>): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectSchemaTypes(item, found);
    return;
  }
  const record = node as Record<string, unknown>;
  const type = record["@type"];
  if (typeof type === "string") found.add(normalizeSchemaType(type));
  if (Array.isArray(type)) {
    for (const item of type) {
      if (typeof item === "string") found.add(normalizeSchemaType(item));
    }
  }
  for (const value of Object.values(record)) {
    collectSchemaTypes(value, found);
  }
}

function jsonLdReviewTypes(html: string): Set<string> {
  const found = new Set<string>();
  JSON_LD_RE.lastIndex = 0;
  let block: RegExpExecArray | null;
  while ((block = JSON_LD_RE.exec(html))) {
    try {
      collectSchemaTypes(JSON.parse(block[1] ?? ""), found);
    } catch {
      /* ignore invalid JSON-LD */
    }
  }
  return found;
}

function findTestimonialHeading(html: string): ReviewsMatch | undefined {
  HEADING_RE.lastIndex = 0;
  let heading: RegExpExecArray | null;
  while ((heading = HEADING_RE.exec(html))) {
    const label = visibleText(heading[1] ?? "");
    if (!TESTIMONIAL_HEADING_RE.test(label)) continue;
    const match = toMatch(html, "testimonial_heading", label);
    if (match.prominent) return match;
  }
  return undefined;
}

function findStarRating(html: string): ReviewsMatch | undefined {
  const glyph = STAR_GLYPH_RE.exec(html);
  if (glyph?.[0]) {
    const match = toMatch(html, "star_rating", glyph[0]);
    if (match.prominent) return match;
  }

  const itemprop = RATING_ITEMPROP_RE.exec(html);
  if (itemprop?.[0]) {
    const needle = itemprop[0];
    const locator = locate(html, needle);
    if (isProminent(html, locator, needle)) {
      return toMatch(html, "star_rating", needle, { locator, prominent: true });
    }
  }

  const aria = STAR_ARIA_RE.exec(html);
  if (aria?.[0]) {
    const needle = aria[0];
    const locator = locate(html, needle);
    if (isProminent(html, locator, needle)) {
      return toMatch(html, "star_rating", needle, { locator, prominent: true });
    }
  }

  const text = visibleText(bodyHtml(html));
  NUMERIC_RATING_RE.lastIndex = 0;
  const numeric = NUMERIC_RATING_RE.exec(text);
  if (numeric?.[0]) {
    const match = toMatch(html, "star_rating", numeric[0]);
    if (match.prominent) return match;
  }
  return undefined;
}

function findReviewAlt(html: string): ReviewsMatch | undefined {
  IMG_RE.lastIndex = 0;
  let tag: RegExpExecArray | null;
  while ((tag = IMG_RE.exec(html))) {
    const alt = (attr(tag[0], "alt") ?? "").replace(/\s+/g, " ").trim();
    if (!alt || !REVIEW_ALT_RE.test(alt)) continue;
    const match = toMatch(html, "review_alt", alt);
    if (match.prominent) return match;
  }
  return undefined;
}

function hostMatchesReviewWidget(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return REVIEW_IFRAME_HOSTS.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
}

function isGoogleReviewsEmbed(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (host !== "google.com" && !host.endsWith(".google.com")) return false;
  return /\/(maps|maps\/embed|reviews)\b/i.test(url.pathname);
}

function findReviewIframe(html: string): ReviewsMatch | undefined {
  IFRAME_RE.lastIndex = 0;
  let tag: RegExpExecArray | null;
  while ((tag = IFRAME_RE.exec(html))) {
    const src = attr(tag[0], "src") ?? attr(tag[0], "data-src");
    if (!src) continue;
    let parsed: URL;
    try {
      parsed = new URL(src, "https://example.com");
    } catch {
      continue;
    }
    if (
      !hostMatchesReviewWidget(parsed.hostname) &&
      !isGoogleReviewsEmbed(parsed)
    ) {
      continue;
    }
    return toMatch(html, "review_iframe", parsed.hostname, {
      locator: locate(html, src) === "footer" ? "footer" : "body",
      prominent: false,
    });
  }
  return undefined;
}

/**
 * pass: AggregateRating or Review JSON-LD anywhere (schema is page-level,
 * same as FAQPage).
 * partial: a prominent testimonial heading, star-rating text/markup, or
 * review-widget alt text; or a known review-widget iframe anywhere.
 * needs_review: home HTML was fetched but none of the above were found.
 * not_assessed: home page was not fetched.
 *
 * `fail` is not in this set on purpose.
 */
export function assessReviewsAboveFold(
  input: { homeAssessed: boolean; html?: string } | null,
): ReviewsResult {
  if (!input?.homeAssessed || !input.html) {
    return { outcome: "not_assessed" };
  }

  const types = jsonLdReviewTypes(input.html);
  if (types.has("aggregaterating")) {
    return {
      outcome: "pass",
      match: {
        kind: "aggregaterating_jsonld",
        value: "AggregateRating schema found",
        locator: "body",
        prominent: true,
        snippet: "AggregateRating schema found",
      },
    };
  }
  if (types.has("review")) {
    return {
      outcome: "pass",
      match: {
        kind: "review_jsonld",
        value: "Review schema found",
        locator: "body",
        prominent: true,
        snippet: "Review schema found",
      },
    };
  }

  const heading = findTestimonialHeading(bodyHtml(input.html));
  if (heading) {
    return { outcome: "partial", match: heading };
  }
  const stars = findStarRating(input.html);
  if (stars) {
    return { outcome: "partial", match: stars };
  }
  const alt = findReviewAlt(bodyHtml(input.html));
  if (alt) {
    return { outcome: "partial", match: alt };
  }

  const iframe = findReviewIframe(input.html);
  if (iframe) {
    return { outcome: "partial", match: iframe };
  }

  return {
    outcome: "needs_review",
    match: {
      kind: "snapshot_inconclusive",
      value: "no review signal in snapshot",
      locator: "body",
      prominent: false,
      snippet: "no review signal in snapshot",
    },
  };
}
