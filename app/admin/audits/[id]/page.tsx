import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, readAdminSession } from "@/lib/admin/auth";
import { createSupabaseAdminStore } from "@/lib/admin/service";
import { loadReviewEvidence, type EvidenceRow } from "@/lib/admin/evidence";
import { loadReviewHistory } from "@/lib/admin/review-history";
import {
  ageSince,
  criteriaFromRows,
  formatAge,
  outcomeOf,
  PRIORITY_REASON_LABELS,
} from "@/lib/admin/review-queue";
import {
  evaluateAutoPublicationEligibility,
  requiresPriorityReview,
} from "@/lib/reports/auto-publication";
import {
  fixFirstSeverityKey,
  isHighSeverityCheck,
} from "@/lib/audit-workflow/fix-first";
import { displayScore, scoreBand } from "@/lib/audit-workflow/rubric/bands";
import { ReviewActions } from "./review-actions";
import { BookingLinkage } from "./booking-linkage";
import "../../admin.css";

export const dynamic = "force-dynamic";

interface Revision {
  revision_number: number;
  publication_status: string | null;
  overall_score: number | string | null;
  score_band: string | null;
  scoring_band_version: string | null;
  executive_summary: string | null;
  created_at: string;
  published_at: string | null;
  metadata: Record<string, unknown> | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return (value ?? {}) as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export default async function AdminAuditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cookieStore = await cookies();
  const session = readAdminSession(
    cookieStore.get(ADMIN_SESSION_COOKIE)?.value,
  );
  if (!session) redirect("/admin");

  const detail = await createSupabaseAdminStore().getAudit(id);
  if (!detail) notFound();

  const audit = asRecord(detail.audit);
  const lead = detail.lead ? asRecord(detail.lead) : null;
  const pillars = asArray(detail.pillars);
  const criterionRows = asArray(detail.criteria);
  const revisions = asArray(detail.reports) as Revision[];
  const latest = revisions[0] ?? null;

  const criteria = criteriaFromRows(criterionRows);
  const eligibility = evaluateAutoPublicationEligibility({
    criteria,
    auditState: String(audit.current_state ?? ""),
  });
  const priority = requiresPriorityReview(eligibility);

  const [evidence, history, ageMs] = await Promise.all([
    loadReviewEvidence(id, asArray(detail.evidence) as EvidenceRow[]),
    loadReviewHistory(id),
    ageSince(audit.created_at == null ? null : String(audit.created_at)),
  ]);

  const compositeScore = numberOrNull(latest?.overall_score);
  const band = scoreBand(compositeScore);

