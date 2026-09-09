/** Catalog key in v2 is phone_cta_visibility. Scoring logic is unchanged. */
import type { CheckOutcome } from "./model";
import {
  firstSnippet,
  isProminent,
  locate,
  PROMINENT_HTML_CHARS,
  stripChrome,
  type HtmlLocator,
} from "./html-regions";

/** @deprecated use PROMINENT_HTML_CHARS — kept so existing imports keep working. */
export const PHONE_CTA_PROMINENT_HTML_CHARS = PROMINENT_HTML_CHARS;

const TEL_HREF_RE = /<a\b[^>]*\bhref\s*=\s*["'](tel:[^"']+)["'][^>]*>/gi;

/** Whole anchor, so an href can be compared against its own visible label. */
const TEL_ANCHOR_RE =
  /<a\b[^>]*\bhref\s*=\s*["']tel:([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

/**
 * North-American (optional +1) 10-digit numbers and E.164-ish +digits.
 * Deliberately ignores 4-digit years and bare zip codes.
 */
const PHONE_TEXT_RE =
  /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}|\+(?:[1-9]\d{6,14}))/g;

/** Ceiling on candidates scanned, so a pathological page cannot spin here. */
const MAX_CANDIDATES = 25;

export type PhoneLocator = HtmlLocator;

/**
 * Why the contact path could not be resolved to a single answer.
 *
 *   tel_text_mismatch      an anchor dials one number and displays another
 *   competing_prominent    two or more prominent numbers, no clear primary
 */
export type PhoneAmbiguity = "tel_text_mismatch" | "competing_prominent";

export interface PhoneCtaMatch {
  kind: "tel_link" | "text_pattern";
  value: string;
  locator: PhoneLocator;
  prominent: boolean;
  snippet: string;
  /** Present only when the check could not resolve; drives `needs_review`. */
  ambiguity?: PhoneAmbiguity;
  /** Reviewer-facing specifics for the ambiguity. */
  ambiguityDetail?: string;
}

export interface PhoneCtaResult {
  outcome: CheckOutcome;
  match?: PhoneCtaMatch;
}

/**
 * Comparable digits for one phone reference. Strips punctuation and the
 * North-American country code, so `+1 (555) 123-4567` and `555-123-4567`
 * are recognised as the same number rather than as two competing ones.
 */
export function phoneDigits(value: string): string {
  const digits = value.replace(/\D+/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

function findTel(html: string): string | undefined {
  TEL_HREF_RE.lastIndex = 0;
  const match = TEL_HREF_RE.exec(html);
  return match?.[1];
}

function findTextPhone(html: string): string | undefined {
  const text = stripChrome(html).replace(/<[^>]+>/g, " ");
  PHONE_TEXT_RE.lastIndex = 0;
  const match = PHONE_TEXT_RE.exec(text);
  return match?.[0]?.trim();
}

interface TelAnchor {
  href: string;
  digits: string;
  labelDigits: string | null;
}

function collectTelAnchors(html: string): TelAnchor[] {
  const anchors: TelAnchor[] = [];
  TEL_ANCHOR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while (
    (match = TEL_ANCHOR_RE.exec(html)) &&
    anchors.length < MAX_CANDIDATES
  ) {
    const href = match[1] ?? "";
    const label = (match[2] ?? "").replace(/<[^>]+>/g, " ");
    PHONE_TEXT_RE.lastIndex = 0;
    const labelPhone = PHONE_TEXT_RE.exec(label)?.[0];
    anchors.push({
      href,
      digits: phoneDigits(href),
      // Only a label that actually shows a number can disagree with the
      // href. "Call Now" says nothing that could contradict it.
      labelDigits: labelPhone ? phoneDigits(labelPhone) : null,
    });
  }
  return anchors;
}

function collectTextPhones(html: string): string[] {
  const text = stripChrome(html).replace(/<[^>]+>/g, " ");
  const found: string[] = [];
  PHONE_TEXT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PHONE_TEXT_RE.exec(text)) && found.length < MAX_CANDIDATES) {
    const value = match[0].trim();
    if (value) found.push(value);
  }
  return found;
}

/**
 * Whether the page presents one contact number or several competing ones.
 *
 * A single number repeated in the header, hero, and footer is not ambiguous,
 * which is why comparison is on normalised digits rather than on raw strings.
 */
function detectAmbiguity(
  html: string,
  telAnchors: TelAnchor[],
): { ambiguity: PhoneAmbiguity; detail: string } | null {
  const mismatch = telAnchors.find(
    (anchor) =>
      anchor.labelDigits != null &&
      anchor.digits.length > 0 &&
      anchor.labelDigits !== anchor.digits,
  );
  if (mismatch) {
    return {
      ambiguity: "tel_text_mismatch",
      detail: `a tel: link dials ${mismatch.digits} but displays ${mismatch.labelDigits}`,
    };
  }

  const prominentDigits = new Set<string>();
  for (const anchor of telAnchors) {
    if (!anchor.digits) continue;
    const locator = locate(html, `tel:${anchor.href}`);
    if (isProminent(html, locator, `tel:${anchor.href}`)) {
      prominentDigits.add(anchor.digits);
    }
  }
  for (const value of collectTextPhones(html)) {
    const locator = locate(html, value);
    if (isProminent(html, locator, value)) {
      prominentDigits.add(phoneDigits(value));
    }
  }

  if (prominentDigits.size > 1) {
    return {
      ambiguity: "competing_prominent",
      detail: `${prominentDigits.size} different phone numbers are equally prominent`,
    };
  }

  return null;
}

/**
 * pass: a tel: link that is prominent (header/nav or first 4000 chars, not footer-only).
 * partial: a phone exists but is not a tel: link and/or is only in the footer.
 * fail: no tel: link and no recognizable phone pattern.
 * not_assessed: caller must pass homeAssessed=false / missing html.
 *
 * When which number is the contact path is unresolvable — a link that dials
 * one number and displays another, or several equally prominent numbers —
 * `match.ambiguity` is set and the outcome above is the one the page would
 * otherwise have earned. `applyHomeRubric` escalates it to `needs_review`
 * and keeps this outcome as `pre_review_outcome`.
 */
export function assessPhoneCta(
  input: { homeAssessed: boolean; html?: string } | null,
): PhoneCtaResult {
  if (!input?.homeAssessed || !input.html) {
    return { outcome: "not_assessed" };
  }

  const html = input.html;
  const ambiguous = detectAmbiguity(html, collectTelAnchors(html));

  const tel = findTel(html);
  if (tel) {
    const locator = locate(html, tel);
    const prominent = isProminent(html, locator, tel);
    const match: PhoneCtaMatch = {
      kind: "tel_link",
      value: tel.slice(0, 64),
      locator,
      prominent,
      snippet: firstSnippet(html, tel),
      ...(ambiguous
        ? { ambiguity: ambiguous.ambiguity, ambiguityDetail: ambiguous.detail }
        : {}),
    };
    return { outcome: prominent ? "pass" : "partial", match };
  }

  const textPhone = findTextPhone(html);
  if (textPhone) {
    const locator = locate(html, textPhone);
    const match: PhoneCtaMatch = {
      kind: "text_pattern",
      value: textPhone.slice(0, 64),
      locator,
      prominent: isProminent(html, locator, textPhone),
      snippet: firstSnippet(html, textPhone),
      ...(ambiguous
        ? { ambiguity: ambiguous.ambiguity, ambiguityDetail: ambiguous.detail }
        : {}),
    };
    return { outcome: "partial", match };
  }

  return { outcome: "fail" };
}
