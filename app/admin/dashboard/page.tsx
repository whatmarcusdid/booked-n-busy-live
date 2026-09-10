import Link from "next/link";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, readAdminSession } from "@/lib/admin/auth";
import {
  DASHBOARD_RANGE_LABELS,
  DASHBOARD_RANGES,
  formatDashboardPercent,
  loadObservabilityDashboard,
  parseDashboardRange,
} from "@/lib/admin/observability";
import { AdminSignIn } from "../admin-sign-in";
import "../admin.css";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; error?: string }>;
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

  const range = parseDashboardRange(params.range);
  const dashboard = await loadObservabilityDashboard(range);

  return (
    <main className="admin-console">
      <div className="admin-shell">
        <header className="admin-topbar">
          <h1>Observability</h1>
          <div className="admin-topbar-meta">
            <Link className="admin-link" href="/admin">
              Review queue
            </Link>
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

        <nav className="admin-range" aria-label="Date range">
          {DASHBOARD_RANGES.map((value) => (
            <Link
              key={value}
              href={`/admin/dashboard?range=${value}`}
              className={`admin-button${
                value === range
                  ? ""
                  : " admin-button-secondary"
              }`}
              aria-current={value === range ? "page" : undefined}
            >
              {DASHBOARD_RANGE_LABELS[value]}
            </Link>
          ))}
        </nav>

        <section className="admin-section" aria-label="State distribution">
          <h2>State distribution</h2>
          <p>
            Terminal outcomes among {dashboard.totalSubmitted} submitted
            audit{dashboard.totalSubmitted === 1 ? "" : "s"} in this range.
          </p>
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">State</th>
                <th scope="col">Count</th>
              </tr>
            </thead>
            <tbody>
              {dashboard.stateDistribution.map((row) => (
                <tr key={row.state}>
                  <td>{row.state}</td>
                  <td>{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="admin-section" aria-label="Completion times">
          <h2>Completion times</h2>
          <p>
            Submitted → first terminal state, from{" "}
            <code>audit_state_transitions</code>.{" "}
            {dashboard.completion.classified} classified.
          </p>
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Bucket</th>
                <th scope="col">Count</th>
                <th scope="col">Share</th>
              </tr>
            </thead>
            <tbody>
              {dashboard.completion.buckets.map((row) => (
                <tr key={row.bucket}>
                  <td>{row.label}</td>
                  <td>{row.count}</td>
                  <td>{formatDashboardPercent(row.percent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="admin-section" aria-label="Needs-review rate">
          <h2>Needs-review rate</h2>
          <div className="admin-health" aria-label="Needs-review rate">
            <div className="admin-stat admin-stat-flagged">
              <div className="admin-stat-label">Needs review</div>
              <div className="admin-stat-value">
                {formatDashboardPercent(dashboard.needsReview.rate)}
              </div>
              <div className="admin-stat-note">
                {dashboard.needsReview.count} of {dashboard.totalSubmitted}{" "}
                submitted
              </div>
            </div>
          </div>
          <h3>Priority-review triggers</h3>
          <p>
            Decision #12 conditions, counted per needs-review audit. An audit
            can match more than one.
          </p>
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Trigger</th>
                <th scope="col">Count</th>
              </tr>
            </thead>
            <tbody>
              {dashboard.needsReview.triggers.map((row) => (
                <tr key={row.reason}>
                  <td>{row.label}</td>
                  <td>{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
