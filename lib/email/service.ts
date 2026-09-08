import { hashEmail } from "../crypto";
import { hmacSha256 } from "../crypto";
import { createAdminClient } from "../supabase/admin";
import {
  deliveryIdempotencyKey,
  type DeliveryPurpose,
  type EmailDeliveryStatus,
  type TransactionalEmailProvider,
} from "./provider";

export interface EmailDeliveryRow {
  id: string;
  audit_id: string;
  report_revision_id: string;
  delivery_purpose: DeliveryPurpose;
  idempotency_key: string;
  status: EmailDeliveryStatus;
  provider_message_id: string | null;
  to_email_hash: string;
}

export interface EmailDeliveryStore {
  findAuditByStatusTokenHash(tokenHash: string): Promise<{
    auditId: string;
    leadEmailHash: string;
    consentReportDelivery: boolean;
    reportRevisionId: string | null;
    publicationStatus: string | null;
  } | null>;
  findByIdempotencyKey(key: string): Promise<EmailDeliveryRow | null>;
  insertQueued(row: Omit<EmailDeliveryRow, "id" | "status" | "provider_message_id">): Promise<EmailDeliveryRow>;
  markStatus(
    id: string,
    status: EmailDeliveryStatus,
    providerMessageId?: string | null,
  ): Promise<void>;
  findByProviderMessageId(providerMessageId: string): Promise<EmailDeliveryRow | null>;
  recordWebhookEvent(eventId: string, deliveryId: string, type: string): Promise<"inserted" | "duplicate">;
}

export function createMemoryEmailStore(
  seed: {
    tokenHash: string;
    auditId: string;
    leadEmailHash: string;
    consentReportDelivery: boolean;
    reportRevisionId: string | null;
    publicationStatus: string | null;
  }[],
): EmailDeliveryStore & { deliveries: EmailDeliveryRow[]; events: string[] } {
  const deliveries: EmailDeliveryRow[] = [];
  const events: string[] = [];
  return {
    deliveries,
    events,
    async findAuditByStatusTokenHash(tokenHash) {
      return seed.find((row) => row.tokenHash === tokenHash) ?? null;
    },
    async findByIdempotencyKey(key) {
      return deliveries.find((row) => row.idempotency_key === key) ?? null;
    },
    async insertQueued(row) {
      const created: EmailDeliveryRow = {
        ...row,
        id: `del-${deliveries.length + 1}`,
        status: "queued",
        provider_message_id: null,
      };
      deliveries.push(created);
      return created;
    },
    async markStatus(id, status, providerMessageId) {
      const row = deliveries.find((item) => item.id === id);
      if (!row) return;
      row.status = status;
      if (providerMessageId !== undefined) {
        row.provider_message_id = providerMessageId;
      }
    },
    async findByProviderMessageId(providerMessageId) {
      return (
        deliveries.find((row) => row.provider_message_id === providerMessageId) ??
        null
      );
    },
    async recordWebhookEvent(eventId, _deliveryId, _type) {
      if (events.includes(eventId)) return "duplicate";
      events.push(eventId);
      return "inserted";
    },
  };
}

