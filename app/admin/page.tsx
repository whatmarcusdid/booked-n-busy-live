import Link from "next/link";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, readAdminSession } from "@/lib/admin/auth";
import { createSupabaseAdminStore } from "@/lib/admin/service";
import {
  formatAge,
  loadReviewQueue,
  PRIORITY_REASON_LABELS,
} from "@/lib/admin/review-queue";
import { AdminSignIn } from "./admin-sign-in";
import "./admin.css";

export const dynamic = "force-dynamic";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const cookieStore = await cookies();
  const session = readAdminSession(
    cookieStore.get(ADMIN_SESSION_COOKIE)?.value,
  );

  if (!session) {
    return (
      <main>
        <section className="card">
          <h1>Admin</h1>
          {params.error === "invalid_or_expired" ? (
            <p>This sign-in link is invalid or expired. Request a new one.</p>
          ) : null}
          <AdminSignIn />
        </section>
      </main>
    );
  }

  const [queue, recent] = await Promise.all([
    loadReviewQueue(),
    createSupabaseAdminStore().listAudits({ limit: 20, offset: 0 }),
  ]);

  return (
    <main className="admin-console">
      <div className="admin-shell">
        <header className="admin-topbar">
          <h1>Review queue</h1>
          <div className="admin-topbar-meta">
            <span>{session.email}</span>
            <form action="/api/v1/admin/auth/signout" method="POST">
              <button
                type="submit"
                className="admin-button admin-button-secondary"
              >
                Sign out
              </button>
            </form>
          </div>
        </header>

        <section className="admin-health" aria-label="Queue health">
          <div className="admin-stat">
            <div className="admin-stat-label">Pending review</div>
            <div className="admin-stat-value">{queue.health.pendingCount}</div>
            <div className="admin-stat-note">
              awaiting a human decision
            </div>
          </div>
          <div className="admin-stat admin-stat-flagged">
            <div className="admin-stat-label">Priority flagged</div>
            <div className="admin-stat-value">{queue.health.flaggedCount}</div>
            <div className="admin-stat-note">
              per decision #12 triage rules
            </div>
          </div>
          <div className="admin-stat">
            <div className="admin-stat-label">Oldest pending</div>
            <div className="admin-stat-value">
              {formatAge(queue.health.oldestPendingAgeMs)}
            </div>
            <div className="admin-stat-note">
              {queue.health.oldestPendingBusinessName ?? "nothing waiting"}
            </div>
          </div>
        </section>

        <section aria-label="Audits pending review">
          {queue.items.length === 0 ? (
            <p className="admin-empty">
              Nothing pending review. Reports reach customers only after a
              decision here, so an empty queue means no one is waiting.
            </p>
          ) : (
            <ul className="admin-queue">
              {queue.items.map((item) => (
                <li key={item.id}>
                  <Link
                    href={`/admin/audits/${item.id}`}
                    className={`admin-queue-row${
                      item.priority ? " admin-queue-row-priority" : ""
                    }`}
                  >
                    <span className="admin-queue-main">
                      <span className="admin-queue-name">
                        {item.businessName}
                      </span>
                      <span className="admin-queue-sub">
                        {" "}
                        · {item.websiteUrl}
                      </span>
                      <div className="admin-queue-sub">
                        waiting {formatAge(item.ageMs)} · {item.currentState}
                        {item.revisionNumber != null
                          ? ` · rev ${item.revisionNumber}`
                          : ""}
                        {item.priorityReasons.length > 0
                          ? ` · ${item.priorityReasons
                              .map((reason) => PRIORITY_REASON_LABELS[reason])
                              .join("; ")}`
                          : ""}
                      </div>
                    </span>
                    <span className="admin-badges">
                      {item.priority ? (
                        <span className="admin-badge admin-badge-priority">
                          Priority
                        </span>
                      ) : (
                        <span className="admin-badge">Routine</span>
                      )}
                      {item.needsReviewCount > 0 ? (
                        <span className="admin-badge">
                          {item.needsReviewCount} needs review
                        </span>
                      ) : null}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="admin-section" aria-label="Recent audits">
          <h2>Recent audits</h2>
          <p>
            Everything recorded, newest first. Audits already published or
            still running are inspectable here but need no decision.
          </p>
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Business</th>
                <th scope="col">State</th>
                <th scope="col">Publication</th>
                <th scope="col">Cost</th>
                <th scope="col">Duration</th>
              </tr>
            </thead>
            <tbody>
              {recent.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <Link className="admin-link" href={`/admin/audits/${item.id}`}>
                      {item.businessName}
                    </Link>
                  </td>
                  <td>{item.currentState}</td>
                  <td>
                    {item.publicationStatus ?? "—"}
                    {item.killSwitchReason
                      ? ` · killed: ${item.killSwitchReason}`
                      : ""}
                  </td>
                  <td>
                    {item.costUsd == null ? "—" : `$${item.costUsd.toFixed(4)}`}
                  </td>
                  <td>
                    {item.elapsedMs == null
                      ? "—"
                      : `${Math.round(item.elapsedMs / 1000)}s`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
