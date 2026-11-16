/**
 * One calibration run in full (t-38): what changed since the run before it,
 * and every case with its scored checks.
 *
 * Presentational: the run comes from `GET /api/v1/admin/frameworks`.
 */
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ClientDate } from '@/components/ui/client-date';
import type { AdminRunWire } from '@/lib/app/calibration/wire';

type Outcome = 'ok' | 'near' | 'miss';

const OUTCOME_CLASS: Record<Outcome, string> = {
  ok: 'text-emerald-700 dark:text-emerald-400',
  near: 'text-amber-700 dark:text-amber-400',
  miss: 'text-red-700 dark:text-red-400',
};

function OutcomeText({ outcome }: { outcome: Outcome }) {
  return <span className={OUTCOME_CLASS[outcome]}>{outcome}</span>;
}

export function RunDetail({ run }: { run: AdminRunWire }) {
  if (run.status !== 'complete' || !run.rows) {
    return (
      <p className="text-muted-foreground text-sm">
        {run.status === 'failed'
          ? `This run failed: ${run.error ?? 'no reason was recorded.'}`
          : run.status === 'stopped'
            ? 'This run stopped before it finished, and has no results.'
            : 'This run is still running. Its cases appear here when it finishes.'}
      </p>
    );
  }

  const comparison = run.comparison;
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h4 className="text-sm font-semibold">Changed since the run before</h4>
        {!comparison ? (
          <p className="text-muted-foreground text-sm">
            No earlier {run.mode} run to compare with.
          </p>
        ) : (
          <>
            <p className="text-muted-foreground text-sm">
              Against the {run.mode} run of {comparison.previousFrameworkVersion} on{' '}
              <ClientDate date={comparison.previousRanAt} showTime />:{' '}
              {comparison.flips.length === 0
                ? 'no check changed.'
                : `${comparison.flips.length} check(s) changed, worse ones first.`}
            </p>
            {comparison.flips.length > 0 && (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Case</TableHead>
                      <TableHead>Kind</TableHead>
                      <TableHead>Check</TableHead>
                      <TableHead>Was</TableHead>
                      <TableHead>Now</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {comparison.flips.map((f) => (
                      <TableRow key={`${f.case}-${f.kind}-${f.key}`}>
                        <TableCell className="font-mono text-xs">{f.case}</TableCell>
                        <TableCell>{f.kind}</TableCell>
                        <TableCell className="font-mono text-xs">{f.key}</TableCell>
                        <TableCell>
                          <OutcomeText outcome={f.from} />
                        </TableCell>
                        <TableCell>
                          <OutcomeText outcome={f.to} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold">Cases</h4>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Case</TableHead>
                <TableHead className="text-right">ok</TableHead>
                <TableHead className="text-right">near</TableHead>
                <TableHead className="text-right">miss</TableHead>
                <TableHead>Misses and near misses</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {run.rows.map((row) => {
                const count = (o: Outcome) => row.checks.filter((c) => c.result === o).length;
                const off = row.checks.filter((c) => c.result !== 'ok');
                return (
                  <TableRow key={row.case} className="align-top">
                    <TableCell className="font-mono text-xs">{row.case}</TableCell>
                    <TableCell className="text-right tabular-nums">{count('ok')}</TableCell>
                    <TableCell className="text-right tabular-nums">{count('near')}</TableCell>
                    <TableCell className="text-right tabular-nums">{count('miss')}</TableCell>
                    <TableCell className="space-y-1 text-xs">
                      {off.length === 0 && row.judgeFailures.length === 0 && (
                        <span className="text-muted-foreground">Every check agreed.</span>
                      )}
                      {off.map((c) => (
                        <div key={`${c.kind}-${c.key}`}>
                          <OutcomeText outcome={c.result} /> {c.kind}{' '}
                          <span className="font-mono">{c.key}</span>: expected {c.expected}, got{' '}
                          {c.got === null ? 'nothing' : String(c.got)}
                        </div>
                      ))}
                      {row.judgeFailures.map((f) => (
                        <div key={f.slot}>
                          <Badge variant="destructive">judge failed</Badge>{' '}
                          <span className="font-mono">{f.slot}</span> ({f.code})
                        </div>
                      ))}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
