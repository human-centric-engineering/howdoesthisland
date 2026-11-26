# MCP tools

People write in AI assistants, and want to check a draft without copying it into
the workbench. Sunrise's MCP server (`POST /api/v1/mcp`, see
[`.context/orchestration/mcp.md`](../orchestration/mcp.md)) serves capabilities as
tools, bound to a workspace by its key. HowDoesThisLand registers its own
(`f-mcp`). The same capabilities are there for a workspace's own agents and
workflows to call.

## The tools

| Tool             | Does                                                                                                            | Calls (the route's library)                                                                    | Needs a person | Spends |
| ---------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------- | ------ |
| `quick_scan`     | Scores pasted text at once, without AI. Answers the route's summary: scores, band, caveat.                      | `runQuickScan`, `summariseQuickScan`                                                           | no             | no     |
| `assess_draft`   | Starts a full review of text or a public URL, stored, and waits up to 45 seconds for it.                        | `prepareAssessment` → cap → `holdReviewBudget` → `createAssessment`                            | yes            | yes    |
| `get_assessment` | Reads one of the workspace's reviews, summarised for an assistant.                                              | `getAssessment`, then `loadReport` (the report's own view)                                     | no             | no     |
| `compare_drafts` | Reviews 2–5 drafts the same way, and waits up to 45 seconds for the editor's verdict.                           | `prepareComparison` → cap → `holdComparisonBudget` → cap → `createComparison` → `releaseHolds` | yes            | yes    |
| `get_comparison` | Reads one of the workspace's comparisons and its verdict, summarised for an assistant.                          | `getComparison` (the comparison's own view)                                                    | no             | no     |
| `rewrite_draft`  | Has the editor rewrite a finished review's draft, or fill a rewrite's placeholders, and waits up to 45 seconds. | `rewriteLimiter` → `startRewrite`                                                              | yes            | yes    |
| `get_rewrite`    | Reads one of the workspace's rewrites and its placeholders, summarised for an assistant.                        | `getRewrite` (the rewrite's own view)                                                          | no             | no     |

Keys a workspace owner makes from settings come next (t-95).

The code is `lib/app/mcp/`. Each tool has a class (its definition, Zod schema and
redaction) and its work in `run/`. `tool-support.ts` holds what they share,
`run/spender.ts` the checks both spending tools make before anything is charged,
`assessment-summary.ts` what `get_assessment` and `assess_draft` answer,
`comparison-summary.ts` what `get_comparison` and `compare_drafts` answer,
`rewrite-summary.ts` what `get_rewrite` and `rewrite_draft` answer, and
`definitions.ts` what each tool publishes.

**A class loads its work on its first call, never at import.** Core's capability
registry imports `lib/app/capabilities.ts` on every dispatch path, so whatever a
class imports lands in the module graph of everything that can dispatch. When the
classes first imported the assessment service, the database client and the rate
limiters came with them, and core's inbound-trigger route tests stopped loading.
`tests/unit/lib/app/mcp/import-weight.test.ts` fails if a class reaches either again.

## How a call runs

The transport authenticates the key, runs the call inside the key's workspace
(`runAsOrg(key.orgId)`), and dispatches as the `mcp-system` agent (or the key's
scoped agent). **There is no session and no request behind a tool call.** So:

- **The person is the key's creator.** `protocol-handler.ts` passes
  `McpApiKey.createdBy` as `context.userId`. The three spending tools need one,
  for the per-person cap (keyed `user:<id>`, the same bucket as the API:
  `aiAssessmentLimiter` for `assess_draft` and `compare_drafts`,
  `rewriteLimiter` for `rewrite_draft`) and the `createdByUserId` of what they
  store. A key whose creator has gone
  (`createdBy` is `SetNull`), or is no longer a member of the key's workspace,
  is refused with `KEY_HAS_NO_OWNER` before anything is prepared or charged,
  and a suspended workspace with `WORKSPACE_SUSPENDED`. Past the per-person cap
  the code is `RATE_LIMIT_EXCEEDED`, the API's. The two tools
  that only read, or spend nothing, still work for it.
- **Credits, the review budget and the running limit hold as over the API**,
  because the tool takes the route's steps, in the route's order.
- **A review is recorded as `MCP`** (`AssessmentVia.MCP`), not `APP`: the tool
  sets `Caller.via`, since an MCP key is not an `sk_` key and leaves `apiKeyId`
  empty.
