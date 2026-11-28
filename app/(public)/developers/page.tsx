/**
 * `/developers`: the developer docs (t-45, dp2b).
 *
 * Getting started, authentication, errors and limits, recipes, webhooks
 * (t-100), and the reference. The reference is rendered from `openApiDocument()`, the document
 * `GET /api/v1/openapi.json` serves, so the page cannot list a route the
 * document lacks; the scope table under Authentication is read from the same
 * document. Limits are read from the constants the limiters use.
 *
 * Public: no session is read, so it renders the same signed in or out. It
 * renders per request so the limits are the running server's. Prose says "review" and "AI reviewers" (app-plan, "The words we use");
 * routes and fields are quoted as the API names them.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { env } from '@/lib/env';
import { SECURITY_CONSTANTS } from '@/lib/security/constants';
import { openApiDocument } from '@/lib/app/api/openapi';
import { isQuickScanEnabled } from '@/lib/app/quick-scan/switch';
import {
  AI_ASSESSMENTS_PER_MINUTE,
  RUNNING_PER_WORKSPACE,
  MAX_CONTENT_CHARS,
  SCANS_PER_MINUTE,
} from '@/lib/app/assessments/limits';
import { SHARED_REPORT_VIEWS_PER_MINUTE } from '@/lib/app/reports/share/limits';
import { API_KEYS_PAGE_HREF, SCOPE_DESCRIPTIONS } from '@/components/app/settings/api-keys/schemas';
import { ApiReference } from '@/components/app/developers/api-reference';
import { CodeBlock } from '@/components/app/developers/code-block';
import {
  operationAnchor,
  readOperations,
  type Operation,
} from '@/components/app/developers/operations';
import { Prose } from '@/components/app/developers/prose';
import { FIRST_REVIEW, RECIPES, curlFor } from '@/components/app/developers/recipes';
import { SAMPLE_BODY, VERIFY_SAMPLE, WEBHOOK_EVENTS } from '@/components/app/developers/webhooks';
import { WEBHOOKS_PAGE_HREF } from '@/components/app/settings/webhooks/schemas';

const description =
  'How to call the HowDoesThisLand API: keys, errors and limits, recipes, and the full reference.';

export const metadata: Metadata = {
  title: 'Developers',
  description,
  openGraph: { title: 'Developers - HowDoesThisLand', description },
};

const SECTIONS = [
  { id: 'getting-started', title: 'Getting started' },
  { id: 'authentication', title: 'Authentication' },
  { id: 'errors-and-limits', title: 'Errors and limits' },
  { id: 'recipes', title: 'Recipes' },
  { id: 'webhooks', title: 'Webhooks' },
  { id: 'reference', title: 'Reference' },
] as const;

const OPENAPI_PATH = '/api/v1/openapi.json';

const FIRST_REQUEST = curlFor(FIRST_REVIEW);

const SUCCESS_ENVELOPE = `{
  "success": true,
  "data": { "stored": false, "overall": 58, "band": "Developing", … }
}`;

const ERROR_ENVELOPE = `{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request body",
    "details": { … }
  }
}`;

/** Codes any route can answer. A route's own are below, and in its reference entry. */
const COMMON_ERRORS: [status: number, code: string, meaning: string][] = [
  [
    400,
    'VALIDATION_ERROR',
    'The body, query or path does not parse. `details` says where. A frameworks route answers a path that does not parse with `404`.',
  ],
  [401, 'UNAUTHORIZED', 'No key or session, or a key that is revoked or expired.'],
  [
    403,
    'FORBIDDEN',
    'The key lacks the scope the route needs, or the route takes no keys; or you are not the workspace or platform admin the route needs.',
  ],
  [404, 'NOT_FOUND', 'Nothing by that id in your workspace.'],
  [429, 'RATE_LIMIT_EXCEEDED', 'Over a limit below. Wait for `Retry-After` seconds.'],
];

