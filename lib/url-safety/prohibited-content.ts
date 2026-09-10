/**
 * Prohibited-content pre-flight categorization (PRD decision #11 rule 9).
 *
 * All five locked categories must be checked before any real fetch or
 * screenshot capture: adult, gambling, illegal, malware, dangerous.
 * "Never scan first and classify afterward" — this runs inside the URL-safety
 * guard, which evaluates the submitted URL and every redirect destination, so
 * a redirect cannot smuggle a prohibited target past the pre-flight.
 *
 * Matching is deterministic and offline: no categorization vendor is wired up
 * for Ring 1, so this is a domain/URL signal check rather than page-content
 * classification. Two match tiers keep precision reasonable:
 *
 *   - `substrings` — signals unambiguous enough to match anywhere in the host,
 *     because they effectively never occur in a home-service business domain.
 *   - `tokens` — matched only against whole host labels / path segments, for
 *     short words that would over-match as substrings ("bet" in "betterhomes").
 *
 * Short generic words are deliberately absent, and self-harm/violence signals
 * use compound forms ("suicidemethod", not "suicide") so that a prevention or
 * support resource is not misclassified. A prohibited match routes the audit
 * to the existing Unsupported terminal state; it adds no new audit state and
 * no new customer message family.
 */

export const PROHIBITED_CONTENT_CATEGORIES = [
  "adult",
  "gambling",
  "illegal",
  "malware",
  "dangerous",
] as const;

export type ProhibitedContentCategory =
  (typeof PROHIBITED_CONTENT_CATEGORIES)[number];

interface CategoryRules {
  /** Matched against the full hostname and the full decoded path. */
  substrings: readonly string[];
  /** Matched against whole host labels and whole path segments only. */
  tokens: readonly string[];
  /** Matched against the trailing TLD label. */
  tlds: readonly string[];
}

const RULES: Record<ProhibitedContentCategory, CategoryRules> = {
  adult: {
    substrings: [
      "porn",
      "xxx",
      "hentai",
      "camgirl",
      "onlyfans",
      "pornhub",
      "xvideos",
      "redtube",
      "brazzers",
      "chaturbate",
      "stripclub",
      "sexcam",
      "livesex",
      "adultvideo",
      "escortservice",
    ],
    tokens: [
      "sex",
      "adult",
      "nude",
      "nudes",
      "erotic",
      "erotica",
      "fetish",
      "milf",
      "bdsm",
      "nsfw",
      "brothel",
      "escorts",
    ],
    tlds: ["xxx", "adult", "porn", "sex", "sexy", "cam", "tube"],
  },
  gambling: {
    substrings: [
      "casino",
      "betting",
      "sportsbook",
      "sportsbet",
      "pokerstars",
      "roulette",
      "slotmachine",
      "gambling",
      "bookmaker",
      "onlinebet",
      "freespins",
      "jackpotcity",
    ],
    tokens: [
      "bet",
      "bets",
      "poker",
      "slots",
      "blackjack",
      "baccarat",
      "lottery",
      "lotto",
      "bingo",
      "wager",
      "wagers",
      "punt",
    ],
    tlds: ["casino", "bet", "poker", "bingo"],
  },
  illegal: {
    substrings: [
      "darkweb",
      "darknet",
      "silkroad",
      "carding",
      "counterfeit",
      "fakepassport",
      "fakeid",
      "stolencard",
      "creditcarddump",
      "humantrafficking",
      "hitmanforhire",
      "buydrugs",
      "drugmarket",
    ],
    tokens: [
      "warez",
      "keygen",
      "nulled",
      "cracks",
      "fullz",
      "dumps",
      "hitman",
      "forgeddocs",
      "contraband",
    ],
    tlds: [],
  },
  malware: {
    substrings: [
      "malware",
      "ransomware",
      "botnet",
      "keylogger",
      "trojan",
      "spyware",
      "rootkit",
      "exploitkit",
      "phishing",
      "infostealer",
      "cryptojack",
      "ddosservice",
      "credentialstealer",
    ],
    tokens: ["booter", "stresser", "loader", "webshell", "c2panel"],
    tlds: [],
  },
  dangerous: {
    substrings: [
      "bombmaking",
      "makeabomb",
      "explosivesguide",
      "pipebomb",
      "suicidemethod",
      "prosuicide",
      "suicidekit",
      "selfharmhow",
      "terrorism",
      "massshooting",
      "genocide",
      "poisonrecipe",
      "untraceablegun",
      "ghostgun",
      "3dprintedgun",
      "neonazi",
    ],
    tokens: ["jihadist", "proana", "promia"],
    tlds: [],
  },
};

export type ProhibitedContentResult =
  | { blocked: false }
  | {
      blocked: true;
      category: ProhibitedContentCategory;
      /** Which rule tier matched, for structured evidence. */
      matchedRule: "tld" | "host_substring" | "host_token" | "path";
      matchedValue: string;
    };

function hostLabels(hostname: string): string[] {
  return hostname
    .toLowerCase()
    .split(".")
    .flatMap((label) => label.split("-"))
    .filter(Boolean);
}

function pathTokens(pathname: string): string[] {
  let decoded = pathname.toLowerCase();
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Keep the raw path when it is not valid percent-encoding.
  }
  return decoded.split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * Classifies a URL against all five prohibited categories.
 *
 * Categories are evaluated in the locked order so a multi-category match
 * reports a stable primary category.
 */
export function classifyProhibitedContent(
  input: string | URL,
): ProhibitedContentResult {
  let url: URL;
  try {
    url = input instanceof URL ? input : new URL(input);
  } catch {
    return { blocked: false };
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const labels = hostLabels(hostname);
  const tld = labels.length > 0 ? labels[labels.length - 1] : "";
  const segments = pathTokens(url.pathname);
  const hostJoined = labels.join("");

  for (const category of PROHIBITED_CONTENT_CATEGORIES) {
    const rules = RULES[category];

    if (rules.tlds.includes(tld)) {
      return {
        blocked: true,
        category,
        matchedRule: "tld",
        matchedValue: tld,
      };
    }

    for (const needle of rules.substrings) {
      if (hostname.includes(needle) || hostJoined.includes(needle)) {
        return {
          blocked: true,
          category,
          matchedRule: "host_substring",
          matchedValue: needle,
        };
      }
    }

    for (const token of rules.tokens) {
      if (labels.includes(token)) {
        return {
          blocked: true,
          category,
          matchedRule: "host_token",
          matchedValue: token,
        };
      }
    }

    for (const needle of [...rules.substrings, ...rules.tokens]) {
      if (segments.includes(needle)) {
        return {
          blocked: true,
          category,
          matchedRule: "path",
          matchedValue: needle,
        };
      }
    }
  }

  return { blocked: false };
}

/** Every category the ruleset can actually return. Used to prove full coverage. */
export function coveredProhibitedCategories(): ProhibitedContentCategory[] {
  return PROHIBITED_CONTENT_CATEGORIES.filter((category) => {
    const rules = RULES[category];
    return (
      rules.substrings.length > 0 ||
      rules.tokens.length > 0 ||
      rules.tlds.length > 0
    );
  });
}
