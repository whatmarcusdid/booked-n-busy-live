# Overnight notes — Ring 1 (cursor/audit-submission-api-8eae)

## Morning summary

**All 8 phases completed with passing tests.** Final check: 37 suites / 255 tests, `tsc --noEmit` clean. Local migrations applied (never hosted).

| Phase | Status |
|---|---|
| 0 Zero-assessed pillar score | Done — was a real `0.00` bug; now `null` |
| 1 Public report tokens | Done — token-in-URL (cookie exchange deferred) |
| 2 Deterministic report assembly | Done |
| 3 AI narration | Done, flag off, **no live model call** |
| 4 Publication validator + publish | Done — reports land `review_required` |
| 5 Resend email adapter | Done, **not auto-wired**, **no live email** |
| 6 Admin API | Done — magic-link + allow-list |
| 7 Frontend plumbing | Done — unstyled data-flow pages |

### Live keys

- **ANTHROPIC_API_KEY:** not in `.env.local`. Narration is stubbed. Live verification still needed after setting the key and `AI_NARRATION_ENABLED=true`.
- **RESEND_API_KEY:** not in `.env.local`. Email provider is stubbed. Live verification still needed (`RESEND_FROM_EMAIL`, `RESEND_WEBHOOK_SECRET` too).
- **BROWSERLESS_API_KEY:** present; no new live Browserless calls were made.

### Decisions (more than one reasonable option)

1. **Report token hash = unkeyed SHA-256**, not HMAC. Status tokens stay HMAC. Followed the locked Phase 1 rule.
2. **Token stays in the URL** for `GET /api/v1/reports/{token}` and `/report/[reportToken]`. Cookie exchange is a follow-up (see below).
3. **In-process rate limit** (no existing public-route limiter). Fine for tests / single instance; not shared across Vercel isolates.
4. **Overall score** = average of *measured* pillar scores (null if none). Same honesty rule as Phase 0. `report_revisions.overall_score` is now nullable locally.
5. **Generated reports always `review_required`.** Previously complete → `approved` and partial → `draft`. Overnight prompt said stay in review until admin publish.
6. **Email destination:** `POST /email` requires the client to resupply `email` and we hash-match `leads.email_hash`. `create_audit_with_lead` still does not persist `leads.email`. Changing that RPC is a hosted migration Marcus should review.
7. **Admin auth = magic-link + `ADMIN_ALLOWED_EMAILS`**, not a shared secret. Session is an HMAC-signed HttpOnly cookie (`bnb_admin_session`).
8. **Email / admin copy** is factual placeholder, not marketing.

### Open questions for Marcus

1. Confirm **report-token cookie exchange** vs token-in-URL (recommended: do cookie exchange after Figma report page exists).
2. Confirm **customer email subject/body** (`REPORT_READY_SUBJECT` is a stopgap).
3. Persist **raw lead email** on create, or keep hash-match-on-request?
4. Confirm **Resend webhook signing** against a real event (current verifier is HMAC-SHA256 of the raw body; Resend/Svix may use a different header format).
5. Set **`ADMIN_ALLOWED_EMAILS`** before trying admin sign-in. Magic-link email will not send until Resend is configured.
6. **Scheduling provider** is still unset — `/schedule` is a route placeholder only.
7. Apply these **local-only migrations** to hosted when ready (do not apply from this session):
   - `20260908150000_nullable_pillar_score.sql`
   - `20260908151000_report_tokens.sql`
   - `20260908152000_nullable_overall_score.sql`
   - `20260908153000_email_deliveries.sql`
   - `20260908154000_admin_auth_reviews.sql`

### Recommended morning review order

1. Phase 0 + unsupported golden (`score: null`, not `0.00`).
2. Public report endpoint + “same 404 for every miss” tests.
3. `review_required` landing + `publishReportRevision` only from `POST /api/v1/admin/audits/{id}/publish`.
4. Hosted migration list above (you apply).
5. Env: `AI_NARRATION_ENABLED`, `ANTHROPIC_API_KEY`, `RESEND_*`, `ADMIN_ALLOWED_EMAILS`.
6. Unstyled pages + `TODO(figma)` comments for the live visual pass.
7. Live narration + live Resend once keys exist.

Frontend was **not** visually verified in a browser this session (no browser tools attached). Data flow is wired; polish is explicitly left for tomorrow.

---

## Phase 0 — Zero-assessed pillar scoring

**Finding:** this was a real bug, not summary shorthand.

`scoreAssessedChecks([])` returned `{ score: 0, assessedCount: 0 }`. `applyHomeRubric` then wrote `pillar_results.score = 0` for Lead Conversion and Growth Infrastructure on a failed home fetch (the unsupported-access golden). That stores “no evidence” as “failed everything.”

**Fix:**
- `scoreAssessedChecks` now returns `score: null` when `assessedCount === 0`.
- `pillar_results.score` is nullable (local migration only).
- Unsupported-access golden manifest updated: Lead/Growth scores are `null`, `criteria_count: 0`.

