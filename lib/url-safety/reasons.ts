export const URL_SAFETY_REASON_CODES = [
  "INVALID_URL",
  "DISALLOWED_PROTOCOL",
  "DISALLOWED_PORT",
  "CREDENTIALS_IN_URL",
  "BLOCKED_HOST",
  "BLOCKED_ADDRESS",
  "DNS_FAILED",
  "REDIRECT_BLOCKED",
  "TOO_MANY_REDIRECTS",
  "PROHIBITED_CONTENT",
] as const;

export type UrlSafetyReasonCode = (typeof URL_SAFETY_REASON_CODES)[number];

const CUSTOMER_MESSAGES: Record<UrlSafetyReasonCode, string> = {
  INVALID_URL: "This website address is not valid.",
  DISALLOWED_PROTOCOL: "Only http and https websites can be scanned.",
  DISALLOWED_PORT: "This website cannot be scanned.",
  CREDENTIALS_IN_URL: "This website address is not valid.",
  BLOCKED_HOST: "This website cannot be scanned.",
  BLOCKED_ADDRESS: "This website cannot be scanned.",
  DNS_FAILED: "This website could not be reached.",
  REDIRECT_BLOCKED: "This website cannot be scanned.",
  TOO_MANY_REDIRECTS: "This website cannot be scanned.",
  PROHIBITED_CONTENT: "This website cannot be scanned.",
};

export function customerMessageFor(code: UrlSafetyReasonCode): string {
  return CUSTOMER_MESSAGES[code];
}