/** What `POST /api/v1/assessments` can refuse a review with, beyond the common codes. */
const REVIEW_ERRORS: [status: number, code: string, meaning: string][] = [
  [400, 'CONTENT_EMPTY', 'No copy once whitespace is trimmed.'],
  [400, 'CONTEXT_INVALID', '`context` names an id this framework version does not have.'],
  [400, 'PROFILE_UNKNOWN', 'No such `profile` or AI reviewer, or one switched off.'],
  [
    402,
    'INSUFFICIENT_CREDITS',
    'Your workspace’s CopyCredits do not cover the review, or none are left. No AI reviewer started and nothing was kept or charged, stored or not. `details` gives, in whole credits, the estimate (`estimateCredits`) and where it came from (`basis`, as below), your balance (`balanceCredits`), what your reviews already starting, queued or running have spent and are yet to spend (`heldCredits`), and what is left (`remainingCredits`). A review is charged once it ends, for what it actually spent, rounded up to a whole credit; one that costs more than its estimate can take the balance below zero, and then every review is refused until credits are added. Credits come from a review code or from HowDoesThisLand; your balance is on `/usage`. A `quick` review is never refused this way.',
  ],
  [
    402,
    'BUDGET_EXCEEDED',
    'Checked after your credits. The review would cost more than is left of your workspace’s monthly AI budget, its safety ceiling, or none is left. No AI reviewer started and nothing was kept, stored or not. `details` gives the estimate (`estimateUsd`) and where it came from (`basis`: your past reviews of the profile, your recent AI reviewer calls, your `store: false` reviews’ calls as `kept-nowhere`, or `none`), what is left (`remainingUsd`, once what your reviews already starting, queued or running are yet to spend, `inFlightUsd`, is held back, so requests sent together cannot each spend the same remainder) and the budget (`limitUsd`); your usage is on `/usage`, and an admin can raise the budget. A `quick` review is never refused this way.',
  ],
  [404, 'FRAMEWORK_NOT_FOUND', 'No published framework by that `framework` slug.'],
  [404, 'FRAMEWORK_VERSION_NOT_FOUND', 'No published version by that `framework` and `version`.'],
  [
    422,
    'TEXT_TOO_LONG',
    `Over ${MAX_CONTENT_CHARS.toLocaleString('en-GB')} characters. Copy is refused, never cut. Pasted text over twice that fails to parse first, as \`400 VALIDATION_ERROR\`.`,
  ],
  [422, 'URL_NOT_ALLOWED', 'The page’s address is one the server will not fetch.'],
  [422, 'FETCH_FAILED', 'The page could not be fetched.'],
  [422, 'FETCH_TIMEOUT', 'The page took too long to answer.'],
  [413, 'FILE_TOO_LARGE', 'The file is over the upload limit.'],
  [415, 'INVALID_FILE_TYPE', 'Not a file type the server can read.'],
  [422, 'TOO_MANY_PAGES', 'The file has more pages than the server reads.'],
  [422, 'PDF_HAS_NO_TEXT', 'The PDF has no text to read, as a scan does not.'],
  [422, 'NO_TEXT', 'The file or page has no words in it.'],
  [422, 'FILE_UNREADABLE', 'The file could not be read.'],
  [422, 'NOT_SCORABLE', 'With `store: false`: the copy could not be scored.'],
  [
    429,
    'WORKSPACE_BUSY',
    `With \`store: false\`: your workspace already has ${RUNNING_PER_WORKSPACE} reviews by the AI reviewers running, or running and waiting their turn, the most it runs at once. No reviewer started. Refused on arrival, it does not count against your per-minute cap; refused because another request took the last place while yours was being read, it does. Wait for \`Retry-After\` seconds, or send the review stored, which queues. A \`quick\` review is never refused this way.`,
  ],
];

const LIMITS = SECURITY_CONSTANTS.RATE_LIMIT.LIMITS;

type RateLimitRow = [what: string, perMinute: number, keyedOn: string];

/** The quick scan's cap, listed only while the quick scan is switched on (t-61). */
const QUICK_SCAN_LIMIT: RateLimitRow = [
  'The quick scan (`POST /api/v1/scan`), in place of the first cap',
  SCANS_PER_MINUTE,
  'Per IP address',
];

