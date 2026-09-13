# Accessibility audit — Ring 1

**Scope (static only):** the public intake form (`app/page.tsx` + `app/intake-form.tsx`) and the live audit results page (`app/audit/results/[token]/page.tsx` and every component it renders: `ResultsScreen`, `RequestManualReview`, `BookFindingsCall`, `FindingsCallBooked`, `FindingsCallWhen`, plus `app/layout.tsx`). Result states covered: Complete, Partial, Needs Review, Failed, Unsupported.

**Out of scope:** `/admin/*`, the in-progress loading screen, the pre-call prepare form, and any application-code change.

**Tokens:** this repo does not use Tailwind. Color claims use `lib/material/tokens.css`, `app/landing.css`, and `app/audit/results/[token]/audit-results.css`. Contrast is WCAG 2.2 relative luminance, `(L1 + 0.05) / (L2 + 0.05)`.

**No dialogs/modals** exist on either surface, so focus trap and Escape-to-close were not applicable.

---

## Findings

| ID | Surface | File:line | Issue | WCAG 2.2 AA | Severity | Smallest fix |
| --- | --- | --- | --- | --- | --- | --- |
| I-01 | Intake | `app/intake-form.tsx:50-55`, `app/intake-form.tsx:67-100` | Server-side validation errors are concatenated into one `role="alert"` and never attached to the field that failed. `MdOutlinedTextField` supports `error` / `errorText` and sets `aria-invalid` on the inner input only when `error` is true; this form never sets those. Messages such as “Invalid URL format” do not name the field. | 3.3.1 Error Identification; 1.3.1 Info and Relationships; 4.1.2 Name, Role, Value | High | On a 4xx with `fields[]`, set `error` and `errorText` on the matching `md-outlined-text-field` (Material already wires `aria-invalid` and supporting-text `role="alert"`). Keep the page-level alert only for non-field errors. |
| I-02 | Intake | `app/page.tsx:30-34` | Icon-only control has `aria-label="Open menu"` but no `onClick`, no menu, and no `aria-expanded` / `aria-controls`. Keyboard and screen-reader users get a named button that does nothing. | 4.1.2 Name, Role, Value | Medium | Remove the button until a menu exists, or implement the menu and set `aria-expanded`. |
| I-03 | Intake | `app/intake-form.tsx:11-12`, `app/intake-form.tsx:93-95` | While the request is in flight the submit control is `disabled` and its label becomes “Starting…”. Disabled buttons are typically omitted from the tab order and name changes on them are not a status message, so the in-progress state that sighted users see is easy to miss in AT. | 4.1.3 Status Messages | Medium | Keep the button focusable (or add `aria-busy="true"` on the form) and put “Starting…” in a `role="status"` live region. |
| I-04 | Intake | `lib/material/tokens.css:12` (`--md-sys-color-secondary: #737373`); `lib/material/tokens.css:7` (`--md-sys-color-primary: #34d399`); Material `md-focus-ring` color token is secondary | Keyboard focus ring on `md-filled-button` is `#737373` against the button fill `#34d399`. Ratio **2.47:1** (AA non-text minimum is 3:1). Outer edge vs page `#0c0a28` is 4.06:1. | 1.4.11 Non-text Contrast | Medium | Set `--md-focus-ring-color` on `.landing-form md-filled-button` to a color ≥ 3:1 against both `#34d399` and `#0c0a28` (for example `#0c0a28`, 10.02:1 vs `#34d399`). |
| I-05 | Intake | `lib/material/tokens.css:7`; `app/landing.css:224` (field fill `#ffffff`) | Focused outlined field uses the default Material focus outline color (primary `#34d399`) on the white field. `#34d399` vs `#ffffff` is **1.92:1**. Outer edge vs page `#0c0a28` is 10.02:1. | 1.4.11 Non-text Contrast | Medium | Override `--md-outlined-text-field-focus-outline-color` to a color ≥ 3:1 against `#ffffff` (for example `#2920a5`, 11.39:1). |
| R-01 | Results | `app/audit/results/[token]/request-manual-review.tsx:36-41` | On Failed, a successful “Send request” unmounts the only control and replaces it with a static `<p>` (no `role="status"` / `aria-live`). Keyboard focus can be lost; the confirmation is not announced as a status change. | 4.1.3 Status Messages; 2.4.3 Focus Order | High | Keep a focusable container, move focus to the confirmation, and give that copy `role="status"`. |
| R-02 | Results | `app/audit/results/[token]/results-screen.tsx:156-166`; `app/audit/results/[token]/results-screen.tsx:328` | `VideoThumb` alt is hardcoded to “Your website is working. Strong across all 3 pillars.” It is shown for Complete **and** Needs Review (`showVideo`). That sentence is not taken from `view` and can contradict the scorecard in Needs Review. | 1.1.1 Non-text Content | High | Drive alt from `view` (or use `alt=""` if the thumbnail is decorative next to the headline). Do not assert “strong across all 3 pillars” unless that is true for the current state. |
| R-03 | Results | `app/audit/results/[token]/results-screen.tsx:61-101`; `app/audit/results/[token]/results-screen.tsx:72-73`, `96-97` | Pass vs non-pass is a check icon vs an en-dash, both `aria-hidden`. Non-pass rows expose only the catalog name; `data-outcome` (`fail` / `partial` / `needs_review` / `not_assessed`) is not in the accessible name. Fail, partial, needs-review, and not-assessed are indistinguishable to AT (and visually, pending design). | 1.3.1 Info and Relationships; 1.4.1 Use of Color | High | Include the outcome in visible text (for example “Not assessed: License and insurance”) so icon/dash can stay decorative. |
| R-04 | Results | `app/audit/results/[token]/audit-results.css:231-233`; `app/audit/results/[token]/results-screen.tsx:47-56` | Unassessed grade character `–` is `#e5e5e5` on `#ffffff`. Ratio **1.26:1** (large-text AA is 3:1; this glyph is 64px/84px). Partial and Failed/Unsupported all use this treatment. Adjacent “Not assessed” title is `#0c0a28` (19.27:1) and does pass. | 1.4.3 Contrast (Minimum) | Medium | Color the unassessed glyph with `--ar-text-subtle` (`#737373` on `#ffffff` = 4.74:1) or `--ar-text-default` (`#0c0a28`). |
| R-05 | Results | `app/audit/results/[token]/results-screen.tsx:104-117`; `app/audit/results/[token]/results-screen.tsx:141-150` | “How you earned this grade” rows and recommended improvements are sequences of `<div>` / `<p>`, not lists. Desktop repeats the same `h2` “How you earned this grade” once per column, so three identical headings are in the outline. | 1.3.1 Info and Relationships; 2.4.6 Headings and Labels | Medium | Use `<ul>/<li>` for checks and recommendations. Make each how-earned heading include the pillar name (for example “How you earned this Trust Signals grade”). |
| R-06 | Results | `app/audit/results/[token]/results-screen.tsx:36-58` | Grade is a bare letter (or `–`) in a `<p>`. Color (`#16a34a` A 3.30:1, `#d97706` C 3.19:1, `#b42318` F 6.57:1 vs `#ffffff`) is supplementary and the letter is in the DOM, so 1.4.1 for A/C/F is met as large text. AT still hears only “A” / “C” / “F” / “–” with no “grade” programmatically tied to the pillar name except via adjacent headings / link concatenation. | 1.3.1 Info and Relationships | Medium | Add visually hidden or `aria-label` text “Grade A” (and “Not assessed” on the glyph when the title is not already in the same link). |
| R-07 | Results | `app/layout.tsx:9-15`; `app/audit/results/[token]/page.tsx` (no `generateMetadata`) | Document title is always `Booked N Busy Websites` for homepage and every results state. Tabs and AT window lists cannot tell Complete from Failed from intake. | 2.4.2 Page Titled | Medium | Export `generateMetadata` on the results route using `view.headline` or `view.auditState` plus `view.websiteHost`. |
| R-08 | Results | `app/findings-call-when.tsx:37-47` | Booked state renders an `<h2>` whose `<time>` is empty until client `Intl` hydration. Sighted and AT users get a heading with no name on the server HTML; the time then appears with no live region. | 2.4.6 Headings and Labels; 4.1.3 Status Messages | Medium | Render a non-empty heading (or `aria-busy` until `label` is ready) and announce the formatted time with `role="status"` when it arrives. |
| R-09 | Results | `app/findings-call-booked.tsx:31-35`; `app/findings-call-booked.css:66-69` | “Check the confirmation email…” is underlined `#2920a5` (`#2920a5` on `#ffffff` = 11.39:1, text contrast passes) and looks like a link but is a `<span>`. Not keyboard-activatable; AT does not expose a link. | 1.3.1 Info and Relationships | Medium | Keep it as plain text (drop underline / link color) or make it a real link if there is a destination. |
| R-10 | Results | `app/book-findings-call.tsx:57-91`, `app/book-findings-call.tsx:94-98`; `app/audit/results/[token]/request-manual-review.tsx:15-34`, `46-48` | Booking and manual-review pending states disable the button and change the label (“Starting…” / “Sending…”). Errors use `role="alert"` (good). The in-progress change is not a status message. | 4.1.3 Status Messages | Medium | Same pattern as I-03: `role="status"` (or `aria-busy` on a still-focusable control) while the request runs. |
| R-11 | Results | `lib/material/tokens.css:12`; `app/audit/results/[token]/audit-results.css:14`, `421-425` | Results `md-filled-button` fill is `--ar-action-primary` `#2920a5`; focus ring still uses secondary `#737373`. `#737373` vs `#2920a5` is **2.40:1**. Vs sheet/page `#ffffff` is 4.74:1. | 1.4.11 Non-text Contrast | Medium | Set `--md-focus-ring-color` on `.audit-results-sheet-cta md-filled-button` to a color ≥ 3:1 against `#2920a5` and `#ffffff` (for example `#ffffff` on the ring vs `#2920a5` is 11.39:1). |
| R-12 | Results | `app/audit/results/[token]/results-screen.tsx:278-285` | Failed-state website link uses `target="_blank"` with host text only. No programmatic indication that a new browsing context opens. | 3.2.2 On Input is N/A (this is a link); treated as 2.4.4 Link Purpose (In Context) | Low | Append visible/AT text “ (opens in a new tab)” or `aria-describedby` with that phrase. |
| R-13 | Results | `app/audit/results/[token]/results-screen.tsx:331-336`, `337` | Primary `nav` is nested inside `main`. Valid HTML, but the page has no `banner` and the only landmark pair is main-containing-nav. Low impact because headings exist. | 1.3.1 Info and Relationships | Low | Move `<nav>` to be a sibling of `<main>` (same markup, different wrapper). |

