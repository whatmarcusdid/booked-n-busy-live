/**
 * Wire shape for the `userAgent` parameter on Browserless's REST endpoints.
 *
 * Browserless validates this as an OBJECT (`{ userAgent: "<string>" }`), not
 * as a bare string. Passing the string form is rejected before navigation
 * with `400 POST Body validation failed: "userAgent" must be object`, which
 * fails the home fetch as `PROVIDER_ERROR` and takes the whole audit to
 * `failed` — so this is the difference between real scanning working and
 * every real audit dying at the first stage.
 *
 * It lives in its own module because `/content` and `/screenshot` both send
 * it, and a second copy is how the shape drifts again. Lighthouse's
 * `/performance` endpoint is NOT covered here: it takes the UA as a plain
 * string under `config.settings.emulatedUserAgent`, which is Lighthouse's
 * schema rather than Browserless's.
 *
 * See https://docs.browserless.io/open-api/chrome-content
 */
export interface BrowserlessUserAgent {
  userAgent: string;
}

export function browserlessUserAgent(value: string): BrowserlessUserAgent {
  return { userAgent: value };
}
