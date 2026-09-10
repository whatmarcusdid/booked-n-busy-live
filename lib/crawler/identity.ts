import { CRAWLER_INFO_URL, SUPPORT_EMAIL } from "../identity";

/**
 * Crawler identity (PRD "Robots.txt and crawler identification").
 *
 * Every outbound request to a customer's website carries this User-Agent —
 * both Browserless-driven page loads and any direct fetch. Site owners who
 * see the scanner in their logs get a product name, an explanation page, and
 * a human to contact, which is the whole point of identifying honestly.
 *
 * The contact address is the same `support@bookednbusy.app` used everywhere
 * else; do not fork it into a crawler-specific mailbox.
 */
export const CRAWLER_USER_AGENT = `BookedNBusyBot/1.0 (+${CRAWLER_INFO_URL}; ${SUPPORT_EMAIL})`;

/**
 * The product token we match robots.txt `User-agent:` groups against.
 * Lowercased for comparison; robots.txt matching is case-insensitive.
 */
export const CRAWLER_PRODUCT_TOKEN = "bookednbusybot";
