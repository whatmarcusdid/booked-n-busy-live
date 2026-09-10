import { createHmac, timingSafeEqual } from "crypto";

/**
 * Best-effort Resend/Svix-style signature check.
 * Live webhook secret verification still needs Marcus to confirm the
 * production Resend signing format against a real event.
 */
export function verifyResendSignature(
  payload: string,
  signatureHeader: string | null,
  secret: string | undefined = process.env.RESEND_WEBHOOK_SECRET,
): boolean {
  if (!secret) return false;
  if (!signatureHeader) return false;
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  const provided = signatureHeader.replace(/^sha256=/, "").trim();
  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(provided, "hex");
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}
