import Link from "next/link";
import { getAuditStatus } from "@/lib/services/audit-status-service";
import { BRAND_NAME } from "@/lib/identity";
import type { AuditStatusResponse } from "@/lib/schemas/audit-status";
import { StatusPoller } from "./status-poller";
import "./audit-loading.css";

export const dynamic = "force-dynamic";

export default async function AuditStatusPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  /*
   * Resolved on the server so a refresh or a reconnect paints the correct
   * state immediately, from the audit's real current status. Rendering a
   * neutral "loading" shell first and letting the client decide would show
   * the Normal state for a moment to a customer whose audit is already in
   * Needs Review.
   */
  const resolved = await getAuditStatus(token);
  const initial = "status" in resolved ? (resolved as AuditStatusResponse) : null;

  return (
    <main className="audit-loading">
      <nav className="audit-loading-nav" aria-label="Primary">
        <Link className="audit-loading-logo" href="/">
          <span className="audit-loading-logo-mark">
            <img src="/audit/logo-mark.svg" alt="" width={51} height={51} />
          </span>
          <span className="audit-loading-wordmark">
            <img
              src="/audit/wordmark.svg"
              alt={BRAND_NAME}
              width={94}
              height={51}
            />
          </span>
        </Link>
        {/*
          Inert on purpose. As a link this navigated home without touching the
          audit — the scan kept running and the report was still emailed — so
          it advertised a capability that does not exist. Disabled rather than
          relabelled or removed, because the control is the right one once
          real cancellation lands; that needs a new terminal state plus cost
          and lead handling, which is its own piece of work.
        */}
        <button className="audit-loading-cancel" type="button" disabled>
          Cancel
        </button>
      </nav>
      <StatusPoller token={token} initial={initial} />
    </main>
  );
}
