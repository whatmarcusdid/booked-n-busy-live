/** Catalog key in v2 is seo_ai_search_readiness. Scoring logic is unchanged. */
import { extractMetaDescription, extractTitle } from "../discover-links";
import type { CheckOutcome } from "./model";

/** Title must be longer than a few characters after trim. */
export const MIN_TITLE_CHARS = 5;

/** Meta description shorter than this is treated as trivial/empty. */
export const MIN_META_CHARS = 20;

const TITLE_PLACEHOLDERS = new Set([
  "untitled",
  "home",
  "homepage",
  "default",
  "new page",
  "welcome",
  "index",
  "website",
]);

const META_PLACEHOLDERS = new Set([
  "description",
  "meta description",
  "enter a description",
  "your description here",
  "website description",
]);

export interface SeoBasicsSignal {
  title: string;
  titleOk: boolean;
  metaDescription: string;
  metaOk: boolean;
  noindex: boolean;
}

export interface SeoBasicsResult {
  outcome: CheckOutcome;
  signal?: SeoBasicsSignal;
  value?: string;
  locator?: string;
  snippet?: string;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function hostFromUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function isBareDomainTitle(title: string, finalUrl?: string): boolean {
  const host = hostFromUrl(finalUrl);
  if (!host) return false;
  const normalized = title.toLowerCase().replace(/^www\./, "");
  return normalized === host;
}

export function isReasonableTitle(title: string, finalUrl?: string): boolean {
  const cleaned = decodeEntities(title).replace(/\s+/g, " ").trim();
  if (cleaned.length < MIN_TITLE_CHARS) return false;
  if (TITLE_PLACEHOLDERS.has(cleaned.toLowerCase())) return false;
  if (isBareDomainTitle(cleaned, finalUrl)) return false;
  return true;
}

export function isReasonableMeta(meta: string): boolean {
  const cleaned = decodeEntities(meta).replace(/\s+/g, " ").trim();
  if (cleaned.length < MIN_META_CHARS) return false;
  if (META_PLACEHOLDERS.has(cleaned.toLowerCase())) return false;
  return true;
}

function readRobotsContent(html: string): string {
  const named = html.match(
    /<meta[^>]+name=["']robots["'][^>]+content=["']([^"']*)["']/i,
  );
  if (named?.[1]) return named[1];
  const reversed = html.match(
    /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']robots["']/i,
  );
  return reversed?.[1] ?? "";
}

export function hasNoindex(html: string): boolean {
  return /\bnoindex\b/i.test(readRobotsContent(html));
}

/**
 * pass: reasonable title + reasonable meta description + no noindex.
 * partial: exactly one of title/meta is reasonable, and no noindex.
 * fail: neither signal, or robots noindex (overrides title/meta).
 * not_assessed: home page was not fetched.
 *
 * Does not read JSON-LD / og: tags — those are a later enhancement.
 */
export function assessSeoBasics(
  input: { homeAssessed: boolean; html?: string; finalUrl?: string } | null,
): SeoBasicsResult {
  if (!input?.homeAssessed || !input.html) {
    return { outcome: "not_assessed" };
  }

  const title = decodeEntities(extractTitle(input.html, ""));
  const metaDescription = decodeEntities(extractMetaDescription(input.html));
  const titleOk = isReasonableTitle(title, input.finalUrl);
  const metaOk = isReasonableMeta(metaDescription);
  const noindex = hasNoindex(input.html);
  const signal: SeoBasicsSignal = {
    title,
    titleOk,
    metaDescription,
    metaOk,
    noindex,
  };

  const snippet = [title, metaDescription]
    .filter(Boolean)
    .join(" | ")
    .slice(0, 80);

  if (noindex) {
    return {
      outcome: "fail",
      signal,
      value: "noindex",
      locator: "head",
      snippet: snippet || "noindex",
    };
  }

  if (titleOk && metaOk) {
    return {
      outcome: "pass",
      signal,
      value: title.slice(0, 64),
      locator: "head",
      snippet,
    };
  }

  if (titleOk || metaOk) {
    return {
      outcome: "partial",
      signal,
      value: (titleOk ? title : metaDescription).slice(0, 64),
      locator: "head",
      snippet,
    };
  }

  return {
    outcome: "fail",
    signal,
    value: title || metaDescription || "missing_title_and_meta",
    locator: "head",
    snippet: snippet || "missing_title_and_meta",
  };
}
