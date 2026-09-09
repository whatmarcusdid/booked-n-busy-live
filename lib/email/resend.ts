import { BRAND_NAME, DEFAULT_FROM_EMAIL, SUPPORT_EMAIL } from "../identity";
import type { SendEmailInput, SendEmailResult, TransactionalEmailProvider } from "./provider";

export function createResendProvider(
  deps: {
    apiKey?: string;
    from?: string;
    fetchImpl?: typeof fetch;
    endpoint?: string;
  } = {},
): TransactionalEmailProvider {
  return {
    async send(input: SendEmailInput): Promise<SendEmailResult> {
      const apiKey = deps.apiKey ?? process.env.RESEND_API_KEY;
      // Falls back to the canonical sender so mail always comes from the
      // brand's own domain rather than failing or using a stale address.
      const from =
        deps.from ??
        process.env.RESEND_FROM_EMAIL ??
        `${BRAND_NAME} <${DEFAULT_FROM_EMAIL}>`;
      if (!apiKey) {
        return { ok: false, error: "Resend is not configured." };
      }

      const fetchImpl = deps.fetchImpl ?? fetch;
      const response = await fetchImpl(
        deps.endpoint ?? "https://api.resend.com/emails",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": input.idempotencyKey,
          },
          body: JSON.stringify({
            from,
            reply_to: SUPPORT_EMAIL,
            to: [input.to],
            subject: input.subject,
            text: input.text,
            html: input.html,
          }),
        },
      );

      if (!response.ok) {
        return { ok: false, error: `Resend rejected the send (${response.status}).` };
      }
      const body = (await response.json()) as { id?: string };
      if (!body.id) {
        return { ok: false, error: "Resend response missing id." };
      }
      return { ok: true, providerMessageId: body.id };
    },
  };
}
