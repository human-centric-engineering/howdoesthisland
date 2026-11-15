# The report

What `/assessments/[id]` shows: a finished review read top to bottom, as
app-plan §8.5 orders it. Built in t-29 (f-report). The PDF (x1) and share links
(x2) render the same component.

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
`shared`.

## Print

`app/brand-theme.css` (fork-owned) has a `@media print` block. It prints ink on
white whatever the screen mode, hides the platform header and footer, and drops
the sheet's shadow and crop marks. Sections avoid breaking inside a
recommendation, a red flag or a limitation. The header and footer rule reaches
into the platform layout's markup: if upstream changes it, the frame prints again
and nothing else breaks.

## Words

Visible names come from `lib/app/reports/words.ts`: **review** (assessment),
**AI reviewers** (judges) and **type of copy** (content type), per app-plan §4.
Code and API names are unchanged.
