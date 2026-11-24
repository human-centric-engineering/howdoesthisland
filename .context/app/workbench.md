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
would mean offering something the API will not do.

The reviewers are a profile (the project form's list: the quick scan only, a
reviewer set, all of them) or the reviewers ticked one by one, sent as
`judges`. The culture reviewer is ticked only when the version serves countries.

## The draft

The text, the address, the project and the settings are kept in the browser
(`useLocalStorage`, key `howdoesthisland.assess.draft.v1`) until a review
starts, and read back through `draftSchema`: anything that does not parse
starts a fresh draft. A file is never kept. A project that is no longer offered
is dropped from a restored draft.

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
**Try again**. One the browser is recovering from itself shows "Reconnecting…".

A review with no AI reviewer is final in its 200 answer, so the page opens
the report straight away and opens no stream.

## A report opened mid-run

`/assessments/{id}` renders `ReportPending` for a queued or running review: the
same live progress (`LiveReportPending`), named from the catalogue of the
version the review runs on, and `router.refresh()` once it is final, so the
report takes its place without a reload.

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
