# M8 proposed dashboard panels — feasibility

Investigation only. No schema, code, or configuration was changed. `admin_reviews` row count is a live read-only `Prefer: count=exact` against the configured Supabase project (2026-09-13).

## Existing `/admin/dashboard` pattern

Source: `app/admin/dashboard/page.tsx` → `lib/admin/observability.ts` `loadObservabilityDashboard`.

- **Read-only.** The module states it performs no inserts, updates, or new tables (`lib/admin/observability.ts` 7–8). The page only `select`s.
- **Live queries** on each request (`export const dynamic = "force-dynamic"`). Date range is a query string (`today` / `7d` / `30d` / `all`), default `7d`.
- **Tables read today:**
  - `audits`: `id, current_state, created_at` (limit 5000)
  - `audit_state_transitions`: `audit_id, to_state, transitioned_at` (chunked by audit id)
  - `criterion_results`: used only to re-evaluate needs-review priority triggers, not as a cost or provider ledger
- **Not used:** `admin_reviews`, `audit_events`, `audit_cost_entries`, `retention_purge_runs`.
- Cost/kill-switch reporting and provider-error rates are explicitly **deferred** in that file (lines 2–5). The completion bucket `kill_switch_15m` is inferred from duration ≥ 15 minutes (`classifyCompletion`), not from `audits.kill_switch_reason`.

---

## Relevant schema (already migrated)

### `audits` (plus later columns)

Core row from `supabase/migrations/20260905160000_create_ring1_diagnostic_schema.sql`. Kill/cost columns from `20260908180000_audit_cost_and_kill_switch.sql`:

- `cost_usd NUMERIC(12,6)` — denormalized total at terminal
- `elapsed_ms BIGINT`
- `kill_switch_reason TEXT` — comment: `COST_CEILING_EXCEEDED` or `WALL_CLOCK_CEILING_EXCEEDED`
- `workflow_started_at TIMESTAMPTZ`
- Also: `landing_variant TEXT`, UTM fields, `current_state TEXT` (no enum in SQL)
- No `is_test` / `synthetic` / provider-error column

### `audit_state_transitions`

`from_state`, `to_state`, `transitioned_at`, `metadata JSONB`. Used for timing, not provider identity.

### `audit_events`

`event_type TEXT`, `event_data JSONB`, `created_at`. Indexed on `event_type`. Payload shape is per writer; there is no `provider` column.

Failure-related `event_type` values written by current code:

| event_type | Typical `event_data` | Writer |
| --- | --- | --- |
| `home_page_fetch_failed` | `reason_code`, `failure_type`, `http_status`, `provider_message` | `mock-stages.ts` `persistHomeFetchDiagnostic` |
| `home_page_fetch_retried` | first/retry diagnostics | same |
| `prohibited_content_blocked` | `reason_code` | URL-safety abort |
| `robots_txt_preflight` / `robots_txt_page_skipped` | robots reason | robots preflight |
| `workflow_start_failed` | `reason_code` / `failure_type` = `WORKFLOW_START_FAILED`, `error` | `fail-audit.ts` via `start.ts` |
| `workflow_stage_failed` | `reason_code` / `failure_type` = `WORKFLOW_STAGE_FAILED`, `error` | `fail-audit.ts` via `pipeline.ts` |
| `audit_kill_switch_triggered` | `reason_code`, `failure_type: "KILL_SWITCH"`, `cost_usd`, `elapsed_ms`, ceilings | `budget.ts` `recordKill` |
| `audit_terminated_by_kill_switch` | `reason_code`, `elapsed_ms` | same (analytics event name persisted as `event_type`) |

### `audit_cost_entries` (`20260908180000_audit_cost_and_kill_switch.sql`)

```
audit_id, operation_key, category, quantity, amount_usd, pricing_source, created_at
UNIQUE (audit_id, operation_key)
```

`category` values in code (`lib/audit-workflow/budget.ts` `COST_CATEGORIES`): `browserless_content`, `browserless_screenshot`, `browserless_performance`, `ai_narration`, `storage_upload`, `email_send`. **No calendar category.**

`pricing_source`: `'provider_metadata'` | `'configured_estimate'`.

No columns for token counts, HTTP status, duration, or error text.

### `admin_reviews` (`20260908154000_admin_auth_reviews.sql`)

```
id, audit_id, decision CHECK (approve|reject|needs_changes),
note, reviewer_email_hash, created_at
```

