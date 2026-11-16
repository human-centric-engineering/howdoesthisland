# The report

What `/assessments/[id]` shows: a finished review read top to bottom, as
app-plan §8.5 orders it. Built in t-29 (f-report). The PDF (t-31, below) and
share links (x2) render the same component.

## Where the data comes from

The page reads two API answers and nothing else (`lib/app/reports/load.ts`):

1. `GET /api/v1/assessments/{id}`: the assessment, with `text` (the copy, since
   notes are character offsets into it), `result` and `judgeRuns`.
2. `GET /api/v1/frameworks/{slug}/versions/{version}`: the model version it ran
   on, which names every id the result holds (dimensions, moves, duties, the type
   of copy, the audience).

Both go through `requireServerData`. A 404, including another workspace's id,
renders the not-found page. Any other failure goes to the route's error boundary.
While both reads are in flight the route's `loading.tsx` shows a skeleton. A
stale session cookie is cleared and the reader is sent back to this report after
signing in, not to `/home`, because the report is the link people are sent.

**One loader, two sources.** `loadReport(id, source)` takes where the two
answers come from. The web page passes `apiReportSource`, the API above, as the
signed-in reader. The PDF's print page has no session, so it passes
`printReportSource` (`lib/app/reports/pdf/print-source.ts`), which calls the
services those two routes answer from and round-trips each answer through JSON.
Parsing and building are the same for both, so the PDF cannot drift from the
page.

**Nothing is cast.** `result` and `context` are `unknown` in the API contract,
because each framework has its own shapes. `lib/app/reports/input.ts` parses
HowDoesThisLand's result and model document with Zod. A result that does not
parse is shown as "This report can't be shown" and logged, never as a page with
gaps.

## What decides a section

`lib/app/reports/view.ts` (`buildReportView`) is pure and holds every rule, so
the rules are tested there (`tests/unit/lib/app/reports/view.test.ts`) and not
in the components:

- **A section a result lacks is left out**, not shown empty. A quick scan or a
  single AI reviewer has no editor's verdict. With the culture switch off there
  is no culture section. With nothing to score there are no influence
  perspectives, and with no notes there is no marked-up copy.
- **Context used** and the version's **calibration status** (§8.5 items 9 and 10) have no data until f-projects and f-calibration ship, so they are not
  sections yet. There is no stub.
- **Recommendations** are shown high impact first. They keep their place in
  the result as their number, because the editor names them that way (`rec_2`
  is recommendation 2).
- **Notes are placed by the engine's offsets, not by the judge's quote.** The
  engine marks the words it found, which can be fewer than a quote that runs
  on. A note whose offsets do not fit the copy is listed with its quote, not
  marked.
- **Integrity caps** are shown when a capping dimension is at or below its
  line (`scoring.integrity_caps`), the same test the engine applies.

## Charts

`components/app/report/charts/` (t-30) draws five charts: appeal scores and
balance against the target mix (How it lands), the duty profile, perspective
scores and the culture scales. Each is a captioned figure of rows, each row a
name, an SVG mark and the figure.

- **The values are visible text.** The SVG is `aria-hidden`, so a screen reader
  reads the same row a sighted reader does, and print or forced-colors keeps the
  values where a fill can fail. There is no separate data table.
- **Balance and duties are a bar per part with the target as an upright line**,
  not two stacked wholes, so each gap is read on its own row. An appeal's share
  is its score's share of the four, which is what the balance index compares.
  `buildReportView` rounds the appeal mix, shares and targets, to add to
  exactly 100 (`lib/app/reports/shares.ts`). The duty profile and its target are
  printed as the engine rounded them, one duty at a time, so they can add to 99
  or 101. The bars are on the whole 0–100% scale, never stretched to the
  largest part.
- **Colours are the brand's appeal tokens**, which switch for dark and print.
  The dataviz palette validator flags them (Logos's chroma in light, all four
  too light in dark). That is accepted because every mark is named beside it,
  so colour never carries identity alone.
- Rows use a container query, so a chart in half a section keeps a usable bar.
  Narrow, the bar drops under the name.
- No hover tooltips: every value is already printed on the row.

## Three variants

`<Report variant>`: `web` is the signed-in page. `print` is what the PDF is made
from. `shared` is what a link opens. The last two go to people outside the
workspace, so they leave out the run's cost. Nothing on the report names the
workspace or its people yet. A later section that does must leave them out of
`shared`, and out of what a link serves (below), which is where it would leak
first.

