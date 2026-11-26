# The assess workbench

`/assess` (t-78) is where a signed-in person starts a review in the browser and
watches it come in. It is a client over the API: `POST /api/v1/assessments` to
start, `GET /api/v1/assessments/{id}/events` to follow, the report at
`/assessments/{id}` to finish. Code: `components/app/workbench/`.

## What the page reads

Three calls, from the server component (`app/(protected)/assess/page.tsx`): the
framework's latest version, that version's catalogue, and the workspace's
projects. Only live projects on this framework are offered: the API refuses a
project on another framework, and an archived one.

The catalogue's `reviewers` (`{ id, covers }`) name each AI reviewer:
`reviewerName()` takes the appeal it covers, else the group, else the reviewer
set of that id (`lenses`, `influence`), else the slot.

## Settings and projects

The reader settings are the project form's pickers (`SettingPicker`,
`project-defaults.ts`), and the context they name is built by the same
`contextOf()` a project saves its defaults with.

Choosing a project fills the settings and the AI reviewers from its defaults,
and each can be changed. **A setting the project fixes offers no "model's
default" choice.** The API merges a request's context over the project's field
by field (`mergeContext`), so leaving that field out of the request does not
give the model's default: it gives the project's again. Offering the choice
would mean offering something the API will not do. For the same reason a
kept draft that leaves such a setting to the model shows, and sends, the
project's value (`settingsInProject`).

**A project default this version refuses can only be fixed on the project.**
A value the version no longer offers, an audience setting it no longer has,
or a culture with the culture switch off goes into every review in the project
by the same merge, and nothing sent can take it out. `staleDefaultsOf` names
them; the page says so under the project picker, links to the project, and
does not start the review.

The reviewers are a profile (the project form's list: the quick scan only, a
reviewer set, all of them) or the reviewers ticked one by one, sent as
`judges`. The culture reviewer is ticked only when the version serves countries.

## The draft

The text, the address, the project and the settings are kept in the browser
(`useLocalStorage`, key `howdoesthisland.assess.draft.v1`) until a review
starts, and read back through `draftSchema`: anything that does not parse
starts a fresh draft. The text and address are not capped there: one over
the limit would read back as empty. Their limits (40,000 characters, an
address of 2,048) are what the page checks before sending. A file is never kept. A project that is no longer offered
is dropped from a restored draft.

There is one draft per browser, not per tab: `useLocalStorage` passes each
write to every tab, so two tabs on `/assess` show the same draft, and starting
the review in one clears it in both.

The review runs on the version the page loaded: the body names `framework` and
`version`, so one published while the page is open does not change what the
offered settings and reviewers are checked against. If that version has been
retired since, the page asks for a reload (`FRAMEWORK_VERSION_NOT_FOUND`).

## Live progress