No later migration adds columns. Insert path (`lib/admin/service.ts` `insertReview`) writes those fields only. **No `started_at`, `completed_at`, or duration.**

### Other

- `email_deliveries`: `status` includes `failed` / `bounced`; not wired to the current dashboard.
- `retention_purge_runs`: purge job log; not an error or cost source for these panels.
- `criterion_results.findings`: security-health TLS codes (`https_tls_error`, `https_cert_invalid`, `https_cert_expired`) live here as **check outcomes**, not as provider-error events.

---

## Kill switches (every occurrence in product code)

Defined in `lib/audit-workflow/budget.ts`:

1. **Cost ceiling** — `$1.00` cumulative (`AUDIT_COST_CEILING_USD`). Reason `COST_CEILING_EXCEEDED`.
2. **Wall-clock ceiling** — 15 minutes from `workflow_started_at` (`AUDIT_WALL_CLOCK_CEILING_MS`). Reason `WALL_CLOCK_CEILING_EXCEEDED`.

**Triggers:** `verdict()` before every paid `charge` and at every pipeline stage boundary (`pipeline.ts`). Email send uses `costVerdict()` after the send (`lib/email/service.ts`); a trip still calls `recordKill`.

**Persistence (not Vercel-only):** `recordKill` writes:

1. `audit_events` row `audit_kill_switch_triggered`
2. `audits.kill_switch_reason`, `cost_usd`, `elapsed_ms`
3. second `audit_events` row `audit_terminated_by_kill_switch`
4. `audits.current_state` → `failed` via `recordTransition` in `killAt`

Idempotent in-process (`killRecorded`) plus unique transition index. Tests in `__tests__/lib/audit-workflow/kill-switches.test.ts` assert the event and telemetry columns.

No other named kill switch exists. `REAL_SCAN_ENABLED` / `AI_NARRATION_ENABLED` are process flags, not per-audit kills.

---

## Provider calls vs what is written

**Browserless** (`lib/browserless/*`, charged in `mock-stages.ts`): successful (and retried) paid ops become `audit_cost_entries` rows. Home **failures** become `home_page_fetch_failed` with Browserless-ish `reason_code` values (`FETCH_TIMEOUT`, `RESPONSE_TOO_LARGE`, `FETCH_FAILED`, `PROVIDER_ERROR`) **or** URL-safety codes (`SAFETY_REJECTED` / `BLOCKED_HOST` / …). Screenshot/performance capture failures do **not** write a dedicated `audit_events` type (audit is not failed; checks go `not_assessed`). Call **duration** is not stored.

**Anthropic / AI Gateway** (`lib/reports/narration.ts`, model `anthropic/claude-haiku-4.5`): token usage is read in-memory (`inputTokens` / `outputTokens`) and converted to USD via `aiNarrationCostUsd`, then stored as `audit_cost_entries.amount_usd` with `category = ai_narration` and `pricing_source = provider_metadata` when usage was reported. **Raw token counts are not columns.** If the model throws or fails validation, narration **falls through to template copy** (`catch` at `narration.ts` ~301–305) and **does not record an error event**.

**Email:** `email_deliveries.status`; cost as `email_send` ledger rows. Not a typed provider-error event.

**Google Calendar:** `lib/calendar/client.ts` returns `{ ok: false, reason }` in memory. Reconcile HTTP 500 path only `console.error`s (`calendar-reconcile/route.ts` 92–96). Success may write `meeting_reconciled` events. **Calendar API failures are not persisted.**

**TLS / URL safety:** TLS classification is `ProbeHttpsHop` → security-health **criterion findings**, not `audit_events`. URL-safety blocks that abort the scan use `failure_type: SAFETY_REJECTED` on home-fetch / prohibited-content / robots events.

---

## Panel 1 — Provider-error panel

**Tables that could supply a coarse panel:** `audit_events` (`event_type`, `event_data.reason_code`, `event_data.failure_type`, `created_at`) plus `audits.created_at` / `current_state` for range. Optionally `email_deliveries.status`. TLS rates would require parsing `criterion_results.findings` for security-health, which is a different grain than “provider call failed.”

**Granularity vs the requested split (Browserless vs Anthropic vs email vs Calendar vs TLS/URL safety):**