/** Each per-minute cap, and what it counts. */
function rateLimits(quickScan: boolean): RateLimitRow[] {
  return [
    [
      'Every route under `/api/v1` not named below',
      LIMITS.API,
      'Per person with a browser session; per IP address with a key',
    ],
    [
      'Routes under `/api/v1/admin`, in place of the cap above',
      LIMITS.ADMIN,
      'Per person with a browser session; per IP address with a key',
    ],
    [
      'Reviews by the AI reviewers (`POST /api/v1/assessments`, any profile but `quick`)',
      AI_ASSESSMENTS_PER_MINUTE,
      'Per person, on top of the first cap',
    ],
    ...(quickScan ? [QUICK_SCAN_LIMIT] : []),
    [
      'Opening a shared report (`GET /api/v1/shared-reports/{token}`), in place of the first cap',
      SHARED_REPORT_VIEWS_PER_MINUTE,
      'Per IP address',
    ],
  ];
}

/** A scope's name and what it lets a key do; a scope with no description is shown by name. */
function describeScope(scope: string): { label: string; detail: string | null } {
  if (scope === 'admin') {
    return {
      label: 'Platform admins',
      detail:
        'For the people who run HowDoesThisLand, not for its customers: only a platform admin can make a key with this scope.',
    };
  }
  return SCOPE_DESCRIPTIONS[scope] ?? { label: scope, detail: null };
}

function RouteLinks({ ops }: { ops: Operation[] }) {
  return (
    <ul className="space-y-0.5">
      {ops.map((op) => (
        <li key={op.operationId}>
          <a
            href={`#${operationAnchor(op.operationId)}`}
            className="font-mono text-xs break-all hover:underline"
          >
            {op.method} {op.path}
          </a>
        </li>
      ))}
    </ul>
  );
}