`useReviewEvents()` follows the stream; `ReviewProgress` shows it: the quick
scan (from the 202, or the stream's `assessment_quick_scan`) beside its caveat,
then each AI reviewer as it lands, in the version's order.

**The browser's `EventSource` reconnects by itself whenever a stream ends.** So
the hook closes it on every event that ends one:

| Event                | What the page does                                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assessment_done`    | Closes it and calls `onDone` once: `/assess` opens the report, the report page refreshes.                                                           |
| `assessment_gone`    | Closes it and says the review was deleted.                                                                                                          |
| `assessment_timeout` | Closes it and opens a new one at once. The new stream replays the reviewers that had landed; they replace what is held by slot, so nothing doubles. |

A stream the browser gives up on (or the server's own error frame) is retried
three times (`MAX_RETRIES`), a little later each time, then shown as lost with
**Try again**. The count starts over only after a stream has stayed open for
`STABLE_MS`, not on an event: each new stream replays its status, so a stream
that fails just after would otherwise be retried forever. One the browser is
recovering from itself shows "Reconnecting…"; if it has not reconnected
within `STALL_MS` (it never gives up by itself while the network is down),
that counts as a failed stream and a retry.

Once the review is final the page opens the report, and shows a plain link to
it as well, in case opening it by itself fails.

A review with no AI reviewer is final in its 200 answer, so the page opens
the report straight away and opens no stream.

## A report opened mid-run

`/assessments/{id}` renders `ReportPending` for a queued or running review: the
same live progress (`LiveReportPending`), named from the catalogue of the
version the review runs on, and `router.refresh()` once it is final, so the
report takes its place without a reload. The catalogue only names things: if
it cannot be read, the progress shows the reviewers' slots and appeal ids
instead of failing the page.

## Refusals

Shown beside Start with `<SaveError>`. `refusalOf()` words four itself:
`INSUFFICIENT_CREDITS` and `BUDGET_EXCEEDED` keep the server's reason and add a
link to the usage page (`details.usagePage`, taken only when it is a path on
this site); `WORKSPACE_BUSY` and `RATE_LIMIT_EXCEEDED` say to wait. Every other
refusal, the intake's among them (a file too large, a page that could not be
fetched, too much text), shows the server's own message, which already says
what to do. The page checks the obvious ones before sending: no text, an
address that is not `https://…`, no file or one over `MAX_REVIEW_FILE_BYTES`,
and no reviewer ticked.

**A review that started is never shown as refused.** Once the POST succeeds
the review exists and is charged, so the draft is cleared before the reply is
read. A reply the page cannot read in full but that names the review opens
its report; one that does not even do that says the review has started and
need not be started again.

**The page sends files up to the 10 MB a review reads** (`MAX_REVIEW_FILE_BYTES`),
as a multipart upload (`sendUpload`, t-80; see Uploads in
[`intake.md`](./intake.md#uploads)), with the request's other fields as its `options`.
Text and a page still go as JSON. On Vercel staging, any body over 4.5 MB is refused
before the route runs: the page shows "This file is too large for this server to
accept" and keeps the draft and the file. The production servers carry the whole 10 MB.

## Recent work

`/home` and a project's page (t-79) list the workspace's reviews, newest first,
each linking to its report. Code: `components/app/history/`.
`/home` also shows the latest comparisons (t-90); see `comparisons.md`.

- **One list call.** Each page makes one `GET /api/v1/assessments` call for its
  list (`reviewListEndpoint`, 20 a page); a row names its project from the
  row's own `project`, so no row fetches anything. A project's page passes
  `projectId` and leaves the project column out.
- **The filters live in the address** (`?projectId=`, `?contentType=`,
  `?band=`, `?page=`), so a filtered list can be linked to; a change goes back
  to the first page. `/home` offers them from the workspace's projects and the
  latest catalogue's `contentTypes` and `bands`. Archived projects are offered
  too, marked "(archived)", since their reviews are still listed. A value the
  choices lack (an older version's type) is still shown as chosen.
- **The empty desk** (`HomeEmptyState`, linking to `/assess`) shows only when
  the workspace has no review and no comparison at all. A filter matching nothing says so and
  offers to clear the filters instead. With no reviews and no comparisons, `/home`
  reads neither the catalogue nor the projects. With only comparisons it hides
  the filters and points to `/assess`. If the comparisons cannot be read, their
  section is replaced by a link to `/compare` and the reviews still show; the
  desk is not called empty, since it may not be. A page past the last links back to the
  newest. An archived project with no reviews says to restore it, not to
  choose it on `/assess`.
- **Delete asks first**: it takes the copy, the result and any share link, and
  cannot be undone. Confirmed, it calls `DELETE /api/v1/assessments/{id}`,
  drops the row and refreshes, so the count and pages follow. Until the
  refresh lands the count and the Older link leave the deleted rows out, and
  a page emptied by deletes keeps its status line and page links.
- **A project's page loads at once** what needs only the project (its
  documents, reviews and framework); only the catalogue waits, for the
  framework's latest version.