### Contrast pairs computed (for claims above)

| Foreground | Background | Ratio | Where |
| --- | --- | --- | --- |
| `#e5e5e5` | `#ffffff` | 1.26:1 | Unassessed grade glyph — **fail** 1.4.3 |
| `#34d399` | `#ffffff` | 1.92:1 | Intake field focus outline vs field fill — **fail** 1.4.11 |
| `#737373` | `#2920a5` | 2.40:1 | Results button focus ring vs fill — **fail** 1.4.11 |
| `#737373` | `#34d399` | 2.47:1 | Intake button focus ring vs fill — **fail** 1.4.11 |
| `#16a34a` | `#ffffff` | 3.30:1 | Grade A, 64px/84px weight 800 — **pass** large text 3:1 |
| `#d97706` | `#ffffff` | 3.19:1 | Grade C, same size — **pass** large text 3:1 |
| `#737373` | `#ffffff` | 4.74:1 | Results body/subtle and field labels — **pass** 4.5:1 |
| `#b42318` | `#ffffff` | 6.57:1 | Grade F and results `role="alert"` — **pass** |
| `#fca5a5` | `#0c0a28` | 10.15:1 | Intake `role="alert"` — **pass** |
| `#fafafa` | `#0c0a28` | 18.46:1 | Intake eyebrow, subhead, disclaimer — **pass** |
| `#ffffff` | `#0c0a28` | 19.27:1 | Intake `h1` — **pass** |
| `#0c0a28` | `#34d399` | 10.02:1 | Intake button label — **pass** |
| `#2920a5` | `#ffffff` | 11.39:1 | Results URL, links, change-hint text — **pass** |
| `#14532d` | `#dcfce7` | 8.30:1 | “You’re Booked” pill — **pass** |

