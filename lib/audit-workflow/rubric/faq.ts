import type { CheckOutcome } from "./model";
import {
  firstSnippet,
  innerByTag,
  isProminent,
  locate,
  stripChrome,
  type HtmlLocator,
} from "./html-regions";

export const FAQ_HEADING_RE =
  /\b(?:faqs?|frequently\s+asked\s+questions|common\s+questions)\b/i;

const THIN_QUESTIONS_RE = /\bquestions\??\b/i;

const HEADING_RE = /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi;
const JSON_LD_RE =
  /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

export type FaqKind = "faqpage_jsonld" | "faq_section" | "thin_faq";

export interface FaqMatch {
  kind: FaqKind;
  value: string;
  locator: HtmlLocator;
  prominent: boolean;
  snippet: string;
  pairCount?: number;
}

export interface FaqResult {
  outcome: CheckOutcome;
  match?: FaqMatch;
}

function bodyHtml(html: string): string {
  const body = innerByTag(html, "body");
  return body || html;
}

function visibleText(html: string): string {
  return stripChrome(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function toMatch(
  html: string,
  kind: FaqKind,
  value: string,
  extra: Partial<FaqMatch> = {},
): FaqMatch {
  const locator = locate(html, value) === "body" && kind === "faqpage_jsonld"
    ? "body"
    : locate(html, value);
  return {
    kind,
    value: value.replace(/\s+/g, " ").trim().slice(0, 64),
    locator,
    prominent: kind === "faqpage_jsonld" ? true : isProminent(html, locator, value),
    snippet: firstSnippet(html, value) || value.slice(0, 80),
    ...extra,
  };
}

function jsonLdTypes(node: unknown, found: Set<string>): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) jsonLdTypes(item, found);
    return;
  }
  const record = node as Record<string, unknown>;
  const type = record["@type"];
  if (typeof type === "string") found.add(type.toLowerCase());
  if (Array.isArray(type)) {
    for (const item of type) {
      if (typeof item === "string") found.add(item.toLowerCase());
    }
  }
  if (record["@graph"]) jsonLdTypes(record["@graph"], found);
}

function hasFaqPageJsonLd(html: string): boolean {
  JSON_LD_RE.lastIndex = 0;
  let block: RegExpExecArray | null;
  while ((block = JSON_LD_RE.exec(html))) {
    try {
      const parsed: unknown = JSON.parse(block[1] ?? "");
      const types = new Set<string>();
      jsonLdTypes(parsed, types);
      if (types.has("faqpage")) return true;
    } catch {
      /* ignore invalid JSON-LD */
    }
  }
  return false;
}

function countQa(html: string): number {
  const details = (html.match(/<details\b/gi) ?? []).length;
  const dts = (html.match(/<dt\b/gi) ?? []).length;
  const marked = (html.match(/itemprop\s*=\s*["']name["']/gi) ?? []).length;
  const questions = (html.match(/<h[3-6]\b[^>]*>[^<]{0,120}\?[^<]*<\/h[3-6]>/gi) ?? []).length;
  return Math.max(details, dts, marked, questions);
}

function findFaqSections(html: string): FaqMatch[] {
  const found: FaqMatch[] = [];
  HEADING_RE.lastIndex = 0;
  let heading: RegExpExecArray | null;
  while ((heading = HEADING_RE.exec(html))) {
    const label = visibleText(heading[1] ?? "");
    const after = html.slice(
      heading.index + heading[0].length,
      heading.index + heading[0].length + 4000,
    );
    const pairs = countQa(after);
    if (FAQ_HEADING_RE.test(label)) {
      found.push(
        toMatch(html, pairs >= 3 ? "faq_section" : "thin_faq", label, {
          pairCount: pairs,
        }),
      );
      continue;
    }
    if (THIN_QUESTIONS_RE.test(label) && pairs <= 2) {
      found.push(toMatch(html, "thin_faq", label, { pairCount: pairs }));
    }
  }
  return found;
}

/**
 * pass: FAQPage JSON-LD anywhere, or an FAQ heading with 3+ Q&A pairs.
 * partial: FAQ heading with fewer than 3 pairs, or a thin "Questions?" heading.
 * fail: none of the above.
 * not_assessed: home page was not fetched.
 */
export function assessFaq(
  input: { homeAssessed: boolean; html?: string } | null,
): FaqResult {
  if (!input?.homeAssessed || !input.html) {
    return { outcome: "not_assessed" };
  }

  if (hasFaqPageJsonLd(input.html)) {
    return {
      outcome: "pass",
      match: {
        kind: "faqpage_jsonld",
        value: "FAQPage schema found",
        locator: "body",
        prominent: true,
        snippet: "FAQPage schema found",
      },
    };
  }

  const sections = findFaqSections(bodyHtml(input.html));
  const genuine = sections.find((row) => row.kind === "faq_section");
  if (genuine) {
    return {
      outcome: genuine.prominent ? "pass" : "partial",
      match: genuine,
    };
  }
  if (sections.length > 0) {
    const thin = sections.find((row) => row.prominent) ?? sections[0];
    return { outcome: "partial", match: thin };
  }
  return { outcome: "fail" };
}
