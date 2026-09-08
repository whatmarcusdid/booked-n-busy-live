/**
 * Retained for possible future reuse. Not part of the v2 / PRD Section 7
 * 12-check catalog — do not wire this into REAL_HOME_CHECKS or scoring.
 */
import type { CheckOutcome } from "./model";
import {
  firstSnippet,
  isProminent,
  locate,
  type HtmlLocator,
} from "./html-regions";

const MAILTO_RE = /<a\b[^>]*\bhref\s*=\s*["'](mailto:[^"']+)["'][^>]*>/gi;
const FORM_RE = /<form\b[^>]*>[\s\S]*?<\/form>/gi;

const SEARCH_FORM_RE =
  /type\s*=\s*["']search["']|name\s*=\s*["'](?:q|s|query|search)["']|role\s*=\s*["']search["']|id\s*=\s*["'][^"']*search/i;

const NEWSLETTER_ONLY_RE =
  /newsletter|subscribe|mailing[-_\s]?list/i;

const CONTACT_FORM_HINT_RE =
  /\b(contact|quote|inquiry|enquiry|booking|appointment|get[-_\s]?in[-_\s]?touch)\b/i;

const CONTACT_NEAR_RE =
  /\b(contact(?:\s+us)?|get in touch|reach us|send us|request a quote|book now|schedule|enquiry|inquiry)\b/i;

export type ContactLocator = HtmlLocator;

export interface ContactFormsMatch {
  kind: "form" | "mailto";
  value: string;
  locator: ContactLocator;
  prominent: boolean;
  snippet: string;
}

export interface ContactFormsResult {
  outcome: CheckOutcome;
  match?: ContactFormsMatch;
}

function findMailto(html: string): string | undefined {
  MAILTO_RE.lastIndex = 0;
  const match = MAILTO_RE.exec(html);
  return match?.[1];
}

function formFieldHints(formHtml: string): string[] {
  const hints: string[] = [];
  if (/<textarea\b/i.test(formHtml)) hints.push("message");
  if (/type\s*=\s*["']email["']|name\s*=\s*["'][^"']*email/i.test(formHtml)) {
    hints.push("email");
  }
  if (
    /name\s*=\s*["'][^"']*name|id\s*=\s*["'][^"']*name|placeholder\s*=\s*["'][^"']*name/i.test(
      formHtml,
    )
  ) {
    hints.push("name");
  }
  if (/type\s*=\s*["']tel["']|name\s*=\s*["'][^"']*(?:phone|tel)/i.test(formHtml)) {
    hints.push("phone");
  }
  return hints;
}

function isSearchForm(formHtml: string): boolean {
  return SEARCH_FORM_RE.test(formHtml);
}

function isContactForm(formHtml: string, precedingText: string): boolean {
  if (isSearchForm(formHtml)) return false;

  const attrsEnd = formHtml.indexOf(">");
  const attrs = attrsEnd >= 0 ? formHtml.slice(0, attrsEnd) : formHtml;
  if (CONTACT_FORM_HINT_RE.test(attrs)) return true;

  const hints = formFieldHints(formHtml);
  if (hints.includes("message")) return true;
  if (hints.includes("email") && (hints.includes("name") || hints.includes("phone"))) {
    return true;
  }

  const nearby = `${precedingText} ${formHtml}`;
  if (
    (hints.includes("email") || hints.includes("name") || hints.includes("phone")) &&
    CONTACT_NEAR_RE.test(nearby)
  ) {
    return true;
  }

  // Lone email field labeled as newsletter is not a contact form.
  if (hints.length === 1 && hints[0] === "email" && NEWSLETTER_ONLY_RE.test(nearby)) {
    return false;
  }

  return false;
}

function summarizeForm(formHtml: string): string {
  const hints = formFieldHints(formHtml);
  return `form:${hints.join(",") || "contact"}`.slice(0, 64);
}

function findContactForm(
  html: string,
): { marker: string; value: string } | undefined {
  FORM_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FORM_RE.exec(html))) {
    const formHtml = match[0];
    const start = match.index ?? 0;
    const preceding = html.slice(Math.max(0, start - 240), start);
    if (!isContactForm(formHtml, preceding)) continue;
    return { marker: formHtml.slice(0, 48), value: summarizeForm(formHtml) };
  }
  return undefined;
}

/**
 * pass: a contact-intent <form> that is prominent, or a prominent mailto:.
 * partial: a form or mailto: exists but is not prominent (e.g. footer only).
 * fail: no contact form and no mailto: in the fetched HTML.
 * not_assessed: home page was not fetched.
 *
 * JS-injected forms (HubSpot, iframe widgets, React after load) are invisible
 * here — we only see the HTML Browserless returned.
 */
export function assessContactForms(
  input: { homeAssessed: boolean; html?: string } | null,
): ContactFormsResult {
  if (!input?.homeAssessed || !input.html) {
    return { outcome: "not_assessed" };
  }

  const html = input.html;
  const matches: ContactFormsMatch[] = [];

  const form = findContactForm(html);
  if (form) {
    const locator = locate(html, form.marker);
    matches.push({
      kind: "form",
      value: form.value,
      locator,
      prominent: isProminent(html, locator, form.marker),
      snippet: firstSnippet(html, form.marker),
    });
  }

  const mailto = findMailto(html);
  if (mailto) {
    const locator = locate(html, mailto);
    matches.push({
      kind: "mailto",
      value: mailto.slice(0, 64),
      locator,
      prominent: isProminent(html, locator, mailto),
      snippet: firstSnippet(html, mailto),
    });
  }

  if (matches.length === 0) return { outcome: "fail" };
  const best = matches.find((row) => row.prominent) ?? matches[0];
  return {
    outcome: best.prominent ? "pass" : "partial",
    match: best,
  };
}