- **A tool answers within `MCP_WAIT_MS` (45 seconds).** Many MCP clients give a
  tool call 60 seconds. A review that is still running then is answered with its
  id and status (`ready: false`, with the quick scan's early read). It runs on
  (`keepRunningAfterResponse`), and `get_assessment` reads it later. On Vercel
  that continuation is bounded by the MCP route's function duration, which the
  route raises to 800 seconds, as `/api/v1/rewrites` does (divergence row 32):
  a rewrite's call can run for `REWRITE_CALL_MS` (750 seconds), the longest of
  the tools' work. `tests/unit/lib/app/rewrites/limits.test.ts` fails if the
  route falls below the rewrites route's. `rewrite_draft` waits the same bound for
  `startRewrite`'s `done`; the rewrite was handed to `keepRunningAfterResponse`
  before `startRewrite` returned, so past the bound it is saved, ended and
  charged with no one waiting, and `get_rewrite` reads it.
  `compare_drafts` waits the same bound, though the comparisons route answers 202
  at once: a tool call that answered at once would leave the assistant nothing to
  say. It polls each draft's status and the verdict's, not the full view, once a
  second, and answers once every draft's review has ended and so has the verdict
  (`comparisonSettled`).
  A review cut off anyway is picked up by assessment recovery, as any abandoned
  run is. A JSON-RPC batch runs its calls one after another in one request, so
  a batch carries at most one call to a tool that waits (`assess_draft`,
  `compare_drafts` or `rewrite_draft`, counted together): each later one is refused with
  `INVALID_REQUEST`, saying to send it on its own (`lib/app/mcp/batch.ts`,
  divergence row 33). The tool does not see the client hang up (core's
  `CapabilityContext` carries no abort signal), so it waits out its 45 seconds
  either way.
- **A stored review or comparison always answers its id.** If the summary cannot
  be built after the review is stored (`storedButUnread`), the tool logs it and
  answers the id and status with `ready: false`, so the assistant reads it back
  with `get_assessment` instead of paying for another. A failure after either is
  stored answers `STORED_UNREAD` with the id (`onStored` on `createAssessment`
  and `createComparison`).
- **The audit trail keeps a context's catalogue ids, not free text**
  (`contextShape`): a key or value that does not read as an id is kept as
  `[key]` or `[value]`, since the record is written before the framework checks
  the context.
- **Refusals reach the assistant in the library's words.** An `APIError` (no
  credits, a context the framework refuses, not found) becomes the tool's error
  with its code. A refusal about one draft of a comparison names it by position, counting from 0 as every answer does (`The draft at position 2:`),
  and the fields it was reviewed with that differ, which the API carries in
  `details.position` and `details.differs`. Anything else is thrown for the
  dispatcher to log, and it answers its generic `execution_error`.

### What `get_assessment` answers

The report's view (`buildReportView` through `loadReport`), trimmed to what an
assistant can use: overall score and band, the editor's verdict, the changes
that matter most and what works, each appeal's score and question, at most ten
recommendations (with a count of the rest), red flags, and the report's URL.
Left out are character offsets, dimensions, lenses and duties, which an assistant
cannot place.

**A recommendation marked `example: true` is the model's illustration of the
move, not a line of the draft.** Quick-scan reviews have many of these. The flag
is passed through so an assistant does not quote words the writer never wrote.

### What `compare_drafts` takes and `get_comparison` answers

The drafts as text, or as the `assessmentId` of a finished review reviewed the
same way (t-84), which joins without being charged again; at least one is text.
It takes `projectId` and `context`, and no profile, judges or framework version,
as `assess_draft` takes none. So every draft gets the full panel or the project's
defaults, and a review `assess_draft` made can join. **Each draft it reviews
counts against the per-person cap**: the tool peeks for room for all of them
before it holds the budget, and again after, then counts each, as the route does.

The answer is the comparison's view trimmed for an assistant: each draft's place,
label, review id, state, score and band; per appeal the leaders and each draft's
gap to the best; and the verdict's state, the draft it chose, why, the appeals
that decide it, or why there is none. `ready` is true once nothing will change.
Left out are the context, the judge slots, and the verdict's model and cost.
`get_assessment` on a draft's `assessmentId` reads its recommendations.

### What `rewrite_draft` takes and `get_rewrite` answers

