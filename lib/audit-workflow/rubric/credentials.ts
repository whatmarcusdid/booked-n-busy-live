/**
 * Catalog key in v2 is license_insurance. Scoring logic is unchanged.
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

/**
 * Explicit credibility adjectives. Word-boundary only so "unlicensed" /
 * "uninsured" do not match. UK "licenced" is accepted as the same signal.
 */
const CREDENTIAL_WORD_SOURCE =
  "(?:licensed|licenced|insured|bonded|certified|accredited)";

export const CREDENTIAL_WORD_RE = new RegExp(
  `\\b${CREDENTIAL_WORD_SOURCE}\\b`,
  "gi",
);

function hasCredentialWord(value: string): boolean {
  return new RegExp(`\\b${CREDENTIAL_WORD_SOURCE}\\b`, "i").test(value);
}

/**
 * License / licence / lic. followed by an optional # / no. / number label
 * and a short alphanumeric code that contains at least one digit.
 * Matches "License #12345", "Lic. No. ABC-1234", "licence number 88-A".
 * Does not match "licensed" (that is CREDENTIAL_WORD_RE) or "license" alone.
 */
export const LICENSE_NUMBER_RE =
  /\b(?:license|licence|lic\.?)\s*(?:#|no\.?|num(?:ber)?\.?)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9.-]{2,15})\b/gi;

/** Extra badge-only tokens. These never count as a pass by themselves. */
const BADGE_EXTRA_RE = /\b(?:bbb|better business bureau)\b/i;

const IMG_RE = /<img\b[^>]*>/gi;

export type CredentialsKind = "credential_word" | "license_number" | "badge_alt";

export interface CredentialsMatch {
  kind: CredentialsKind;
  value: string;
  locator: HtmlLocator;
  prominent: boolean;
  snippet: string;
}

export interface CredentialsResult {
  outcome: CheckOutcome;
  match?: CredentialsMatch;
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

function hasDigit(value: string): boolean {
  return /\d/.test(value);
}

function toMatch(
  html: string,
  kind: CredentialsKind,
  value: string,
): CredentialsMatch {
  const locator = locate(html, value);
  return {
    kind,
    value: value.replace(/\s+/g, " ").slice(0, 64),
    locator,
    prominent: isProminent(html, locator, value),
    snippet: firstSnippet(html, value),
  };
}

function findCredentialWords(html: string, text: string): CredentialsMatch[] {
  const found: CredentialsMatch[] = [];
  CREDENTIAL_WORD_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CREDENTIAL_WORD_RE.exec(text))) {
    const value = match[0];
    found.push(toMatch(html, "credential_word", value));
  }
  return found;
}

function findLicenseNumbers(html: string, text: string): CredentialsMatch[] {
  const found: CredentialsMatch[] = [];
  LICENSE_NUMBER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LICENSE_NUMBER_RE.exec(text))) {
    const code = match[1] ?? "";
    if (!hasDigit(code)) continue;
    found.push(toMatch(html, "license_number", match[0]));
  }
  return found;
}

function findBadgeAlts(html: string): CredentialsMatch[] {
  const found: CredentialsMatch[] = [];
  IMG_RE.lastIndex = 0;
  let tag: RegExpExecArray | null;
  while ((tag = IMG_RE.exec(html))) {
    const alt = (attr(tag[0], "alt") ?? "").replace(/\s+/g, " ").trim();
    if (!alt) continue;
    CREDENTIAL_WORD_RE.lastIndex = 0;
    const word = CREDENTIAL_WORD_RE.exec(alt);
    if (word) {
      found.push(toMatch(html, "credential_word", word[0]));
      continue;
    }
    if (BADGE_EXTRA_RE.test(alt)) {
      found.push(toMatch(html, "badge_alt", alt.slice(0, 64)));
    }
  }
  return found;
}

function pickBest(matches: CredentialsMatch[]): CredentialsMatch | undefined {
  return matches.find((row) => row.prominent) ?? matches[0];
}

/**
 * pass: an explicit credential adjective in prominent content (header/nav
 * or first 4000 chars of stripped HTML). A header/nav badge whose alt
 * contains one of those adjectives also passes.
 * partial: the same language only in a non-prominent place, a license-number
 * pattern without an adjective, or a BBB-only badge alt.
 * fail: none of the above.
 * not_assessed: home page was not fetched.
 */
export function assessCredentials(
  input: { homeAssessed: boolean; html?: string } | null,
): CredentialsResult {
  if (!input?.homeAssessed || !input.html) {
    return { outcome: "not_assessed" };
  }

  const html = input.html;
  const text = visibleText(bodyHtml(html));
  const words = findCredentialWords(html, text);
  const badges = findBadgeAlts(bodyHtml(html));
  const adjectiveBadges = badges.filter((row) => hasCredentialWord(row.value));
  const extraBadges = badges.filter((row) => !hasCredentialWord(row.value));

  const adjectives = [...words, ...adjectiveBadges];
  const bestAdjective = pickBest(adjectives);
  if (bestAdjective) {
    return {
      outcome: bestAdjective.prominent ? "pass" : "partial",
      match: bestAdjective,
    };
  }

  const licenses = findLicenseNumbers(html, text);
  const weaker = pickBest([...licenses, ...extraBadges]);
  if (weaker) {
    return { outcome: "partial", match: weaker };
  }

  return { outcome: "fail" };
}
