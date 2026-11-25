/**
 * The invitation to write a project's brief (t-83): shown where a review or
 * a rewrite is about to run without one, on the `/assess` workbench and in
 * the report's rewrite drawer.
 *
 * It says what a brief adds, with an example, and links to where one is
 * written: the project's page, or the projects page for copy in no project.
 * It is an invitation, never a gate: nothing waits on it, and it offers no
 * way to dismiss it because there is nothing to dismiss.
 */
import Link from 'next/link';
import { WORDS } from '@/lib/app/reports/words';
/** Whether a brief says anything: any one of its parts written. */
export function hasBrief(brief: Readonly<Record<string, unknown>> | null | undefined): boolean {
  return Object.values(brief ?? {}).some((part) => typeof part === 'string' && part.trim() !== '');
}

/** Where the brief for `projectId` is written, or where a project is made for copy in none. */
export const briefHref = (projectId: string | null): string =>
  projectId ? `/projects/${encodeURIComponent(projectId)}` : '/projects';

export function BriefInvite({
  projectId,
  runs,
}: {
  /** The project with no brief, or `null` for copy in no project. */
  projectId: string | null;
  /** What runs without it: the sentence says it still does. */
  runs: 'review' | 'rewrite';
}) {
  const what = runs === 'review' ? `the ${WORDS.review}` : 'the rewrite';
  return (
    <aside
      aria-label="Add a brief"
      className="space-y-2 rounded-md border border-(--hd-rule) px-3 py-2 text-sm"
    >
      <p className="font-medium">
        {projectId
          ? 'This project has no brief yet'
          : 'This copy is in no project, so it has no brief'}
      </p>
      <p>
        A brief tells the editor and the {WORDS.aiReviewers} what you offer, who it is for and how
        you sound, in your own words. With one, a rewrite uses the facts you have given rather than
        leaving gaps for you to fill.
      </p>
      {!projectId && runs === 'rewrite' ? (
        <p>
          A {WORDS.review} stays outside a project once it has run, so this one&rsquo;s rewrites
          cannot use a brief. Make a project, write its brief, and {WORDS.review} the copy in it:
          that {WORDS.review}&rsquo;s rewrites will.
        </p>
      ) : null}
      <p className="text-(--hd-muted)">
        For example: &ldquo;Bookkeeping for sole traders, from &pound;20 a month. 300 clients across
        Yorkshire, most of them plumbers and electricians.&rdquo;
      </p>
      <p>
        <Link href={briefHref(projectId)} className="underline">
          {projectId ? 'Write the project’s brief' : 'Make a project with a brief'}
        </Link>{' '}
        <span className="text-(--hd-muted)">
          or carry on without one: {what} runs all the same.
        </span>
      </p>
    </aside>
  );
}
