/** Catalog key in v2 is quote_booking_cta_visibility. Scoring logic is unchanged. */
import type { CheckOutcome } from "./model";
import {
  firstSnippet,
  isProminent,
  locate,
  stripChrome,
  type HtmlLocator,
} from "./html-regions";

/**
 * Quote / book / schedule phrasing. Generic "Contact Us" / "Get in Touch"
 * are intentionally excluded (generic contact is not a quote/booking CTA).
 */
export const CONVERSION_PATH_PHRASE_RE =
  /\b(?:request\s+a\s+(?:free\s+)?(?:quote|estimate)|get\s+a\s+(?:free\s+)?(?:quote|estimate)|get\s+(?:a\s+)?free\s+(?:quote|estimate)|free\s+(?:quote|estimate)|request\s+(?:a\s+)?quote|book\s+now|book\s+online|book\s+an?\s+appointment|book\s+appointment|schedule\s+(?:a\s+)?service|schedule\s+now|schedule\s+an?\s+appointment|schedule\s+an?\s+visit|book\s+a\s+(?:consult(?:ation)?|visit)|request\s+service|get\s+an?\s+estimate)\b/i;

/** Path segments that imply booking even if the visible label is weak. */
export const CONVERSION_PATH_HREF_RE =
  /\/(?:request-?a-?quote|get-?a-?quote|free-?estimate|quote|book(?:ing)?|schedule|appointment|estimate)(?:\/|$|\?)/i;

/**
 * Known scheduling / form hosts. jotform is included only as a booking-shaped
 * path (user-requested jotform.com/form), not every jotform.com page.
 */
export const BOOKING_HOST_RE =
  /(?:^|[/.])(?:calendly\.com|acuityscheduling\.com|housecallpro\.com|getjobber\.com|setmore\.com|booksy\.com)(?:[:/]|$)|jotform\.com\/form/i;