No product judgment required — the prompt stated the correct behavior.

Local migration applied: `20260908150000_nullable_pillar_score.sql`.

---

## Phase 1 — Report tokens + public report endpoint

Shipped the simpler token-in-URL version.

- Token: existing `generateSecureToken(32)` (crypto.randomBytes + base64url).
- Stored hash is **unkeyed SHA-256(token)**, not HMAC, per the locked decision. Status tokens stay HMAC.
- `GET /api/v1/reports/{reportToken}` returns the sanitized projection only when `publication_status === 'published'` and the token is unexpired (30 days from publication).
- Every other case (unknown, review_required, approved, revoked, expired, empty) returns `{ error: "Report not available" }` with HTTP 404 and no distinguishing code.
- Headers: `Cache-Control: private, no-store` and `Referrer-Policy: no-referrer`.
- Rate limit: new in-process limiter (30/min/IP). No prior public-route limiter existed. Multi-instance deploys do not share this map — upgrade later if we need a shared store.

**Cookie exchange skipped.** There is no existing tokenless report route or cookie-auth pattern besides Supabase session middleware. Adding HttpOnly cookie + redirect would touch routing and Phase 7 pages. Follow-up for Marcus: exchange URL token for a short-lived cookie and redirect to `/report`.

Local migration applied: `20260908151000_report_tokens.sql` (`public_report_token_hash` unique when present, `public_report_token_expires_at`). Token rows are written at publish time (Phase 4), not at report generation.

---

## Phase 2 — Deterministic report assembly

`assembleReport()` builds the public-ready structure from stored pillar_results, criterion_results, and Part-A recommendations.

- Zero-assessed pillar → `display: "not_measured"`, `score: null`.
- Zero recommendations → `noMajorIssues: true` and the existing good-shape summary (not an error).
- Overall score is the average of *measured* pillar scores, or null if none were measured.
- `generating_report` now writes this assembled object into `report_revisions.metadata.assembled` and uses its overall/summary instead of the old mock weighted average.

Local migration: `20260908152000_nullable_overall_score.sql` (same honesty rule as Phase 0).

---

## Phase 3 — AI narration

Implemented behind `AI_NARRATION_ENABLED` (default off). Uses `generateText` + `Output.object()` (Claude Haiku 4.5 via AI Gateway model id `anthropic/claude-haiku-4.5`), temperature 0.2, one validation-informed retry, then template fallback.

**ANTHROPIC_API_KEY is not in `.env.local`.** No live call was made. Live verification still needed.

Narrator input is structured findings only (keys, outcomes, scores, evidence IDs). Tests assert no raw HTML / internal notes.

---

## Phase 4 — Publication validator

`validateReportForPublication()` and `publishReportRevision()` did not exist yet; both are now implemented.

- Generated reports now land at `review_required` (complete used to write `approved`; partial used `draft`). Explicit overnight instruction: stay in review until admin publish.
- `publishReportRevision()` is the only writer of `published` + token hash + 30-day expiry. Not called from the workflow.
- Public GET still refuses anything that is not actually `published`, even when validation would pass.
- Golden manifests now include `publicationValidation`.

---

## Phase 5 — Resend email adapter

`TransactionalEmailProvider` + Resend `fetch` implementation. Idempotency key = `auditId:reportRevisionId:deliveryPurpose`. Statuses queued/sent/delivered/bounced/failed. Webhook events deduped by `event_id`.

**Not wired into audit completion.** Only `POST /api/v1/audits/{token}/email`.

**RESEND_API_KEY is not in `.env.local`.** No live email was sent.

`create_audit_with_lead` still stores only `email_hash`. The email route requires the caller to resupply the address and we hash-match it (same generic 404 on mismatch).

Local migration: `20260908153000_email_deliveries.sql`.

---

## Phase 6 — Admin API

Magic-link auth restricted by `ADMIN_ALLOWED_EMAILS`. Generic response whether the email is allowed or not. Callback sets `bnb_admin_session`.

Routes:
- `GET /api/v1/admin/audits`
- `GET /api/v1/admin/audits/{id}`
- `POST .../reviews` (immutable)
- `POST .../report-revisions`
- `POST .../publish` — **only HTTP caller of `publishReportRevision()`**
- `POST .../revoke`

Writes log `audit_events` and take `expectedRevisionNumber` for optimistic concurrency.

Local migration: `20260908154000_admin_auth_reviews.sql`.

---

## Phase 7 — Frontend plumbing

Unstyled routes, real fetches, `TODO(figma)` markers:
- `/` intake → `POST /api/v1/audits` → `statusUrl`
- `/audit/status/[token]` polls `GET /api/v1/audit-status/{token}`
- `/report/[reportToken]` loads `GET /api/v1/reports/{token}`
- `/schedule`, `/confirmation` placeholders
- `/admin` magic-link request form

Not visually verified in a browser.
