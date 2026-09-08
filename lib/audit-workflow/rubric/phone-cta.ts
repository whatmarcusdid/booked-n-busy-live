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

/**
 * North-American (optional +1) 10-digit numbers and E.164-ish +digits.
 * Deliberately ignores 4-digit years and bare zip codes.
 */
const PHONE_TEXT_RE =
  /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}|\+(?:[1-9]\d{6,14}))/g;

export type PhoneLocator = HtmlLocator;

export interface PhoneCtaMatch {
  kind: "tel_link" | "text_pattern";
  value: string;
  locator: PhoneLocator;
  prominent: boolean;
  snippet: string;
}

export interface PhoneCtaResult {
  outcome: CheckOutcome;
  match?: PhoneCtaMatch;
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

/**
 * pass: a tel: link that is prominent (header/nav or first 4000 chars, not footer-only).
 * partial: a phone exists but is not a tel: link and/or is only in the footer.
 * fail: no tel: link and no recognizable phone pattern.
 * not_assessed: caller must pass homeAssessed=false / missing html.
 */
export function assessPhoneCta(
  input: { homeAssessed: boolean; html?: string } | null,
): PhoneCtaResult {
  if (!input?.homeAssessed || !input.html) {
    return { outcome: "not_assessed" };
  }

  const html = input.html;
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
    };
    return {
      outcome: prominent ? "pass" : "partial",
      match,
    };
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
    };
    return { outcome: "partial", match };
  }

  return { outcome: "fail" };
}