The report reads its assessment through `reportAssessmentSchema`
(`lib/app/reports/input.ts`): what a link serves, plus the cost and failure
reason a member sees. So one parser takes both the API's full answer and a
link's, and a link's builds a report whose `method.costUsd` is `null`.

## Print

`app/brand-theme.css` (fork-owned) has a `@media print` block. It prints ink on
white whatever the screen mode, hides the platform header and footer, and drops
the sheet's shadow and crop marks. Sections avoid breaking inside a
recommendation, a red flag or a limitation. The header and footer rule reaches
into the platform layout's markup: if upstream changes it, the frame prints again
and nothing else breaks.

Two things t-34 learned from the first real PDF:

- **Print must reset `color-scheme`, not just the colour tokens.** The page
  canvas, margins included, is painted from the root's `color-scheme`. With the
  screen in dark mode it stayed `dark`, so the white sheet printed on a black
  page.
- **A section's number and title are one block** (`break-inside: avoid`,
  `break-after: avoid`). As two blocks, Chrome broke between them and left
  "§ 05" alone at the foot of a page. A label above a chart needs the same
  `break-after: avoid`.

## The PDF

`GET /api/v1/assessments/{id}/report.pdf` (t-31, f-sharing) is the `print`
variant printed by headless Chromium, so it is the page's layout and print
stylesheet rather than a second design. It needs a session or an API key with
the `reports` scope, and answers 409 `REPORT_NOT_READY` for a review that has
no report (still running, failed or cancelled).

1. **The route** (`lib/app/reports/pdf/service.ts`) looks for a cached file,
   and otherwise mints a render token and has `renderReportPdf`
   (`lib/app/reports/pdf/render.ts`) open `/print/assessments/{id}` in a
   browser it launches.
2. **The token** (`render-token.ts`) is HMAC-signed like the approval and
   storage tokens, with its own `typ` (`report-render`), so none of the three
   accepts another's. It names the assessment and the org, and lives 60
   seconds. It goes in a request header (`x-report-render-token`), only on the
   document request, and never leaves the server. Every request to another
   origin is aborted, so the token cannot leak and analytics do not fire.
3. **The print page** (`app/(print)/print/assessments/[id]/page.tsx`) enters
   the assessment's org from the row (`runAsReportOrg`, `report-org.ts`): the
   one read under `runAsCredentialLookup`, the org through
   `resolveCredentialOrg`, then `runAsOrg`. The source is `'approval-token'`,
   whose documented meaning ("an HMAC token over a row id, the org the row's")
   fits exactly, and which nothing downstream reads as meaning an approval. A
   token for another assessment or org, or a suspended workspace, is not found.
   The page sets `data-pdf-ready` only when the report rendered, and the
   renderer refuses to print without it.
4. **The cache** (`cache.ts`) keeps the file in the workspace's private storage
   at `orgs/{orgId}/reports/{assessmentId}/{completedAt ms}-v{RENDER_VERSION}.pdf`. A final
   review never changes, so a file is reused until the review goes, or until
   `RENDER_VERSION` is bumped. **Bump it with any change to how the report
   looks** (`components/app/report/`, the print block of `app/brand-theme.css`,
   the renderer), or the PDFs already made keep the old design. Without storage
   that keeps private files and reads them back, every request renders.

**A PDF must not outlive its review.** Deleting a review and the retention
purge delete its folder before the row. Where storage cannot cache PDFs at all
(none configured, or Vercel Blob), neither touches storage, and the purge stays
one `deleteMany`. Otherwise the purge works in batches of 500, and ends a pass
whose whole batch storage refused. If storage refuses, the row stays and
the next attempt finishes it. Both sweep the folder again after the row,
because a render that wrote between the two deletes would otherwise leave a
file. A render also checks its review still exists after writing, and removes
its file if not. Org erasure deletes the whole `orgs/{orgId}/` tree.

**Cost, time and failure.** Each render is a whole browser. At most two run
per process, eight more may wait, and beyond that the route answers 503
`PDF_RENDER_BUSY`. A freed slot goes straight to the longest waiter, so the
cap holds even when a request arrives at that moment (`createRenderSlots`). Each
render has one 30-second deadline from launch to last byte, after which its
browser is closed (500 `PDF_RENDER_FAILED`). The render token is minted when the
render gets its slot, so time in the queue cannot expire it. A caller may start
10 renders a minute (`limiter.ts`); a cache hit counts towards nothing. A
review whose stored result cannot be read is 422 `REPORT_UNREADABLE`, since
rendering again will not change it, and one deleted while it renders is 404.