  return (
    <main className="admin-console">
      <div className="admin-shell">
        <header className="admin-topbar">
          <div>
            <Link className="admin-link" href="/admin">
              ← Review queue
            </Link>
            <h1>{String(audit.business_name ?? "Audit")}</h1>
            <p className="admin-queue-sub">{String(audit.website_url ?? "")}</p>
          </div>
          <div className="admin-topbar-meta">
            <span className="admin-badges">
              {priority ? (
                <span className="admin-badge admin-badge-priority">
                  Priority review
                </span>
              ) : (
                <span className="admin-badge admin-badge-ok">Routine</span>
              )}
            </span>
            <span>{session.email}</span>
          </div>
        </header>

        {/* ---- triage verdict ---- */}
        <section className="admin-section" aria-label="Triage">
          <h2>Why this is here</h2>
          {priority ? (
            <ul>
              {eligibility.reasons
                .filter((reason) => PRIORITY_REASON_LABELS[reason])
                .map((reason) => (
                  <li key={reason}>{PRIORITY_REASON_LABELS[reason]}</li>
                ))}
            </ul>
          ) : (
            <p>
              No priority trigger fired. This is a routine sign-off, still
              required before the customer can see anything.
            </p>
          )}
          <div className="admin-kv">
            <div>
              <div className="admin-kv-label">Needs review</div>
              <div>
                {eligibility.metrics.needsReviewCount} of{" "}
                {eligibility.metrics.totalChecks}
              </div>
            </div>
            <div>
              <div className="admin-kv-label">Assessed</div>
              <div>
                {eligibility.metrics.assessedCount} of{" "}
                {eligibility.metrics.totalChecks}
              </div>
            </div>
            <div>
              <div className="admin-kv-label">High-severity unresolved</div>
              <div>
                {eligibility.metrics.highSeverityNeedsReviewKeys.length > 0
                  ? eligibility.metrics.highSeverityNeedsReviewKeys.join(", ")
                  : "none"}
              </div>
            </div>
            <div>
              <div className="admin-kv-label">Contradictions</div>
              <div>
                {eligibility.metrics.contradictions.length === 0
                  ? "none"
                  : eligibility.metrics.contradictions.join("; ")}
              </div>
            </div>
          </div>
        </section>

        {/* ---- summary ---- */}
        <section className="admin-section" aria-label="Audit summary">
          <h2>Summary</h2>
          <div className="admin-kv">
            <div>
              <div className="admin-kv-label">Score</div>
              <div>
                {compositeScore == null
                  ? "not scored"
                  : `${displayScore(compositeScore)} / 100`}
                {band ? ` · ${band.label}` : ""}
              </div>
            </div>
            <div>
              <div className="admin-kv-label">Audit state</div>
              <div>{String(audit.current_state ?? "—")}</div>
            </div>
            <div>
              <div className="admin-kv-label">Publication</div>
              <div>{latest?.publication_status ?? "no revision"}</div>
            </div>
            <div>
              <div className="admin-kv-label">Waiting</div>
              <div>{formatAge(ageMs)}</div>
            </div>
            <div>
              <div className="admin-kv-label">Cost</div>
              <div>
                {audit.cost_usd == null
                  ? "—"
                  : `$${Number(audit.cost_usd).toFixed(4)}`}
              </div>
            </div>
            <div>
              <div className="admin-kv-label">Duration</div>
              <div>
                {audit.elapsed_ms == null
                  ? "—"
                  : `${Math.round(Number(audit.elapsed_ms) / 1000)}s`}
              </div>
            </div>
            {audit.kill_switch_reason ? (
              <div>
                <div className="admin-kv-label">Killed by</div>
                <div>{String(audit.kill_switch_reason)}</div>
              </div>
            ) : null}
            {lead ? (
              <div>
                <div className="admin-kv-label">Lead</div>
                <div>
                  {String(lead.first_name ?? "—")} ·{" "}
                  {String(lead.trade_display ?? "—")} ·{" "}
                  {String(lead.service_area_display ?? "—")}
                </div>
              </div>
            ) : null}
          </div>
          {latest?.executive_summary ? (
            <p className="admin-snippet">{latest.executive_summary}</p>
          ) : null}
        </section>

        {/* ---- pillars ---- */}
        <section className="admin-section" aria-label="Pillar scores">
          <h2>Pillars</h2>
          {pillars.length === 0 ? (
            <p>No pillar scores recorded.</p>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Pillar</th>
                  <th scope="col">Score</th>
                  <th scope="col">Checks</th>
                </tr>
              </thead>
              <tbody>
                {pillars.map((raw) => {
                  const row = asRecord(raw);
                  const score = numberOrNull(row.score);
                  return (
                    <tr key={String(row.pillar_key)}>
                      <td>{String(row.pillar_name ?? row.pillar_key)}</td>
                      <td>
                        {score == null ? "—" : `${displayScore(score)} / 100`}
                      </td>
                      <td>{String(row.criteria_count ?? "—")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        {/* ---- check breakdown + per-check evidence ---- */}
        <section className="admin-section" aria-label="Check breakdown">
          <h2>Checks</h2>
          <p>
            Outcome as recorded by the rubric. Evidence is shown beside the
            check it supports, so a verdict can be judged against what was
            actually observed.
          </p>
          {criteria.length === 0 ? (
            <p>No checks recorded.</p>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Check</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">Score</th>
                  <th scope="col">Severity</th>
                  <th scope="col">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {criteria.map((row) => {
                  const outcome = outcomeOf(row);
                  const supporting = evidence.byCriterion[row.criterion_key] ?? [];
                  return (
                    <tr key={row.criterion_key}>
                      <td>
                        {row.criterion_name}
                        <div className="admin-queue-sub">
                          <code>{row.criterion_key}</code>
                        </div>
                      </td>
                      <td>
                        {outcome}
                        {outcome === "needs_review" &&
                        isHighSeverityCheck(row) ? (
                          <div className="admin-badges">
                            <span className="admin-badge admin-badge-priority">
                              high severity
                            </span>
                          </div>
                        ) : null}
                      </td>
                      <td>{row.score.toFixed(2)}</td>
                      <td>{fixFirstSeverityKey(row)}</td>
                      <td>
                        {supporting.length === 0 ? (
                          <span className="admin-queue-sub">none recorded</span>
                        ) : (
                          supporting.map((item) => (
                            <div key={item.id}>
                              {item.snippet ? (
                                <pre className="admin-snippet">
                                  {item.snippet}
                                </pre>
                              ) : null}
                              <div className="admin-queue-sub">
                                {item.locator ? `at ${item.locator} · ` : ""}
                                {item.collectionMethod ?? "unknown method"}
                                {item.confidence != null
                                  ? ` · confidence ${item.confidence}`
                                  : ""}
                                {item.reasonCode
                                  ? ` · ${item.reasonCode}`
                                  : ""}
                              </div>
                            </div>
                          ))
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        {/* ---- evidence viewer ---- */}
        <section className="admin-section" aria-label="Evidence">
          <h2>Evidence</h2>

          <h3>Screenshots</h3>
          {evidence.screenshots.length === 0 ? (
            <p>
              No screenshot artifacts recorded for this audit.
            </p>
          ) : (
            <div className="admin-shots">
              {evidence.screenshots.map((shot) => (
                <figure className="admin-shot" key={shot.artifactId}>
                  {shot.signedUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={shot.signedUrl}
                      alt={`${shot.viewport} screenshot`}
                    />
                  ) : null}
                  <figcaption className="admin-shot-caption">
                    {shot.viewport} · <code>{shot.storageKey}</code>
                    {shot.signedUrl ? "" : " · preview unavailable"}
                  </figcaption>
                </figure>
              ))}
            </div>
          )}

          <h3>Reason codes</h3>
          {evidence.reasonCodes.length === 0 ? (
            <p>No reason codes recorded.</p>
          ) : (
            <div className="admin-badges">
              {evidence.reasonCodes.map((code) => (
                <span className="admin-badge" key={code}>
                  {code}
                </span>
              ))}
            </div>
          )}

          {evidence.unattributed.length > 0 ? (
            <>
              <h3>Other evidence</h3>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th scope="col">Type</th>
                    <th scope="col">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {evidence.unattributed.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <code>{item.evidenceType}</code>
                      </td>
                      <td>
                        {item.snippet ?? "—"}
                        {item.url ? (
                          <div className="admin-queue-sub">{item.url}</div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
        </section>

        {/* ---- decision ---- */}
        <ReviewActions
          auditId={id}
          revisionNumber={latest?.revision_number ?? null}
          publicationStatus={latest?.publication_status ?? null}
        />

        <BookingLinkage
          auditId={id}
          currentState={String(audit.current_state ?? "")}
          sessions={asArray(detail.bookingSessions).map((row) => {
            const session = asRecord(row);
            return {
              id: String(session.id ?? ""),
              customerEmail:
                session.customer_email == null
                  ? null
                  : String(session.customer_email),
              createdAt: String(session.created_at ?? ""),
              expiresAt: String(session.expires_at ?? ""),
              consumedAt:
                session.consumed_at == null
                  ? null
                  : String(session.consumed_at),
            };
          })}
          meetings={asArray(detail.meetings).map((row) => {
            const meeting = asRecord(row);
            return {
              id: String(meeting.id ?? ""),
              bookingSessionId: String(meeting.booking_session_id ?? ""),
              status: String(meeting.status ?? ""),
              googleEventId:
                meeting.google_event_id == null
                  ? null
                  : String(meeting.google_event_id),
              scheduledStart: String(meeting.scheduled_start ?? ""),
              scheduledEnd: String(meeting.scheduled_end ?? ""),
              createdAt: String(meeting.created_at ?? ""),
            };
          })}
        />

        {/* ---- human decision history ---- */}
        <section className="admin-section" aria-label="Decision history">
          <h2>Decision history</h2>
          {history.length === 0 ? (
            <p>No human decision recorded yet.</p>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Decision</th>
                  <th scope="col">Reason</th>
                  <th scope="col">Reviewer</th>
                </tr>
              </thead>
              <tbody>
                {history.map((record) => (
                  <tr key={record.id}>
                    <td>{new Date(record.createdAt).toLocaleString()}</td>
                    <td>
                      {record.decision}
                      {record.isOverride ? (
                        <div className="admin-badges">
                          <span className="admin-badge admin-badge-priority">
                            override
                          </span>
                        </div>
                      ) : null}
                    </td>
                    <td>{record.note ?? "—"}</td>
                    <td className="admin-queue-sub">{record.reviewer}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* ---- revisions: proves the machine result survives an override ---- */}
        <section className="admin-section" aria-label="Revisions">
          <h2>Revisions</h2>
          <p>
            Revisions are append-only. Revision 1 is the machine-generated
            result and stays readable after any human decision.
          </p>
          {revisions.length === 0 ? (
            <p>No revisions recorded.</p>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Rev</th>
                  <th scope="col">Origin</th>
                  <th scope="col">Score</th>
                  <th scope="col">Status</th>
                  <th scope="col">Created</th>
                </tr>
              </thead>
              <tbody>
                {[...revisions]
                  .sort((a, b) => a.revision_number - b.revision_number)
                  .map((revision) => {
                    const score = numberOrNull(revision.overall_score);
                    const corrected =
                      asRecord(revision.metadata).corrected === true;
                    return (
                      <tr key={revision.revision_number}>
                        <td>{revision.revision_number}</td>
                        <td>
                          {corrected ? "human-corrected" : "machine-generated"}
                        </td>
                        <td>
                          {score == null ? "—" : `${displayScore(score)} / 100`}
                        </td>
                        <td>{revision.publication_status ?? "—"}</td>
                        <td>{new Date(revision.created_at).toLocaleString()}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </main>
  );
}
