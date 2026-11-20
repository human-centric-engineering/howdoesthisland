/**
 * The workspace's usage this month (t-48): its budget, its totals and the
 * breakdown by project, as `GET /api/v1/usage` answers them. A server
 * component: it only renders figures.
 *
 * The budget has three states: none set, within it (a meter and what is
 * left), and reached (AI reviewers are refused until the month turns).
 */
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { WORDS } from '@/lib/app/reports/words';
import type { MonthUsage, UsageLine } from '@/lib/app/usage/wire';

const monthName = new Intl.DateTimeFormat('en-GB', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const dayName = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});
const count = new Intl.NumberFormat('en-GB');
const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/**
 * Dollars to the cent, as a budget is read; a figure under a cent that is not
 * zero says so rather than rounding to `$0.00`. (The platform's `formatUsd`
 * shows four places below a dollar, for comparing single chat turns.)
 */
export function formatUsd(value: number): string {
  if (value > 0 && value < 0.01) return 'under $0.01';
  return dollars.format(value);
}

/** The calls column and tile. */
const CALLS = 'AI reviewer calls';

/** What a line is called on the page. */
export function lineLabel(line: UsageLine): string {
  switch (line.kind) {
    case 'project':
      return `Project ${line.projectId ?? ''}`.trim();
    case 'no-project':
      return 'Not in a project';
    case 'kept-nowhere':
      return `${WORDS.Review}s kept nowhere`;
    case 'other':
      return 'Other AI use';
  }
}

/** What a line holds, where its name does not say. */
function lineNote(line: UsageLine): string | null {
  switch (line.kind) {
    case 'kept-nowhere':
      return 'Run through the API with store: false. Only their cost is kept.';
    case 'other':
      return `Deleted ${WORDS.review}s, and AI use that is not a ${WORDS.review}.`;
    default:
      return null;
  }
}

function Budget({ usage }: { usage: MonthUsage }) {
  const { cap } = usage;
  const resets = dayName.format(new Date(usage.month.end));

  if (!cap) {
    return (
      <section aria-labelledby="usage-budget" className="rounded-md border p-5">
        <h2 id="usage-budget" className="font-semibold">
          No monthly budget
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          This workspace has no AI budget set, so {WORDS.aiReviewers} are not held to a limit. Spend
          so far: {formatUsd(usage.spendUsd)}.
        </p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="usage-budget"
      className={
        cap.exceeded
          ? 'border-destructive bg-destructive/5 rounded-md border p-5'
          : 'rounded-md border p-5'
      }
    >
      <h2 id="usage-budget" className="font-semibold">
        {cap.exceeded ? 'Budget reached' : 'Monthly budget'}
      </h2>
      <p className="mt-1 text-sm">
        {formatUsd(usage.spendUsd)} of {formatUsd(cap.limitUsd)} spent
        {cap.exceeded ? '.' : ` · ${formatUsd(cap.remainingUsd)} left.`}
      </p>
      {/* A $0 budget has no range to show: no AI reviewer may run at all. */}
      {cap.limitUsd > 0 ? (
        <div
          role="meter"
          aria-label="Budget used"
          aria-valuemin={0}
          aria-valuemax={cap.limitUsd}
          aria-valuenow={Math.min(usage.spendUsd, cap.limitUsd)}
          aria-valuetext={`${formatUsd(usage.spendUsd)} of ${formatUsd(cap.limitUsd)}`}
          className="bg-muted mt-3 h-2 w-full overflow-hidden rounded-full"
        >
          <div
            className={cap.exceeded ? 'bg-destructive h-full' : 'bg-primary h-full'}
            style={{ width: `${Math.min(1, usage.spendUsd / cap.limitUsd) * 100}%` }}
          />
        </div>
      ) : null}
      <p className="text-muted-foreground mt-3 text-sm">
        {cap.exceeded
          ? `${WORDS.AiReviewers} are refused until ${resets}, when the budget starts again. The quick scan still runs. A platform admin can raise the budget.`
          : `The budget starts again on ${resets}.`}
      </p>
    </section>
  );
}

export function UsageSummary({ usage }: { usage: MonthUsage }) {
  const month = monthName.format(new Date(usage.month.start));

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <p className="hd-slug">Usage</p>
        <h1 className="text-2xl font-bold">{month}</h1>
        <p className="text-muted-foreground">
          This workspace&rsquo;s {WORDS.review}s and AI spend this month, counted in UTC.
        </p>
      </div>

      <Budget usage={usage} />

      <dl className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-md border p-4">
          <dt className="text-muted-foreground text-sm">{WORDS.Review}s</dt>
          <dd className="mt-1 text-2xl font-semibold">{count.format(usage.reviews)}</dd>
        </div>
        <div className="rounded-md border p-4">
          <dt className="text-muted-foreground text-sm">{CALLS}</dt>
          <dd className="mt-1 text-2xl font-semibold">{count.format(usage.calls)}</dd>
        </div>
        <div className="rounded-md border p-4">
          <dt className="text-muted-foreground text-sm">Spend</dt>
          <dd className="mt-1 text-2xl font-semibold">{formatUsd(usage.spendUsd)}</dd>
        </div>
      </dl>

      <section aria-labelledby="usage-breakdown" className="space-y-3">
        <h2 id="usage-breakdown" className="font-semibold">
          By project
        </h2>
        {usage.lines.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nothing yet this month. {WORDS.Review}s and their cost appear here once one runs.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Where</TableHead>
                <TableHead className="text-right">{WORDS.Review}s</TableHead>
                <TableHead className="text-right">{CALLS}</TableHead>
                <TableHead className="text-right">Spend</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usage.lines.map((line) => {
                const note = lineNote(line);
                return (
                  <TableRow key={`${line.kind}:${line.projectId ?? ''}`}>
                    <TableCell className="font-medium">
                      {lineLabel(line)}
                      {note ? (
                        <span className="text-muted-foreground block text-xs font-normal">
                          {note}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right">{count.format(line.reviews)}</TableCell>
                    <TableCell className="text-right">{count.format(line.calls)}</TableCell>
                    <TableCell className="text-right">{formatUsd(line.spendUsd)}</TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="font-semibold">
                <TableCell>Total</TableCell>
                <TableCell className="text-right">{count.format(usage.reviews)}</TableCell>
                <TableCell className="text-right">{count.format(usage.calls)}</TableCell>
                <TableCell className="text-right">{formatUsd(usage.spendUsd)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