**Where the browser goes** (`renderOrigin`). `INTERNAL_API_URL` when it is
set, as for every self-call; otherwise loopback on the server's own `PORT`
(127.0.0.1); otherwise `getBaseUrl()`. Loopback keeps the token on the machine
rather than sending it out through a CDN, and a CDN's redirect to a canonical
host cannot break renders. Chrome exempts loopback from the production CSP's
`upgrade-insecure-requests`, so the page's assets load (checked for t-31). An
`INTERNAL_API_URL` on plain `http` to a host that is not loopback would not be
exempt: its assets would be upgraded to `https`, fall outside the origin the
renderer allows, and the PDF would print unstyled. Use loopback or `https`
there.

**Where it runs.** The Docker image installs Alpine's `chromium` (ledger row 15) and sets `PDF_CHROMIUM_PATH`: the image grows from 126.5 MB to 460.5 MB
(Chromium is 318 MB), and a report renders in about 0.9 s from a cold browser
(measured in CI for t-31). In development the Mac's Google Chrome is used. The
browser runs without its sandbox, which needs privileges the image does not
have. That is acceptable only because it loads nothing but this app's own
print page.

## Share links

A link opens one report, read-only, for someone with no account, until it
expires or is revoked (t-32, f-sharing). The report's **Share** button opens
a dialog that makes a link (7, 30 or 90 days; the API takes 1 to 365, default
30), shows its address once to copy, and lists the report's links with their
state and views, each live one with **Revoke**.

| Route                                  | Who                       | What                                               |
| -------------------------------------- | ------------------------- | -------------------------------------------------- |
| `POST /api/v1/assessments/{id}/shares` | member; API key `reports` | Make a link. 409 `REPORT_NOT_READY` with no report |
| `GET /api/v1/assessments/{id}/shares`  | member; API key `reports` | The report's links, newest first                   |
| `DELETE /api/v1/shares/{id}`           | member; API key `reports` | Revoke (repeating keeps the first time)            |
| `GET /api/v1/shared-reports/{token}`   | anyone with the token     | The shared report and its model                    |
| `/r/{token}`                           | anyone with the token     | The `shared` variant                               |

- **The token** (`lib/app/reports/share/token.ts`) is 32 random bytes,
  base64url. Only its SHA-256 is kept (`ReportShare.tokenHash`, unique), so the
  address is shown once, and no export, backup or log line can open a report.
  Both paths are in `lib/app/credential-paths.ts`, so logs and analytics
  collapse the token.
- **Opening one** (`readSharedReport`, `service.ts`) enters the link's
  workspace from its token (`runAsShareOrg`, `share-org.ts`): the lookup by
  hash under `runAsCredentialLookup`, the org through `resolveCredentialOrg`,
  then `runAsOrg`. The source is `'approval-token'`, t-31's decision for the
  print page, for the same reason (see the PDF above). Inside the org, one
  write both checks the link is live (not revoked, not expired) and counts the
  view, so a revoke cannot race a read. A malformed, unknown, revoked or
  expired token, or a suspended workspace, answers the same 404, and the page
  the same not-found.
- **What a link serves** (`sharedAssessmentSchema` in the route registry) is
  the report's fields, picked one by one: no id, cost, source, failure,
  per-judge cost or timing, workspace or author. A field added to the
  assessment's detail is not shared until someone adds it there.
- **Rate limit.** The page and the API share one per-IP tier,
  `shared-report` at `SHARED_REPORT_VIEWS_PER_MINUTE` (30,
  `lib/app/rate-limit.ts`). With no session the section cap would key on IP
  anyway, but at 100/min.
- **The page** is in `(public)`, `noindex`, and sends no referrer, so a link
  the report contains cannot pass the token on.
- **A link goes with its review.** The FK to the assessment cascades, so a
  delete and the retention purge take its links. The maker's column is
  `SET NULL` (a hand-written FK, with a drift probe), so a link outlives its
  maker's erasure, as the workspace's. Both exports carry links without the
  hash.

## Words

Visible names come from `lib/app/reports/words.ts`: **review** (assessment),
**AI reviewers** (judges) and **type of copy** (content type), per app-plan §4.
Code and API names are unchanged.
