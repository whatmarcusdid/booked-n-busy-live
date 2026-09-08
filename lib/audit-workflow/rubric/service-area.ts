import type { CheckOutcome } from "./model";
import {
  firstSnippet,
  innerByTag,
  isProminent,
  locate,
  stripChrome,
  type HtmlLocator,
} from "./html-regions";

/**
 * Not an exhaustive city list. After a service-area anchor we take the next
 * ~80 characters and look for a City, ST pair, a County/Parish/Township
 * phrase, or 1–3 capitalized words. Radius claims are matched separately.
 */
const ANCHOR_RE =
  /\b(?:proudly serving|now serving|serving|we serve|service areas?|located in|based in|covering|throughout|across)\b/gi;

const RADIUS_RE =
  /\b\d{1,3}(?:\.\d+)?\s*[-–]?\s*(?:mile|miles|mi|km|kilometer|kilometers)\s+radius\b/gi;

const CITY_STATE_RE = /\b[A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]+)?,\s*[A-Z]{2}\b/;

const COUNTY_RE =
  /\b[A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]+)?\s+(?:County|Parish|Township)\b/;

const CAPPED_PLACE_RE =
  /\b(?:the\s+)?(?:greater\s+)?[A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]+){0,2}\b/;

const LOCAL_RE = /\blocal\b/gi;

const PLACE_STOP = new Set([
  "we",
  "our",
  "the",
  "your",
  "this",
  "all",
  "home",
  "call",
  "get",
  "free",
  "licensed",
  "insured",
  "bonded",
  "certified",
  "new",
  "best",
  "top",
  "quality",
  "professional",
  "residential",
  "commercial",
  "emergency",
  "same",
]);

export type ServiceAreaKind = "anchored_place" | "radius" | "local_place";

export interface ServiceAreaMatch {
  kind: ServiceAreaKind;
  value: string;
  locator: HtmlLocator;
  prominent: boolean;
  snippet: string;
}

export interface ServiceAreaResult {
  outcome: CheckOutcome;
  match?: ServiceAreaMatch;
}

function bodyHtml(html: string): string {
  const body = innerByTag(html, "body");
  return body || html;
}

function visibleText(html: string): string {
  return stripChrome(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function looksLikePlace(value: string): boolean {
  const first = value
    .replace(/^(?:the|greater|your|local)\s+/i, "")
    .split(/\s+/)[0]
    ?.toLowerCase()
    .replace(/[^a-z]/g, "");
  if (!first || PLACE_STOP.has(first)) return false;
  return /[A-Z]/.test(value);
}

function placeInWindow(window: string): string | undefined {
  const cityState = CITY_STATE_RE.exec(window)?.[0];
  if (cityState) return cityState;
  const county = COUNTY_RE.exec(window)?.[0];
  if (county) return county;
  const capped = CAPPED_PLACE_RE.exec(window)?.[0];
  if (capped && looksLikePlace(capped)) return capped;
  return undefined;
}

function toMatch(
  html: string,
  kind: ServiceAreaKind,
  value: string,
): ServiceAreaMatch {
  const locator = locate(html, value);
  return {
    kind,
    value: value.replace(/\s+/g, " ").trim().slice(0, 64),
    locator,
    prominent: isProminent(html, locator, value),
    snippet: firstSnippet(html, value),
  };
}

function collect(html: string, text: string): ServiceAreaMatch[] {
  const found: ServiceAreaMatch[] = [];

  RADIUS_RE.lastIndex = 0;
  let radius: RegExpExecArray | null;
  while ((radius = RADIUS_RE.exec(text))) {
    found.push(toMatch(html, "radius", radius[0]));
  }

  ANCHOR_RE.lastIndex = 0;
  let anchor: RegExpExecArray | null;
  while ((anchor = ANCHOR_RE.exec(text))) {
    const place = placeInWindow(
      text.slice(anchor.index + anchor[0].length, anchor.index + 80),
    );
    if (!place) continue;
    found.push(
      toMatch(html, "anchored_place", `${anchor[0]} ${place}`.slice(0, 64)),
    );
  }

  LOCAL_RE.lastIndex = 0;
  let local: RegExpExecArray | null;
  while ((local = LOCAL_RE.exec(text))) {
    const after = text.slice(local.index, local.index + 60);
    const before = text.slice(Math.max(0, local.index - 40), local.index + 20);
    const place =
      placeInWindow(after.slice("local".length)) ??
      (CITY_STATE_RE.exec(before)?.[0] || COUNTY_RE.exec(before)?.[0]);
    if (!place) continue;
    found.push(toMatch(html, "local_place", `local ${place}`.slice(0, 64)));
  }

  return found;
}

/**
 * pass: prominent service-area mention (place after serving/located/based,
 * radius claim, or "local" tied to a place name).
 * partial: the same language only in a non-prominent region (e.g. footer).
 * fail: none. The bare word "local" does not count.
 * not_assessed: home page was not fetched.
 */
export function assessServiceArea(
  input: { homeAssessed: boolean; html?: string } | null,
): ServiceAreaResult {
  if (!input?.homeAssessed || !input.html) {
    return { outcome: "not_assessed" };
  }

  const html = input.html;
  const matches = collect(html, visibleText(bodyHtml(html)));
  if (matches.length === 0) return { outcome: "fail" };
  const best = matches.find((row) => row.prominent) ?? matches[0];
  return {
    outcome: best.prominent ? "pass" : "partial",
    match: best,
  };
}
