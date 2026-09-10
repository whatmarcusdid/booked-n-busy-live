import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { CRAWLER_USER_AGENT } from "@/lib/crawler/identity";
import { RETRY_USER_AGENT } from "@/lib/audit-workflow/retry";
import {
  BRAND_NAME,
  CANONICAL_HOST,
  CANONICAL_ORIGIN,
  canonicalOrigin,
  PRODUCT_NAME,
  SUPPORT_EMAIL,
} from "@/lib/identity";

/**
 * Lowest plausible size of the customer-facing surface. The walk currently
 * finds ~64 files; this only has to catch a collapse, not track the count.
 */
const MIN_CUSTOMER_FACING_FILES = 20;

/**
 * Files a customer can see: pages, components, public assets, emails, and the
 * copy modules that feed them.
 *
 * Throws rather than returning a short list. Every guard built on this asserts
 * the ABSENCE of something across these files, so a walk that quietly found
 * nothing — a moved root, a changed extension set — would turn all of them
 * into passes without failing anything.
 */
function customerFacingFiles(): string[] {
  const roots = ["app", "public", "lib/email", "lib/copy"];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (/\.(tsx?|svg|css|json|html|txt)$/.test(entry)) out.push(path);
    }
  };
  for (const root of roots) walk(root);
  if (out.length < MIN_CUSTOMER_FACING_FILES) {
    throw new Error(
      `the customer-facing walk over ${roots.join(", ")} found ${out.length} ` +
        `files, below the floor of ${MIN_CUSTOMER_FACING_FILES}. The guards ` +
        `using it assert absence, so this would silently pass them all.`,
    );
  }
  return out;
}

describe("public identity", () => {
  it("names the product and brand as locked", () => {
    expect(PRODUCT_NAME).toBe("Booked N Busy Websites");
    expect(BRAND_NAME).toBe("Booked N Busy");
    expect(CANONICAL_ORIGIN).toBe("https://bookednbusy.app");
    expect(SUPPORT_EMAIL).toBe("support@bookednbusy.app");
  });

  it("resolves the canonical origin, allowing a preview override", () => {
    expect(canonicalOrigin(undefined)).toBe(CANONICAL_ORIGIN);
    expect(canonicalOrigin("")).toBe(CANONICAL_ORIGIN);
    expect(canonicalOrigin("https://preview.example.com/")).toBe(
      "https://preview.example.com",
    );
  });

  it("cross-checks the Item 4 crawler User-Agent against these constants", () => {
    // Both User-Agents must carry the same support address and origin as
    // everything else, rather than a forked crawler-specific mailbox.
    for (const ua of [CRAWLER_USER_AGENT, RETRY_USER_AGENT]) {
      expect(ua).toContain(SUPPORT_EMAIL);
      expect(ua).toContain(`${CANONICAL_ORIGIN}/about-our-scanner`);
    }
    expect(CRAWLER_USER_AGENT).toBe(
      "BookedNBusyBot/1.0 (+https://bookednbusy.app/about-our-scanner; support@bookednbusy.app)",
    );
  });

  it("uses the canonical origin in page metadata", () => {
    const layout = readFileSync("app/layout.tsx", "utf8");
    expect(layout).toContain("canonicalOrigin()");
    expect(layout).toContain("PRODUCT_NAME");
    // The old internal title.
    expect(layout).not.toContain("Booked N Busy Live");
    expect(layout).not.toContain("Live booking product");
  });

  it("sends transactional mail from the brand domain with support as reply-to", () => {
    const resend = readFileSync("lib/email/resend.ts", "utf8");
    expect(resend).toContain("DEFAULT_FROM_EMAIL");
    expect(resend).toContain("reply_to: SUPPORT_EMAIL");
  });
});

describe("no legacy naming in customer-facing surfaces", () => {
  const files = customerFacingFiles();

  it("finds files to check", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("contains no 'Book Service' anywhere a customer could see it", () => {
    for (const path of files) {
      expect(readFileSync(path, "utf8")).not.toMatch(/book\s*service/i);
    }
  });

  it("contains no 'Ring 1' anywhere a customer could see it", () => {
    for (const path of files) {
      // Internal identifiers, DB columns, and docs may keep it; rendered
      // surfaces may not.
      expect(readFileSync(path, "utf8")).not.toMatch(/\bring\s*-?\s*1\b/i);
    }
  });

  it("references no origin other than the canonical one", () => {
    for (const path of files) {
      const source = readFileSync(path, "utf8");
      const origins = source.match(/https?:\/\/[a-z0-9.-]+/gi) ?? [];
      for (const origin of origins) {
        const host = origin.replace(/^https?:\/\//, "");
        // Not app origins: XML namespaces in SVG assets, and the email
        // provider's own API endpoint.
        if (host.endsWith("w3.org")) continue;
        if (host === "api.resend.com") continue;
        expect(host).toBe(CANONICAL_HOST);
      }
    }
  });

  it("uses no contact address other than support@", () => {
    for (const path of files) {
      const source = readFileSync(path, "utf8");
      const addresses =
        source.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [];
      for (const address of addresses) {
        expect(address.toLowerCase()).toBe(SUPPORT_EMAIL);
      }
    }
  });
});

describe("Tier A naming is untouched", () => {
  it("introduces no customer-facing paid-tier name", () => {
    // That decision is still open. Neither rename Tier A nor invent a
    // replacement for it.
    for (const path of customerFacingFiles()) {
      const source = readFileSync(path, "utf8");
      expect(source).not.toMatch(/tier\s*a\b/i);
      expect(source).not.toMatch(/audit sprint/i);
    }
  });

  it("leaks no retired tier or product naming into customer-facing copy", () => {
    // This previously walked lib/ and supabase/ and then asserted the hits
    // were not under app/ — which no lib/ or supabase/ path can ever be, so
    // it could not fail. It now scans the surface a customer actually reads.
    // Overlaps the guard above on Tier A by design: duplicated real coverage
    // is cheap, and names retired together should be checked together.
    const retired = [
      /tier\s*a\b/i,
      /tier\s*b\b/i,
      /tier\s*c\b/i,
      /book\s+service\s+audit\s+sprint/i,
      /audit\s+sprint/i,
    ];

    for (const path of customerFacingFiles()) {
      const source = readFileSync(path, "utf8");
      for (const pattern of retired) {
        expect(source).not.toMatch(pattern);
      }
    }
  });
});