Input **resting** outline `#d4d4d4` on field `#ffffff` is 1.48:1, but the white field on page `#0c0a28` is 19.27:1, so the control is identifiable by fill-vs-page (1.4.11 does not require the grey stroke).

---

## What this static pass could not determine

These need VoiceOver or NVDA (and a keyboard) on the running app:

- **Material Web shadow DOM after `useMaterialWeb()` upgrade:** whether each `md-outlined-text-field` inner `<input>` exposes the `label` via `aria-label`, `required`, and native `reportValidity()` before the fetch path; whether fields are in tab order before the custom elements upgrade.
- **Focus visibility on native controls:** `landing.css` and `audit-results.css` never set `:focus-visible` and never set `outline: none`. Sibling screens (loading, schedule expired) do define a 2px ring. UA outline on the logo, menu, result cards, Cancel/Close, and Go Back must be confirmed by eye (2.4.7).
- **One `h1` per viewport:** Complete / Partial / Needs Review render `HubHero` twice (hub + desktop). CSS `display: none` should leave a single `h1` in the accessibility tree at a given breakpoint; confirm AT honors that, including after rotate/resize.
- **2.4.11 Focus Not Obscured:** mobile results sheet is `position: fixed` (`audit-results.css` ~490–506) with `padding-bottom: 120px`. Confirm a focused pillar card or error alert is not hidden under the sheet.
- **Status announcements:** whether `role="alert"` on intake/results errors interrupts VO/NVDA as expected, and whether “Starting…” / “Sending…” on a `disabled` `md-filled-button` is announced (likely not).
- **Findings call time:** empty `<h2><time></time></h2>` on first paint, then a client-only label — confirm whether VO reads an empty heading and whether the later text is noticed.
- **No keyboard trap** was visible in source (no modal, no `tabindex > 0`, tab order follows DOM). Confirm in-browser that sheet, cards, and Material internals do not cycle incorrectly.
- **44px-tall outlined fields** (`app/landing.css:221-223`) may clip Material’s floating label and focus ring; that is visual, not provable from CSS alone.

