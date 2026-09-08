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
 * Explicit response-time / expectation language. Kept as a small token list
 * plus a bounded "verb … within N hour/minute" window so matching stays linear.
 */
export const RESPONSE_TIME_RE =
  /\b(?:same[- ]day(?:\s+(?:service|appointment|arrival))?|next[- ]day(?:\s+service)?|24\/7|24[- ]hour(?:s)?(?:\s+(?:service|response|emergency))?|(?:we\s+)?respond(?:s|ing)?\s+within|(?:we\s+)?call(?:s|ed)?\s+back\s+within|callback\s+within|(?:get\s+)?back\s+to\s+you\s+within|arrive(?:s)?\s+within|on[- ]site\s+within|as\s+soon\s+as\s+today)\b/gi;

const WITHIN_WINDOW_RE =
  /\b(?:respond|call back|callback|arrive|on[- ]site|on site).{0,24}within\s+(?:an?\s+)?(?:\d{1,2}\s+)?(?:hour|hours|minute|minutes)\b/gi;

export const PROCESS_HEADING_RE =
  /\b(?:how\s+it\s+works|how\s+we\s+work|our\s+process|the\s+process|what\s+to\s+expect|(?:\d+|three|simple|easy)\s+steps)\b/i;

const HEADING_RE = /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi;
const OL_RE = /<ol\b[^>]*>([\s\S]*?)<\/ol>/gi;
const STEP_RE = /\bstep\s*[1-9]\b/gi;

export type ProcessClarityKind = "process_steps" | "response_time";

export interface ProcessClarityMatch {
  kind: ProcessClarityKind;
  value: string;
  locator: HtmlLocator;
  prominent: boolean;
  snippet: string;
}

export interface ProcessClarityResult {
  outcome: CheckOutcome;
  match?: ProcessClarityMatch;
}

function bodyHtml(html: string): string {
  const body = innerByTag(html, "body");
  return body || html;
}

function visibleText(html: string): string {
  return stripChrome(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function countLi(html: string): number {
  return (html.match(/<li\b/gi) ?? []).length;
}

function countSteps(text: string): number {
  STEP_RE.lastIndex = 0;
  let count = 0;
  while (STEP_RE.exec(text)) count += 1;
  return count;
}

function toMatch(
  html: string,
  kind: ProcessClarityKind,
  value: string,
): ProcessClarityMatch {
  const locator = locate(html, value);
  return {
    kind,
    value: value.replace(/\s+/g, " ").trim().slice(0, 64),
    locator,
    prominent: isProminent(html, locator, value),
    snippet: firstSnippet(html, value),
  };
}

function findResponseTimes(html: string, text: string): ProcessClarityMatch[] {
  const found: ProcessClarityMatch[] = [];
  for (const re of [RESPONSE_TIME_RE, WITHIN_WINDOW_RE]) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      found.push(toMatch(html, "response_time", match[0]));
    }
  }
  return found;
}

function findProcessSteps(html: string): ProcessClarityMatch[] {
  const found: ProcessClarityMatch[] = [];
  HEADING_RE.lastIndex = 0;
  let heading: RegExpExecArray | null;
  while ((heading = HEADING_RE.exec(html))) {
    const label = visibleText(heading[1] ?? "");
    if (!PROCESS_HEADING_RE.test(label)) continue;
    const after = html.slice(heading.index + heading[0].length, heading.index + heading[0].length + 2500);
    OL_RE.lastIndex = 0;
    const ol = OL_RE.exec(after);
    const olItems = ol ? countLi(ol[1] ?? "") : 0;
    const steps = countSteps(visibleText(after));
    if (olItems >= 2 || steps >= 2) {
      found.push(toMatch(html, "process_steps", label));
    }
  }
  return found;
}

/**
 * pass: a process heading plus a 2+ item sequence, or response-time language,
 * in prominent content.
 * partial: the same signals only in a non-prominent region.
 * fail: neither.
 * not_assessed: home page was not fetched.
 */
export function assessProcessClarity(
  input: { homeAssessed: boolean; html?: string } | null,
): ProcessClarityResult {
  if (!input?.homeAssessed || !input.html) {
    return { outcome: "not_assessed" };
  }

  const html = bodyHtml(input.html);
  const text = visibleText(html);
  const matches = [
    ...findProcessSteps(input.html),
    ...findResponseTimes(input.html, text),
  ];
  if (matches.length === 0) return { outcome: "fail" };
  const best = matches.find((row) => row.prominent) ?? matches[0];
  return {
    outcome: best.prominent ? "pass" : "partial",
    match: best,
  };
}