The `assessmentId` of a finished review, and a `focus` (`balanced`, the default,
or an appeal), as `POST /api/v1/rewrites` takes them; never streamed. **Filling
placeholders is a second call**: `fromRewriteId` (a completed rewrite of the same
review) with `answers` keyed by placeholder id. The tool's description tells the
assistant to ask the writer for them rather than make them up.

The answer is the rewrite's view trimmed for an assistant: its id, review, focus
and state, `ready` once it has ended, the review's URL (where the rewrite sits),
and once completed the draft and each placeholder's id and label. **The draft is
given only once completed**: a running rewrite's row holds what the editor has
written so far, and a failed one what it wrote before it stopped, and an
assistant handed either could pass it off as the rewrite. A failed one answers
why (`error`, `errorCode`). Left out are each placeholder's offsets, the model
and the cost.

### Personal data

Every tool sets `processesPii`, because a draft is the writer's words and may
name people. `redactProvenance` keeps a draft's length, never its text, and
`[title]` or `[label]` for a title or a draft's label. For `rewrite_draft` it
keeps which placeholders were answered, never the answers. Its result preview is the id and status.

**The MCP audit log keeps none of a draft either.** Core's transport writes every
call's params to `McpAuditLog`, an install-wide table that platform admins read
and that no workspace's erasure reaches. A `tools/call`'s `arguments` are now
withheld there unless the tool's capability declares no personal data
(`toolArgumentsAuditable`, `WITHHELD_TOOL_ARGUMENTS`). That is a change we carry
in core (ledger row 31), filed as sunrise#1349.

## Who can make a key

- **Today, at `TENANCY_MODE=multi`:** a workspace OWNER or ADMIN, at
  `/admin/orchestration/mcp/keys`. That route and page are org-tier in core
  (`lib/auth/admin-tier.ts`), and this app's authorization policy does not
  narrow them yet. A platform admin can too, in any workspace they enter.
- **Once t-64 lands:** the admin area is platform admins only, so a workspace
  can get a key only from a platform admin.
- **Owner ruling (2026-11-26):** workspace owners make and revoke their own
  keys from the workspace's settings (t-95), not from `/admin`.

A key a workspace makes needs only `tools:list` and `tools:execute`.

## After a merge that changes a tool

A tool's published schema lives in three places: `definitions.ts`, the
`AiCapability` row the seed writes, and the tool list each client cached when it
connected (`sunrise.mcp-reseed`). Merging changes only the first.

1. **Deploy.**
2. **Reseed each database:** `npm run db:seed`. The seed
   (`prisma/seeds/app-howdoesthisland/003-mcp-tools.ts`) imports the same
   definitions as the classes and lists that file in `hashInputs`, so it re-runs
   when they change.
3. **Enable a new tool** on `/admin/orchestration/mcp/tools`. Tools are
   default-deny, and the seed writes no `McpExposedTool` row. Turn on the MCP
   server there too, if it is off.
4. **Reconnect each client.** Check by calling the tool, not by listing: a cached
   list can be stale while a call reaches the new server.

## Checking it

- Unit tests: `tests/unit/lib/app/mcp/` (the definitions against their Zod
  schemas, each tool around a mocked library, the summary). The rewrite tools'
  run the real rewrites service with the editor stubbed and Next's `after()`
  recorded, so they show a rewrite answered early still ending and being charged.
- Through the real transport, on the dev database with the dev server running:

  ```bash
  npx tsx --env-file=.env.local scripts/app/smoke-mcp-tools.ts
  ```

  It makes a throwaway workspace with two quick-scan reviews, a comparison of
  them, a finished rewrite of one (written as a row) and a key, turns the server
  and the tools on, then calls `tools/list`, `quick_scan`, `get_assessment`,
  `get_comparison` and `get_rewrite`, and each read on another workspace's. Then
  it puts everything back. It never calls `assess_draft`, `compare_drafts` or
  `rewrite_draft`, which would bill the judges or the editor. Add `NODE_OPTIONS=--use-system-ca` behind the local HTTPS proxy, and
  `SMOKE_MCP_SHOW=1` to print the answers.

To try it from Claude Code, add the server with the key as a bearer header:

```bash
claude mcp add --transport http howdoesthisland https://<host>/api/v1/mcp \
  --header "Authorization: Bearer smcp_..."
```