- **Browserless vs URL safety:** mixed in the same `home_page_fetch_failed` event; distinguishable only by interpreting `failure_type` / `reason_code`, not a `provider` field. Screenshot/performance Browserless errors are largely absent from events.
- **Anthropic:** error path is not written; only successful (or estimated) spend appears in the cost ledger.
- **Email:** `email_deliveries`, separate table, no join used by the dashboard today.
- **Calendar:** not in the database on failure.
- **TLS:** rubric findings, not provider-error events. URL-safety host/protocol blocks are `SAFETY_REJECTED` codes, not TLS handshake codes.

**Buildable as a read-only query today?** **No** — not as a panel that reliably attributes errors to those providers. A histogram of existing `audit_events.event_type` + `reason_code` could be read-only, but it would not meet the stated provider split.

**If it were to be built later (not done here):** new writes would need a provider enum on each failed call (Browserless content/screenshot/performance, Anthropic, email, Calendar, TLS probe), persisted either as `audit_events` with a stable `provider` key or a new table; Anthropic and Calendar failure paths would have to start writing; screenshot/performance failures would have to emit events.

---

## Panel 2 — Cost / kill-switch panel

**Persisted today:**

- Per-audit cost: `audits.cost_usd`, `audits.elapsed_ms`, `audits.kill_switch_reason`, `audits.workflow_started_at`
- Per-operation cost and a **count of billed operations**: `audit_cost_entries` (`category`, `operation_key`, `quantity`, `amount_usd`, `pricing_source`, `created_at`)
- Kill firings: `audit_events` where `event_type = 'audit_kill_switch_triggered'` (payload includes `reason_code`, `cost_usd`, `elapsed_ms`) **and** `audits.kill_switch_reason`

**Not persisted:** raw token counts; per-call wall time / latency; Calendar spend (never charged).

**Kill-switch firings:** persisted as above, not only logged to Vercel.

**Buildable as a read-only query today?** **Yes.** Same pattern as the current dashboard: `select` from `audits` + `audit_cost_entries` + `audit_events` (kill event type), no new tables. Token-usage charts would be incomplete (USD only, and only when `pricing_source = provider_metadata` for `ai_narration`).

**If token-level or latency charts were required (not done here):** add columns such as `input_tokens`, `output_tokens`, `duration_ms` on `audit_cost_entries` (or a sibling table) and write them at `charge()` / Browserless / gateway call sites. That would be a migration plus new writes. Not required for a cost-USD and kill-count panel.

---

## Panel 3 — Reviewer-time distribution panel

**Table:** `admin_reviews`.

**Timestamps:** only `created_at` (decision insert). There is no review-open / review-close pair, no `started_at`, and no update path (`review-history.ts` 10–12). Duration of a review cannot be computed. A distribution of **when decisions were recorded** (hour-of-day / day) could be read from `created_at` alone; that is not both ends of a review.

**Row count (live, this environment):** **24**.

**Buildable as a read-only query today?** **No** for time-spent / duration distribution. **Yes** only if the panel is redefined as “when reviews were submitted.”

**If duration were required later (not done here):** persist `started_at` when a reviewer opens the audit and `created_at` (already present) at decision, or a `duration_ms` column — a migration plus a new write on open. Do not infer duration from `audits.updated_at`.

---

## Test vs real audits

**No mechanism in schema or application code distinguishes synthetic/test audits from customer audits.** There is no flag, tag, enum, or reserved email domain.

Related but insufficient:

- `REAL_SCAN_ENABLED` / `AI_NARRATION_ENABLED` are **process environment** switches, not per-row.
- `audits.landing_variant` and UTM fields are free text; `scripts/test-audit-flow.ts` happens to set `utmSource: "test"` but nothing in the product filters on that.
- Golden fixtures and the in-memory store never mark production rows.
- `scripts/test-audit-flow.ts` inserts via `createAudit` like any other lead (`john@testbusiness.com`) with no `is_test` column.

---

## Summary

| Panel | Read-only today? | Single biggest blocker |
| --- | --- | --- |
| 1. Provider-error | **No** | Failures are not stored with a provider dimension; Anthropic and Calendar errors are not persisted as errors at all |
| 2. Cost / kill-switch | **Yes** | None for USD + kill counts (token/latency detail is missing but not required for that panel) |
| 3. Reviewer-time distribution | **No** | `admin_reviews` has only `created_at`, not both ends of a review (24 rows exist) |