---

## Automated scan with dependencies already installed

**Runtime axe / Playwright / jest-axe scan: not available without new plumbing.**

| Tool | Installed? | Can scan these pages today? |
| --- | --- | --- |
| `jest-axe`, `@axe-core/react`, `@axe-core/playwright`, `pa11y` | No | No — do not install for this audit |
| `@playwright/test` | No (optional peer of `next` only; not in `node_modules`) | No |
| `axe-core` 4.13.0 | Transitive only (`eslint-plugin-jsx-a11y` → `eslint-config-next`) | No page runner, no jsdom test env for these routes (`jest.config.js` uses `testEnvironment: "node"` and `*.test.ts` only) |
| `eslint-plugin-jsx-a11y` via `npm run lint` | Yes (through `eslint-config-next`) | **Static JSX only:** missing `alt`, click handlers on non-interactive nodes, some `aria-*` typos. Does **not** cover contrast, focus, live regions, heading order in CSS-hidden duplicates, or `@material/web` shadow DOM |

A runtime scan that would catch contrast, names inside shadow DOM, and landmark/heading issues would need a browser runner and an axe integration that are not project dependencies. Per the audit rules, that was not set up.

`@testing-library/react` and `dom-accessibility-api` are present but unused for these two surfaces; they do not constitute an axe scan.
