/**
 * Public identity. Single source for every customer-visible name, origin,
 * and contact address.
 *
 * Centralised because the previous values were duplicated as literals across
 * the crawler User-Agent, the retry User-Agent, and page metadata, which is
 * how the product name and the app title drifted apart.
 */

/** Product name, for anything describing what the customer is using. */
export const PRODUCT_NAME = "Booked N Busy Websites";

/** Company/brand name, for anything describing who they're dealing with. */
export const BRAND_NAME = "Booked N Busy";

export const CANONICAL_HOST = "bookednbusy.app";
export const CANONICAL_ORIGIN = `https://${CANONICAL_HOST}`;

export const SUPPORT_EMAIL = `support@${CANONICAL_HOST}`;

/** Sender identity for transactional mail, when not configured explicitly. */
export const DEFAULT_FROM_EMAIL = `reports@${CANONICAL_HOST}`;

/** Public page explaining the crawler, cited in the User-Agent string. */
export const CRAWLER_INFO_URL = `${CANONICAL_ORIGIN}/about-our-scanner`;

/**
 * The application's canonical origin.
 *
 * Environment override exists for preview deployments, which need to
 * self-reference; production resolves to the canonical host.
 */
export function canonicalOrigin(
  configured: string | undefined = process.env.NEXT_PUBLIC_APP_ORIGIN,
): string {
  const trimmed = configured?.trim().replace(/\/$/, "");
  return trimmed || CANONICAL_ORIGIN;
}

/** Hosts allowed to be treated as this application. */
export function allowedOrigins(): readonly string[] {
  const configured = canonicalOrigin();
  return configured === CANONICAL_ORIGIN
    ? [CANONICAL_ORIGIN]
    : [configured, CANONICAL_ORIGIN];
}
