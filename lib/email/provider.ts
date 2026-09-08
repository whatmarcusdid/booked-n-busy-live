export type EmailDeliveryStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "bounced"
  | "failed";

export type DeliveryPurpose = "report_ready";

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
}

export type SendEmailResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; error: string };

export interface TransactionalEmailProvider {
  send(input: SendEmailInput): Promise<SendEmailResult>;
}

export function deliveryIdempotencyKey(
  auditId: string,
  reportRevisionId: string,
  purpose: DeliveryPurpose,
): string {
  return `${auditId}:${reportRevisionId}:${purpose}`;
}
