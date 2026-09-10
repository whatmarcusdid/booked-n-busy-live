import type { CheckOutcome } from "./model";
import {
  firstSnippet,
  innerByTag,
  isProminent,
  locate,
  stripChrome,
  type HtmlLocator,
} from "./html-regions";

/** Guarantee / warranty claims. */
export const GUARANTEE_RE =
  /\b(?:satisfaction\s+guaranteed|money[- ]back\s+guarantee|(?:lifetime|workmanship|labor)\s+warranty|\d{1,2}[- ]year\s+warranty|guaranteed(?:\s+work)?|warranty)\b/gi;

/** Financing / payment-plan language. */
export const FINANCING_RE =
  /\b(?:financing\s+available|we\s+finance|0\s?%\s+interest|0\s+percent\s+interest|payment\s+plans?|monthly\s+payments?|financing\s+options?)\b/gi;

/** Bundles, packages, memberships. */
export const BUNDLE_RE =
  /\b(?:membership(?:\s+plans?)?|service\s+club|maintenance\s+plans?|bundle(?:s|d)?|package\s+deals?|seasonal\s+packages?)\b/gi;

/** Explicit discounts / special offers. Overlap with quote CTAs is expected. */
export const OFFER_RE =
  /\b(?:special\s+offers?|limited[- ]time|%\s*off|percent\s+off|\$\s?\d+\s+off|discounts?|coupon|promo(?:tion)?\s+code|save\s+\$)\b/gi;

export type OfferKind = "guarantee" | "financing" | "bundle" | "special_offer";

export interface OfferMatch {
  kind: OfferKind;
  value: string;
  locator: HtmlLocator;
  prominent: boolean;
  snippet: string;
}

export interface OfferResult {
  outcome: CheckOutcome;
  match?: OfferMatch;
}

function bodyHtml(html: string): string {
  const body = innerByTag(html, "body");
  return body || html;
}

function visibleText(html: string): string {
  return stripChrome(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function toMatch(html: string, kind: OfferKind, value: string): OfferMatch {
  const locator = locate(html, value);
  return {
    kind,
    value: value.replace(/\s+/g, " ").trim().slice(0, 64),
    locator,
    prominent: isProminent(html, locator, value),
    snippet: firstSnippet(html, value),
  };
}

function collect(html: string, text: string): OfferMatch[] {
  const found: OfferMatch[] = [];
  const pairs: Array<[OfferKind, RegExp]> = [
    ["guarantee", GUARANTEE_RE],
    ["financing", FINANCING_RE],
    ["bundle", BUNDLE_RE],
    ["special_offer", OFFER_RE],
  ];
  for (const [kind, re] of pairs) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      found.push(toMatch(html, kind, match[0]));
    }
  }
  return found;
}

/**
 * pass: prominent guarantee, financing, bundle/membership, or special-offer language.
 * partial: the same language only in a non-prominent region.
 * fail: none.
 * not_assessed: home page was not fetched.
 */
export function assessOfferDifferentiation(
  input: { homeAssessed: boolean; html?: string } | null,
): OfferResult {
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
