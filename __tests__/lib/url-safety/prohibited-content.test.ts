import {
  classifyProhibitedContent,
  coveredProhibitedCategories,
  PROHIBITED_CONTENT_CATEGORIES,
  type ProhibitedContentCategory,
} from "@/lib/url-safety/prohibited-content";
import { assessUrlSafety } from "@/lib/url-safety/guard";

/**
 * Decision #11 rule 9 names five categories and explicitly requires verifying
 * that the pre-check covers all five, "not only an earlier subset".
 */
describe("prohibited-content pre-flight (decision #11 rule 9)", () => {
  it("names exactly the five locked categories", () => {
    expect([...PROHIBITED_CONTENT_CATEGORIES]).toEqual([
      "adult",
      "gambling",
      "illegal",
      "malware",
      "dangerous",
    ]);
  });

  it("has active rules for every one of the five categories", () => {
    expect(coveredProhibitedCategories().sort()).toEqual(
      [...PROHIBITED_CONTENT_CATEGORIES].sort(),
    );
  });

  const cases: Array<[ProhibitedContentCategory, string]> = [
    ["adult", "https://freepornvideos.com"],
    ["adult", "https://example.xxx"],
    ["adult", "https://cams.adult"],
    ["gambling", "https://luckycasino.net"],
    ["gambling", "https://example.bet"],
    ["gambling", "https://poker.example.com"],
    ["illegal", "https://darkwebmarket.io"],
    ["illegal", "https://cheap-fakeid.net"],
    ["malware", "https://ransomwarebuilder.io"],
    ["malware", "https://example.com/booter"],
    ["dangerous", "https://bombmakingguide.net"],
    ["dangerous", "https://untraceablegun.store"],
  ];

  it.each(cases)("blocks %s content: %s", (category, url) => {
    const result = classifyProhibitedContent(url);
    expect(result.blocked).toBe(true);
    if (result.blocked) {
      expect(result.category).toBe(category);
      expect(result.matchedValue).toBeTruthy();
    }
  });

  it("blocks each of the five categories at least once across the fixtures", () => {
    const blocked = new Set(
      cases
        .map(([, url]) => classifyProhibitedContent(url))
        .filter((r) => r.blocked)
        .map((r) => (r.blocked ? r.category : null)),
    );
    for (const category of PROHIBITED_CONTENT_CATEGORIES) {
      expect(blocked.has(category)).toBe(true);
    }
  });

  it.each([
    "https://acmeplumbing.com",
    "https://betterhomesplumbing.com",
    "https://sextonhvac.com",
    "https://reliableroofing.com/services/gutter-repair",
    "https://cassidyelectric.com/about-us",
    "https://adultdaycareplumbers.example.com/contact",
  ])("does not block ordinary home-service URL %s", (url) => {
    expect(classifyProhibitedContent(url).blocked).toBe(false);
  });

  it("matches on whole host labels rather than substrings for short tokens", () => {
    // "bet" must not match inside "betterhomes".
    expect(classifyProhibitedContent("https://betterhomes.com").blocked).toBe(
      false,
    );
    expect(classifyProhibitedContent("https://bet.example.com").blocked).toBe(
      true,
    );
  });
});

describe("prohibited content runs inside the URL-safety guard", () => {
  const lookup = async () => ["93.184.216.34"];

  it("rejects a prohibited submitted URL before any fetch", async () => {
    const result = await assessUrlSafety("https://luckycasino.net", { lookup });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("PROHIBITED_CONTENT");
      expect(result.prohibited?.category).toBe("gambling");
    }
  });

  it("rejects a prohibited REDIRECT DESTINATION, not just the submitted URL", async () => {
    // The flagged security verification in decision #11: a clean submitted URL
    // must not be able to smuggle a prohibited target through a redirect.
    const probe = async (url: string) =>
      url.includes("innocent")
        ? { status: 302, location: "https://freepornvideos.com/" }
        : { status: 200 };

    const result = await assessUrlSafety("https://innocent.example.com", {
      lookup,
      probe,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("PROHIBITED_CONTENT");
      expect(result.prohibited?.category).toBe("adult");
    }
  });

  it("still allows a safe site through the guard", async () => {
    const result = await assessUrlSafety("https://acmeplumbing.com", {
      lookup,
    });
    expect(result.ok).toBe(true);
  });
});