const CTA_RE = /<(a|button)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
const SUBMIT_RE = /<input\b[^>]*type\s*=\s*["'](?:submit|button)["'][^>]*>/gi;

export type ConversionLocator = HtmlLocator;

/**
 * Why the conversion path could not be resolved to a single answer.
 *
 *   unverifiable_destination  the CTA label is there, the mechanism is not
 */
export type ConversionAmbiguity = "unverifiable_destination";

/**
 * Where a matched CTA actually leads.
 *
 * `none` is the interesting one: the page says "Request a Quote" but offers
 * nothing we can confirm behind it — an anchor with no real href, or a button
 * on a page with no form at all. Whether that CTA works is not knowable from
 * the HTML, so it is not a fact to report either way.
 */
export type ConversionDestination =
  "url" | "booking_host" | "form_submit" | "none";

export interface ConversionPathMatch {
  kind: "cta_text" | "booking_host";
  value: string;
  locator: ConversionLocator;
  prominent: boolean;
  snippet: string;
  destination?: ConversionDestination;
  /** Present only when the check could not resolve; drives `needs_review`. */
  ambiguity?: ConversionAmbiguity;
  /** Reviewer-facing specifics for the ambiguity. */
  ambiguityDetail?: string;
}

export interface ConversionPathResult {
  outcome: CheckOutcome;
  match?: ConversionPathMatch;
}

/** An href that actually goes somewhere, as opposed to `#` or a JS hook. */
function isNavigational(href: string | undefined): boolean {
  if (!href) return false;
  const trimmed = href.trim();
  if (trimmed === "" || trimmed === "#") return false;
  if (/^javascript:/i.test(trimmed)) return false;
  return true;
}

function attr(attrs: string, name: string): string | undefined {
  const re = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i");
  return re.exec(attrs)?.[1];
}

function visibleText(inner: string): string {
  return stripChrome(inner)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hostFromHref(href: string | undefined): string | undefined {
  if (!href) return undefined;
  try {
    return new URL(href, "https://example.com").hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function classifyCta(input: {
  text: string;
  href?: string;
  aria?: string;
}): { kind: ConversionPathMatch["kind"]; value: string } | undefined {
  const haystack = `${input.text} ${input.aria ?? ""}`;
  const phrase = CONVERSION_PATH_PHRASE_RE.exec(haystack);
  if (phrase) {
    return {
      kind: "cta_text",
      value: phrase[0].replace(/\s+/g, " ").slice(0, 64),
    };
  }

  const href = input.href ?? "";
  if (
    BOOKING_HOST_RE.test(href) ||
    BOOKING_HOST_RE.test(hostFromHref(href) ?? "")
  ) {
    return {
      kind: "booking_host",
      value: (hostFromHref(href) ?? href).slice(0, 64),
    };
  }
  if (CONVERSION_PATH_HREF_RE.test(href)) {
    return { kind: "cta_text", value: href.slice(0, 64) };
  }
  return undefined;
}

function collectMatches(html: string): ConversionPathMatch[] {
  const found: ConversionPathMatch[] = [];
  // A form anywhere on the page is a plausible mechanism for a bare button,
  // so its presence is what separates "JS-wired CTA" from "dead label".
  const hasForm = /<form\b/i.test(html);

  CTA_RE.lastIndex = 0;
  let tag: RegExpExecArray | null;
  while ((tag = CTA_RE.exec(html))) {
    const tagName = (tag[1] ?? "").toLowerCase();
    const attrs = tag[2] ?? "";
    const inner = tag[3] ?? "";
    const href = attr(attrs, "href");
    const classified = classifyCta({
      text: visibleText(inner),
      href,
      aria: attr(attrs, "aria-label") ?? attr(attrs, "title"),
    });
    if (!classified) continue;
    const needle = href ?? classified.value;
    const locator = locate(html, needle);
    found.push({
      ...classified,
      locator,
      prominent: isProminent(html, locator, needle),
      snippet: firstSnippet(html, needle),
      destination: resolveDestination({
        kind: classified.kind,
        tagName,
        href,
        hasForm,
      }),
    });
  }

  SUBMIT_RE.lastIndex = 0;
  let submit: RegExpExecArray | null;
  while ((submit = SUBMIT_RE.exec(html))) {
    const el = submit[0];
    const classified = classifyCta({
      text: attr(el, "value") ?? "",
      aria: attr(el, "aria-label") ?? attr(el, "title"),
    });
    if (!classified) continue;
    const locator = locate(html, classified.value);
    found.push({
      ...classified,
      locator,
      prominent: isProminent(html, locator, classified.value),
      snippet: firstSnippet(html, classified.value),
      // A submit control is itself the mechanism.
      destination: "form_submit",
    });
  }

  return found;
}

function resolveDestination(input: {
  kind: ConversionPathMatch["kind"];
  tagName: string;
  href: string | undefined;
  hasForm: boolean;
}): ConversionDestination {
  if (input.kind === "booking_host") return "booking_host";
  if (isNavigational(input.href)) return "url";
  if (input.tagName === "button") {
    return input.hasForm ? "form_submit" : "none";
  }
  // An anchor with no usable href leads nowhere we can see.
  return "none";
}

/**
 * pass: prominent quote/book/schedule CTA or booking-host link.
 * partial: such a CTA exists only in a non-prominent place (e.g. footer).
 * fail: none, including a page that only has generic "Contact Us".
 * not_assessed: home page was not fetched.
 *
 * When the only CTA on offer has no destination that can be verified from the
 * HTML, `match.ambiguity` is set: claiming a working conversion path would be
 * a guess, and so would claiming a broken one. `applyHomeRubric` escalates
 * that to `needs_review` and keeps this outcome as `pre_review_outcome`.
 */
export function assessConversionPaths(
  input: { homeAssessed: boolean; html?: string } | null,
): ConversionPathResult {
  if (!input?.homeAssessed || !input.html) {
    return { outcome: "not_assessed" };
  }

  const matches = collectMatches(input.html);
  if (matches.length === 0) return { outcome: "fail" };

  // Prefer a candidate we can actually stand behind: a prominent CTA with a
  // verifiable destination beats a prominent CTA without one, so a page that
  // has both is still a clean pass.
  const best =
    matches.find((row) => row.prominent && row.destination !== "none") ??
    matches.find((row) => row.prominent) ??
    matches.find((row) => row.destination !== "none") ??
    matches[0];

  const outcome: CheckOutcome = best.prominent ? "pass" : "partial";

  if (best.destination === "none") {
    return {
      outcome,
      match: {
        ...best,
        ambiguity: "unverifiable_destination",
        ambiguityDetail: `the CTA "${best.value}" has no destination that can be verified from the page`,
      },
    };
  }

  return { outcome, match: best };
}
