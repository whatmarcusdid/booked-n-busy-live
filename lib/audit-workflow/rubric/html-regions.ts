/** First this many characters of script/style-stripped HTML count as prominent. */
export const PROMINENT_HTML_CHARS = 4000;

export type HtmlLocator = "header" | "nav" | "main" | "footer" | "body";

export function stripChrome(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ");
}

/** Visible text only: scripts/styles removed, then tags stripped. */
export function visibleText(html: string): string {
  return stripChrome(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function innerByTag(html: string, tag: string): string {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  const parts: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    parts.push(match[1] ?? "");
  }
  return parts.join("\n");
}

export function innerByClassHint(html: string, hint: RegExp): string {
  const re = /<([a-z0-9]+)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  const parts: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const attrs = match[2] ?? "";
    if (hint.test(attrs)) {
      parts.push(match[3] ?? "");
    }
  }
  return parts.join("\n");
}

/**
 * Evidence snippet from cleaned visible text only. Never slices raw source.
 * If the needle is not contiguous after stripping tags, persist the phrase
 * itself rather than falling back to the start of the document.
 */
export function firstSnippet(source: string, needle: string): string {
  const cleaned = visibleText(source);
  const needleClean = needle.replace(/\s+/g, " ").trim();
  if (!needleClean) return "";
  const index = cleaned.toLowerCase().indexOf(needleClean.toLowerCase());
  if (index < 0) {
    return needleClean.slice(0, 80);
  }
  const start = Math.max(0, index - 16);
  return cleaned.slice(start, start + 80).trim();
}

export function locate(html: string, value: string): HtmlLocator {
  const header =
    innerByTag(html, "header") +
    innerByClassHint(html, /header|masthead|top-bar|site-header/i);
  if (
    header.includes(value) ||
    header.toLowerCase().includes(value.toLowerCase())
  ) {
    return "header";
  }
  const nav = innerByTag(html, "nav");
  if (nav.includes(value)) return "nav";
  const footer =
    innerByTag(html, "footer") +
    innerByClassHint(html, /footer|site-footer|page-footer/i);
  if (
    footer.includes(value) ||
    footer.toLowerCase().includes(value.toLowerCase())
  ) {
    return "footer";
  }
  const main = innerByTag(html, "main");
  if (main.includes(value)) return "main";
  return "body";
}

export function isProminent(
  html: string,
  locator: HtmlLocator,
  value: string,
): boolean {
  if (locator === "header" || locator === "nav") return true;
  if (locator === "footer") return false;
  const stripped = stripChrome(html);
  const budget = stripped.slice(0, PROMINENT_HTML_CHARS);
  return budget.includes(value);
}
