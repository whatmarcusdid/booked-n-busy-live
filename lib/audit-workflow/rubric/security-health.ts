import type { CheckOutcome } from "./model";

export interface SecurityHealthSignal {
  finalUrl: string;
  protocol: "http" | "https" | "other";
}

export interface SecurityHealthResult {
  outcome: CheckOutcome;
  signal?: SecurityHealthSignal;
  value?: string;
  locator?: string;
}

/**
 * Uses the already-fetched home-page final URL. No extra network call.
 * A successful https render is pass; a successful http render is fail.
 * Missing/failed home fetch is not_assessed (not fail).
 */
export function assessSecurityHealth(
  input: { homeAssessed: boolean; finalUrl?: string } | null,
): SecurityHealthResult {
  if (!input?.homeAssessed || !input.finalUrl) {
    return { outcome: "not_assessed" };
  }

  let parsed: URL;
  try {
    parsed = new URL(input.finalUrl);
  } catch {
    return { outcome: "not_assessed" };
  }

  const protocol =
    parsed.protocol === "https:"
      ? "https"
      : parsed.protocol === "http:"
        ? "http"
        : "other";
  const signal: SecurityHealthSignal = {
    finalUrl: parsed.toString(),
    protocol,
  };

  if (protocol === "https") {
    return {
      outcome: "pass",
      signal,
      value: parsed.toString(),
      locator: "final_url",
    };
  }

  return {
    outcome: "fail",
    signal,
    value: parsed.toString(),
    locator: "final_url",
  };
}
