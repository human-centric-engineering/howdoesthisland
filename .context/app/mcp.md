# MCP tools

People write in AI assistants, and want to check a draft without copying it into
the workbench. Sunrise's MCP server (`POST /api/v1/mcp`, see
[`.context/orchestration/mcp.md`](../orchestration/mcp.md)) serves capabilities as
tools, bound to a workspace by its key. HowDoesThisLand registers its own
(`f-mcp`). The same capabilities are there for a workspace's own agents and
workflows to call.

## The tools

| Tool             | Does                                                                                       | Calls (the route's library)                                         | Needs a person | Spends |
| ---------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | -------------- | ------ |
| `quick_scan`     | Scores pasted text at once, without AI. Answers the route's summary: scores, band, caveat. | `runQuickScan`, `summariseQuickScan`                                | no             | no     |
| `assess_draft`   | Starts a full review of text or a public URL, stored, and waits up to 45 seconds for it.   | `prepareAssessment` → cap → `holdReviewBudget` → `createAssessment` | yes            | yes    |
| `get_assessment` | Reads one of the workspace's reviews, summarised for an assistant.                         | `getAssessment`, then `loadReport` (the report's own view)          | no             | no     |

Comparing and rewriting come next (t-93, t-94), and so do keys a workspace owner
makes from settings (t-95).

The code is `lib/app/mcp/`. Each tool has a class (its definition, Zod schema and
redaction) and its work in `run/`. `tool-support.ts` holds what they share,
`assessment-summary.ts` what `get_assessment` and `assess_draft` answer, and
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
  `McpApiKey.createdBy` as `context.userId`. `assess_draft` needs one, for the
  per-person cap (`aiAssessmentLimiter`, keyed `user:<id>`, the same bucket as
  the API) and the review's `createdByUserId`. A key whose creator has gone
  (`createdBy` is `SetNull`) is refused with `KEY_HAS_NO_OWNER`. The two tools
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
  route does not raise. A review cut off there is picked up by assessment
  recovery, as any abandoned run is.
- **Refusals reach the assistant in the library's words.** An `APIError` (no
  credits, a context the framework refuses, not found) becomes the tool's error
  with its code. Anything else is thrown for the dispatcher to log, and it
  answers its generic `execution_error`.

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

### Personal data

Every tool sets `processesPii`, because a draft is the writer's words and may
name people. `redactProvenance` keeps a draft's length, never its text, and
`[title]` for a title. Its result preview is the id and status.

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
  schemas, each tool around a mocked library, the summary).
- Through the real transport, on the dev database with the dev server running:

  ```bash
  npx tsx --env-file=.env.local scripts/app/smoke-mcp-tools.ts
  ```

  It makes a throwaway workspace with a quick-scan review and a key, turns the
  server and the three tools on, then calls `tools/list`, `quick_scan` and
  `get_assessment`, and `get_assessment` on another workspace's review. Then it
  puts everything back. It never calls `assess_draft`, which would bill the
  judges. Add `NODE_OPTIONS=--use-system-ca` behind the local HTTPS proxy, and
  `SMOKE_MCP_SHOW=1` to print the answers.

To try it from Claude Code, add the server with the key as a bearer header:

```bash
claude mcp add --transport http howdoesthisland https://<host>/api/v1/mcp \
  --header "Authorization: Bearer smcp_..."
```