export function createSupabaseEmailStore(): EmailDeliveryStore {
  return {
    async findAuditByStatusTokenHash(tokenHash) {
      const supabase = createAdminClient();
      const { data: audit } = await supabase
        .from("audits")
        .select("id, lead_id, consent_report_delivery")
        .eq("public_status_token_hash", tokenHash)
        .maybeSingle();
      if (!audit) return null;
      const { data: lead } = await supabase
        .from("leads")
        .select("email_hash")
        .eq("id", audit.lead_id)
        .maybeSingle();
      const { data: report } = await supabase
        .from("report_revisions")
        .select("id, publication_status")
        .eq("audit_id", audit.id)
        .order("revision_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      return {
        auditId: audit.id,
        leadEmailHash: lead?.email_hash ?? "",
        consentReportDelivery: audit.consent_report_delivery === true,
        reportRevisionId: report?.id ?? null,
        publicationStatus: report?.publication_status ?? null,
      };
    },
    async findByIdempotencyKey(key) {
      const supabase = createAdminClient();
      const { data } = await supabase
        .from("email_deliveries")
        .select("*")
        .eq("idempotency_key", key)
        .maybeSingle();
      return (data as EmailDeliveryRow | null) ?? null;
    },
    async insertQueued(row) {
      const supabase = createAdminClient();
      const { data, error } = await supabase
        .from("email_deliveries")
        .insert({
          ...row,
          status: "queued",
        })
        .select("*")
        .single();
      if (error || !data) {
        throw new Error(`Failed to queue email: ${error?.message}`);
      }
      return data as EmailDeliveryRow;
    },
    async markStatus(id, status, providerMessageId) {
      const supabase = createAdminClient();
      const { error } = await supabase
        .from("email_deliveries")
        .update({
          status,
          provider_message_id: providerMessageId ?? undefined,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) {
        throw new Error(`Failed to update email delivery: ${error.message}`);
      }
    },
    async findByProviderMessageId(providerMessageId) {
      const supabase = createAdminClient();
      const { data } = await supabase
        .from("email_deliveries")
        .select("*")
        .eq("provider_message_id", providerMessageId)
        .maybeSingle();
      return (data as EmailDeliveryRow | null) ?? null;
    },
    async recordWebhookEvent(eventId, deliveryId, type) {
      const supabase = createAdminClient();
      const { error } = await supabase.from("email_webhook_events").insert({
        event_id: eventId,
        delivery_id: deliveryId,
        event_type: type,
      });
      if (error?.code === "23505") return "duplicate";
      if (error) {
        throw new Error(`Failed to record webhook event: ${error.message}`);
      }
      return "inserted";
    },
  };
}

export const EMAIL_NOT_AVAILABLE = { error: "Email request not available" };

/**
 * Placeholder copy — final customer email tone is a Marcus review item.
 * Subject is factual, not marketing.
 */
export const REPORT_READY_SUBJECT = "Your website diagnostic report is ready";

export async function requestReportEmail(input: {
  statusToken: string;
  email: string;
  purpose?: DeliveryPurpose;
  provider: TransactionalEmailProvider;
  store?: EmailDeliveryStore;
  reportUrl?: string;
}): Promise<
  | { ok: true; deliveryId: string; status: EmailDeliveryStatus; duplicate: boolean }
  | { ok: false; error: string; status?: number }
> {
  const store = input.store ?? createSupabaseEmailStore();
  const audit = await store.findAuditByStatusTokenHash(hmacSha256(input.statusToken));
  if (!audit || !audit.reportRevisionId) {
    return { ok: false, error: EMAIL_NOT_AVAILABLE.error, status: 404 };
  }
  if (hashEmail(input.email) !== audit.leadEmailHash) {
    return { ok: false, error: EMAIL_NOT_AVAILABLE.error, status: 404 };
  }
  if (!audit.consentReportDelivery) {
    return { ok: false, error: EMAIL_NOT_AVAILABLE.error, status: 404 };
  }

  const purpose = input.purpose ?? "report_ready";
  const idempotencyKey = deliveryIdempotencyKey(
    audit.auditId,
    audit.reportRevisionId,
    purpose,
  );
  const existing = await store.findByIdempotencyKey(idempotencyKey);
  if (existing) {
    return {
      ok: true,
      deliveryId: existing.id,
      status: existing.status,
      duplicate: true,
    };
  }

  const queued = await store.insertQueued({
    audit_id: audit.auditId,
    report_revision_id: audit.reportRevisionId,
    delivery_purpose: purpose,
    idempotency_key: idempotencyKey,
    to_email_hash: hashEmail(input.email),
  });

  const sent = await input.provider.send({
    to: input.email,
    subject: REPORT_READY_SUBJECT,
    text: `Your diagnostic report is ready.${input.reportUrl ? ` ${input.reportUrl}` : ""}`,
    html: `<p>Your diagnostic report is ready.</p>${
      input.reportUrl ? `<p><a href="${input.reportUrl}">Open report</a></p>` : ""
    }`,
    idempotencyKey,
  });

  if (!sent.ok) {
    await store.markStatus(queued.id, "failed");
    return { ok: true, deliveryId: queued.id, status: "failed", duplicate: false };
  }

  await store.markStatus(queued.id, "sent", sent.providerMessageId);
  return { ok: true, deliveryId: queued.id, status: "sent", duplicate: false };
}

export async function applyEmailWebhookEvent(input: {
  eventId: string;
  providerMessageId: string;
  type: "sent" | "delivered" | "bounced" | "failed";
  store?: EmailDeliveryStore;
}): Promise<"applied" | "duplicate" | "ignored"> {
  const store = input.store ?? createSupabaseEmailStore();
  const delivery = await store.findByProviderMessageId(input.providerMessageId);
  if (!delivery) return "ignored";
  const recorded = await store.recordWebhookEvent(
    input.eventId,
    delivery.id,
    input.type,
  );
  if (recorded === "duplicate") return "duplicate";
  await store.markStatus(delivery.id, input.type, input.providerMessageId);
  return "applied";
}
