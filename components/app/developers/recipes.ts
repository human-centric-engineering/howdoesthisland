/**
 * The developer docs' recipes (t-45, app-plan §4): common jobs, each against
 * a route that exists today.
 *
 * Each recipe's `body` is sent as written, and a test parses it with the
 * route's own request schema from the registry
 * (`tests/unit/components/app/developers/recipes.test.ts`), so a recipe
 * cannot drift from what the route accepts. "Compare subject lines" waits
 * for the comparisons routes and is not written against routes that do not
 * exist.
 *
 * Prose says "review" and "AI reviewers" (app-plan, "The words we use");
 * routes and fields are quoted as the API names them.
 */
import type { HttpMethod } from '@/lib/app/api/registry';
import { WAIT_BOUND_MS } from '@/lib/app/assessments/limits';

/** How long `wait: true` waits before answering 202, in words. */
const waitBound =
  WAIT_BOUND_MS % 60_000 === 0
    ? `${WAIT_BOUND_MS / 60_000} minute${WAIT_BOUND_MS === 60_000 ? '' : 's'}`
    : `${WAIT_BOUND_MS / 1000} seconds`;

export interface Recipe {
  /** The anchor on the page. */
  id: string;
  title: string;
  /** What the job is and why the request is shaped this way. */
  intro: string;
  method: HttpMethod;
  path: string;
  /** The scope the key needs. */
  scope: string;
  body: Record<string, unknown>;
  /** What to read from the answer, and what to do next. */
  then: string[];
  /** A shell script that does the whole job, where curl alone is not enough, and its file name. */
  script?: { name: string; body: string };
}

const ASSESSMENTS = '/api/v1/assessments';

/** The other readers the CFO recipe suggests: exec role ids in the shipped model (test). */
export const CFO_ALTERNATE_ROLES = ['cto', 'procurement'] as const;

/** The first review in Getting started: the quick scan, kept nowhere. */
export const FIRST_REVIEW: Pick<Recipe, 'method' | 'path' | 'scope' | 'body'> = {
  method: 'POST',
  path: ASSESSMENTS,
  scope: 'assess',
  body: {
    source: { text: 'Save two hours a week on reporting. Try it free for 30 days.' },
    profile: 'quick',
    store: false,
  },
};

export const RECIPES: readonly Recipe[] = [
  {
    id: 'recipe-landing-page',
    title: 'Review a landing page',
    intro:
      'Send the page by its URL and say it is a landing page, so the AI reviewers weigh it against what a landing page has to do. The page is fetched for you; only its words are reviewed.',
    method: 'POST',
    path: ASSESSMENTS,
    scope: 'assess',
    body: {
      source: { url: 'https://example.com/' },
      title: 'Home page, March relaunch',
      context: { contentType: 'landing_page' },
      wait: true,
    },
    then: [
      `With \`wait: true\` the answer is a 200 with the finished review once the AI reviewers are done, or a 202 if they take longer than ${waitBound}. A 202 carries the review’s \`id\`: follow it with \`GET /api/v1/assessments/{id}/events\`, or read \`GET /api/v1/assessments/{id}\` until \`status\` is no longer \`queued\` or \`running\`. A review ends \`completed\`, \`partial\` (some AI reviewers did not answer), \`failed\` or \`cancelled\`.`,
      '`overall` is the score out of 100 and `band` its name. `result` holds the notes on the copy, each with the passage it is about.',
      'For the report as a PDF, `GET /api/v1/assessments/{id}/report.pdf` with a key that has the `reports` scope.',
    ],
  },
  {
    id: 'recipe-cfo-briefing',
    title: 'Check an exec briefing for a CFO',
    intro:
      'The same copy lands differently with different readers. Name the type of copy and the reader’s role in `context`, and the review is scored for that reader: a CFO is looking for the numbers, the risk and what it costs to do nothing.',
    method: 'POST',
    path: ASSESSMENTS,
    scope: 'assess',
    body: {
      source: {
        text: 'We propose moving the three regional warehouses onto one shared inventory system by Q3. The pilot in the North cut stock write-offs by 18% in six months. The full rollout costs 1.2m and pays back in 20 months. Doing nothing leaves us carrying the same write-offs and a contract renewal in January we would rather not sign.',
      },
      title: 'Inventory consolidation, board pre-read',
      context: { contentType: 'exec_briefing', role: 'cfo' },
      wait: true,
    },
    then: [
      `Read \`overall\` and \`band\`, then the notes in \`result\`. To see how the same briefing lands with the CTO or the procurement lead, send it again with \`role\` set to \`${CFO_ALTERNATE_ROLES[0]}\` or \`${CFO_ALTERNATE_ROLES[1]}\`.`,
      'The ids a `context` takes are the framework version’s own: `GET /api/v1/frameworks/howdoesthisland/versions/{version}/content_type` and `…/exec_role` list them. An id the version does not have is refused with `CONTEXT_INVALID`, before anything runs.',
    ],
  },
  {
    id: 'recipe-ci-gate',
    title: 'Gate copy in CI',
    intro:
      'Fail a build when copy scores under a threshold. The `quick` profile is the quick scan: no AI reviewers, no charge, an answer straight away, and it does not count against the per-minute cap on reviews by the AI reviewers. `store: false` keeps nothing, so a pipeline does not fill your workspace with drafts.',
    method: 'POST',
    path: ASSESSMENTS,
    scope: 'assess',
    body: {
      source: { text: 'Ship faster with fewer surprises. Our checks run on every commit.' },
      profile: 'quick',
      store: false,
    },
    then: [
      'The answer is a 200 with `stored: false`, `overall` and `band`. Copy that cannot be scored at all is refused with a 422 `NOT_SCORABLE`; the script below fails the build on any answer but a 200, and on an `overall` of `null`.',
      'For a stricter gate, leave out `profile` to use every AI reviewer. That is charged, and counts against the per-minute cap.',
    ],
    script: {
      name: 'gate-copy.sh',
      body: `#!/usr/bin/env bash
# Fail when the copy in $1 scores under $THRESHOLD (default 60).
set -euo pipefail
THRESHOLD="\${THRESHOLD:-60}"

answer=$(jq -n --rawfile text "$1" \\
    '{source: {text: $text}, profile: "quick", store: false}' |
  curl -sS -X POST "$HDTL_URL/api/v1/assessments" \\
    -H "Authorization: Bearer $HDTL_KEY" \\
    -H "Content-Type: application/json" \\
    --data @- -w '\\n%{http_code}')
status="\${answer##*$'\\n'}"
body="\${answer%$'\\n'*}"

if [ "$status" != "200" ]; then
  echo "Review of $1 refused ($status): $(jq -r '.error.code // "unknown"' <<<"$body")" >&2
  exit 1
fi
score=$(jq -r '.data.overall // "null"' <<<"$body")
if [ "$score" = "null" ]; then
  echo "Could not score $1" >&2; exit 1
fi
echo "$1 scores $score (threshold $THRESHOLD)"
awk -v s="$score" -v t="$THRESHOLD" 'BEGIN { exit !(s >= t) }'`,
    },
  },
];

/** The request as curl, with the key and base URL from the environment. */
export function curlFor(recipe: Pick<Recipe, 'method' | 'path' | 'body'>): string {
  return [
    `curl -sS -X ${recipe.method} "$HDTL_URL${recipe.path}" \\`,
    '  -H "Authorization: Bearer $HDTL_KEY" \\',
    '  -H "Content-Type: application/json" \\',
    "  --data @- <<'JSON'",
    JSON.stringify(recipe.body, null, 2),
    'JSON',
  ].join('\n');
}