function ErrorTable({ rows }: { rows: [number, string, string][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left">
            <th className="py-1 pr-4">Status</th>
            <th className="py-1 pr-4">Code</th>
            <th className="py-1">Means</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([status, code, meaning]) => (
            <tr key={code} className="border-t align-top">
              <td className="py-1 pr-4 font-mono">{status}</td>
              <td className="py-1 pr-4 font-mono text-xs">{code}</td>
              <td className="py-1">
                <Prose>{meaning}</Prose>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function DevelopersPage() {
  // At request time, not build time: the caps below are read from the
  // environment the server runs with (`RATE_LIMIT_*`), as the proxy reads them.
  await connection();
  const document = openApiDocument();
  const operations = readOperations(document);
  // Every scope a route in the document asks for, in the document's order.
  const keyScopes = [
    ...new Set(operations.flatMap((op) => (op.apiKeyScope ? [op.apiKeyScope] : []))),
  ];
  const byScope = (scope: string) => operations.filter((op) => op.apiKeyScope === scope);
  const sessionOnly = operations.filter((op) => !op.anonymous && op.apiKeyScope === null);
  const anonymous = operations.filter((op) => op.anonymous);
  const baseUrl = env.NEXT_PUBLIC_APP_URL;

  return (
    <div className="container mx-auto max-w-4xl px-4 py-12 [&_:not(pre)>code]:text-[0.875em] [&_:not(pre)>code]:[overflow-wrap:anywhere]">
      <header className="space-y-3">
        <p className="hd-slug">Developers</p>
        <h1 className="hd-wordmark text-4xl">The HowDoesThisLand API</h1>
        <p className="text-muted-foreground max-w-prose text-lg">
          Everything you can do with a review on the site, you can do from your own code: send copy,
          a page or a file, get the AI reviewers’ scores and notes back, and fetch the report.
        </p>
        <nav aria-label="On this page">
          <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="underline underline-offset-2">
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <div className="mt-12 space-y-16">
        <section id="getting-started" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold">Getting started</h2>
          <ol className="list-decimal space-y-3 pl-5">
            <li>
              <Link href="/signup" className="underline underline-offset-2">
                Make an account
              </Link>
              , or sign in.
            </li>
            <li>
              Make a key on{' '}
              <Link href={API_KEYS_PAGE_HREF} className="underline underline-offset-2">
                API keys
              </Link>{' '}
              with the <code>assess</code> scope. Its value is shown once: keep it somewhere safe.
            </li>
            <li>
              Put the key and the address in your shell, then send your first review. This one is
              the <code>quick</code> profile, so it costs nothing and keeps nothing.
            </li>
          </ol>
          <CodeBlock>{`export HDTL_URL="${baseUrl}"\nexport HDTL_KEY="sk_…"`}</CodeBlock>
          <CodeBlock label="Your first review">{FIRST_REQUEST}</CodeBlock>
          <p>
            Every answer is JSON in the same envelope. <code>overall</code> is the score out of 100,
            and <code>band</code> its name:
          </p>
          <CodeBlock>{SUCCESS_ENVELOPE}</CodeBlock>
          <p>
            Leave out <code>profile</code> and every AI reviewer reads the copy; leave out{' '}
            <code>store</code> and the review is kept in your workspace, where you can open its
            report on the site. The recipes below show both.
          </p>
        </section>

        <section id="authentication" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold">Authentication</h2>
          <p>
            Send your key as a bearer token on every request:{' '}
            <code>Authorization: Bearer sk_…</code>. A key acts as you, in the workspace you were
            working in when you made it. Make, list and revoke keys on{' '}
            <Link href={API_KEYS_PAGE_HREF} className="underline underline-offset-2">
              API keys
            </Link>
            ; a revoked or expired key is answered <code>401</code> at once.
          </p>
          <p>
            Each key holds scopes, and a route checks for the one it needs. Give a key only what its
            job needs: a key that downloads reports does not need to run reviews.
          </p>
          <div className="space-y-6">
            {keyScopes.map((scope) => {
              const { label, detail } = describeScope(scope);
              return (
                <div key={scope} className="space-y-1">
                  <h3 className="font-semibold">
                    <code>{scope}</code> · {label}
                  </h3>
                  {detail ? <p className="text-muted-foreground text-sm">{detail}</p> : null}
                  <RouteLinks ops={byScope(scope)} />
                </div>
              );
            })}
            <div className="space-y-1">
              <h3 className="font-semibold">Browser session only</h3>
              <p className="text-muted-foreground text-sm">
                Managing workspaces, invitations and the AI reviewers’ models is done signed in on
                the site. These routes answer a key with <code>403</code>.
              </p>
              <RouteLinks ops={sessionOnly} />
            </div>
            <div className="space-y-1">
              <h3 className="font-semibold">No key needed</h3>
              <p className="text-muted-foreground text-sm">
                Shared reports and this API’s own description. The catalogue of what a review takes
                and returns needs a key with <code>assess</code>.
              </p>
              <RouteLinks ops={anonymous} />
            </div>
          </div>
        </section>

        <section id="errors-and-limits" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold">Errors and limits</h2>
          <p>
            A refusal has <code>success: false</code> and a stable <code>error.code</code> to branch
            on; <code>message</code> is for people and may change.
          </p>
          <CodeBlock>{ERROR_ENVELOPE}</CodeBlock>
          <ErrorTable rows={COMMON_ERRORS} />
          <h3 className="pt-2 font-semibold">
            When a review is refused (<code>POST /api/v1/assessments</code>)
          </h3>
          <ErrorTable rows={REVIEW_ERRORS} />

          <h3 className="pt-2 font-semibold">Limits</h3>
          <p>
            Each limit is a count per minute. A <code>429</code> carries <code>Retry-After</code>,
            in seconds, with <code>X-RateLimit-Limit</code>, <code>X-RateLimit-Remaining</code> and{' '}
            <code>X-RateLimit-Reset</code>.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th className="py-1 pr-4">What</th>
                  <th className="py-1 pr-4">Per minute</th>
                  <th className="py-1">Counted</th>
                </tr>
              </thead>
              <tbody>
                {rateLimits(isQuickScanEnabled()).map(([what, perMinute, keyedOn]) => (
                  <tr key={what} className="border-t align-top">
                    <td className="py-1 pr-4">
                      <Prose>{what}</Prose>
                    </td>
                    <td className="py-1 pr-4 font-mono">{perMinute}</td>
                    <td className="py-1">{keyedOn}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Copy is reviewed up to {MAX_CONTENT_CHARS.toLocaleString('en-GB')} characters; longer is
            refused rather than cut.
          </p>

          <h3 className="pt-2 font-semibold">HEAD, OPTIONS and conditional requests</h3>
          <p>
            Every <code>GET</code> also answers <code>HEAD</code>, and every route answers{' '}
            <code>OPTIONS</code>; the reference does not list either. A <code>GET</code> that sends
            an <code>ETag</code> takes it back as <code>If-None-Match</code> and answers{' '}
            <code>304</code> with no body when nothing has changed: the frameworks routes and the
            API description do.
          </p>
        </section>

        <section id="recipes" className="scroll-mt-24 space-y-10">
          <h2 className="text-2xl font-semibold">Recipes</h2>
          {RECIPES.map((recipe) => (
            <article key={recipe.id} id={recipe.id} className="scroll-mt-24 space-y-3">
              <h3 className="text-lg font-semibold">{recipe.title}</h3>
              <p>
                <Prose>{recipe.intro}</Prose>
              </p>
              <p className="hd-slug">Key scope: {recipe.scope}</p>
              <CodeBlock>{curlFor(recipe)}</CodeBlock>
              <ul className="list-disc space-y-2 pl-5">
                {recipe.then.map((line) => (
                  <li key={line}>
                    <Prose>{line}</Prose>
                  </li>
                ))}
              </ul>
              {recipe.script ? (
                <CodeBlock label={recipe.script.name}>{recipe.script.body}</CodeBlock>
              ) : null}
            </article>
          ))}
        </section>

        <section id="webhooks" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold">Webhooks</h2>
          <p>
            Rather than asking a review again and again whether it has finished, give your workspace
            an address to tell. A workspace&rsquo;s owners and admins add one on{' '}
            <Link href={WEBHOOKS_PAGE_HREF} className="underline underline-offset-2">
              Webhooks
            </Link>
            , in its settings. Each time a review or a comparison finishes, the address is sent a
            signed <code>POST</code> saying which one and how it ended; read the rest from the API
            by its id.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th className="py-1 pr-4">Event</th>
                  <th className="py-1">Sent when</th>
                </tr>
              </thead>
              <tbody>
                {WEBHOOK_EVENTS.map(([event, sentWhen]) => (
                  <tr key={event} className="border-t align-top">
                    <td className="py-1 pr-4 font-mono text-xs">{event}</td>
                    <td className="py-1">
                      <Prose>{sentWhen}</Prose>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            One event per kind, at every way it can end, with the state in the body. A message holds
            ids, states and scores, never the copy:
          </p>
          <CodeBlock label="A review finished">{SAMPLE_BODY}</CodeBlock>
          <p>
            <code>app.comparison.finished</code> carries <code>comparisonId</code>,{' '}
            <code>status</code>, <code>projectId</code>, <code>verdict</code> and each draft&rsquo;s{' '}
            <code>position</code>, <code>assessmentId</code>, <code>status</code>,{' '}
            <code>overall</code> and <code>band</code>. A webhook limited to a project is sent only
            that project&rsquo;s work.
          </p>
          <h3 className="pt-2 font-semibold">Answering, and repeats</h3>
          <p>
            Answer with a <code>2xx</code> within 10 seconds, then do the work. Anything else is
            tried twice more, after 10 seconds and after a minute. A message can arrive more than
            once, so use <code>data.eventId</code> to ignore a repeat. The webhook&rsquo;s page
            lists its recent deliveries, with the answer your receiver gave each.
          </p>
          <h3 className="pt-2 font-semibold">Checking the signature</h3>
          <p>
            Each delivery carries <code>X-Sunrise-Timestamp</code> (Unix seconds) and{' '}
            <code>X-Sunrise-Signature: sha256=&lt;hex&gt;</code>, the HMAC-SHA256 of{' '}
            <code>&lt;timestamp&gt;.&lt;raw body&gt;</code> keyed with the webhook&rsquo;s secret.
            The secret is shown once, when the webhook is added or given a new one. Check the
            signature against the raw body, before you parse it, and refuse an old timestamp. After
            giving a webhook a new secret, accept both for a minute.
          </p>
          <CodeBlock label="verify.js">{VERIFY_SAMPLE}</CodeBlock>
          <p>
            In an Express receiver, read the body raw (
            <code>
              express.raw({'{'} type: &apos;application/json&apos; {'}'})
            </code>
            ), verify it, and answer before doing the work.
          </p>
        </section>

        <section id="reference" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold">Reference</h2>
          <p>
            Every route, generated from the schemas the server checks requests with. The same
            description is published as OpenAPI 3.1 at{' '}
            <a href={OPENAPI_PATH} className="font-mono underline underline-offset-2">
              {OPENAPI_PATH}
            </a>
            , for client generators and API tools.
          </p>
          <ApiReference document={document} />
        </section>
      </div>
    </div>
  );
}
