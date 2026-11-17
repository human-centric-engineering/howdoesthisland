'use client';

/**
 * The framework versions and their calibration runs (t-38), with a run's
 * detail below the table it was picked from.
 *
 * Reads `GET /api/v1/admin/frameworks` (the page hands over the first read)
 * and starts runs with `POST …/calibration-runs`. While any run is running it
 * reads the list again every few seconds, so an AI run shows running until it
 * finishes. Never publishes: that is the CLI's.
 */
import { useCallback, useEffect, useState } from 'react';

import { SaveError } from '@/components/forms/form-error';
import { RunDetail } from '@/components/app/admin/frameworks/run-detail';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ClientDate } from '@/components/ui/client-date';
import { FieldHelp } from '@/components/ui/field-help';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { apiClient } from '@/lib/api/client';
import { NO_SERVER_FIELDS, useSaveFailure } from '@/lib/hooks/use-save-failure';
import {
  ADMIN_FRAMEWORKS_PATH,
  type AdminRunWire,
  type AdminVersionWire,
  type FrameworkCalibrationWire,
  frameworkCalibrationSchema,
  startedRunSchema,
} from '@/lib/app/calibration/wire';

const POLL_MS = 5000;

/** The kinds shown as columns, in the order the done-when names them. */
const KIND_COLUMNS = [
  ['appeal', 'Appeals'],
  ['group', 'Groups'],
  ['flag', 'Flags'],
  ['duty', 'Duties'],
] as const;

const STATUS_VARIANT: Record<AdminRunWire['status'], 'default' | 'secondary' | 'destructive'> = {
  running: 'secondary',
  complete: 'default',
  failed: 'destructive',
  stopped: 'destructive',
};

const pct = (x: number | null) => (x === null ? '–' : `${(x * 100).toFixed(1)}%`);

function Delta({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return null;
  const cls =
    value > 0
      ? 'text-emerald-700 dark:text-emerald-400'
      : value < 0
        ? 'text-red-700 dark:text-red-400'
        : 'text-muted-foreground';
  return (
    <span className={`text-xs ${cls}`}>
      {value === 0 ? '±0' : `${value > 0 ? '+' : ''}${(value * 100).toFixed(1)}`} pts
    </span>
  );
}

function KindCell({ run, kind }: { run: AdminRunWire; kind: (typeof KIND_COLUMNS)[number][0] }) {
  const tally = run.totals?.byKind[kind];
  if (!tally || tally.n === 0) return <TableCell className="text-muted-foreground">–</TableCell>;
  return (
    <TableCell className="whitespace-nowrap tabular-nums">
      <div>
        {pct(tally.ok / tally.n)}
        <span className="text-muted-foreground ml-1 text-xs">
          {tally.ok}/{tally.n}
        </span>
      </div>
      <Delta value={run.comparison?.byKind[kind].delta} />
    </TableCell>
  );
}

function SnapshotLine({ version }: { version: AdminVersionWire }) {
  if (version.calibration) {
    const c = version.calibration;
    return (
      <>
        Published on an AI run with {pct(c.agreement)} agreement over {c.checks} checks (set{' '}
        {c.setVersion}, run <span className="font-mono">{c.runId.slice(0, 8)}</span>).
      </>
    );
  }
  if (version.status === 'draft') return <>A draft: it publishes once it has a complete AI run.</>;
  return <>Published before the calibration gate, so it carries no snapshot.</>;
}

function VersionCard({
  slug,
  version,
  selectedRunId,
  onSelect,
  onStarted,
}: {
  /** The framework's slug, as the list gave it. */
  slug: string;
  version: AdminVersionWire;
  selectedRunId: string | null;
  onSelect: (id: string) => void;
  onStarted: (runId: string) => Promise<void>;
}) {
  const [pending, setPending] = useState<'quick' | 'ai' | null>(null);
  const save = useSaveFailure({
    fallback: 'The run could not be started.',
    fields: NO_SERVER_FIELDS,
  });
  const aiRunning = version.runs.some((r) => r.mode === 'ai' && r.status === 'running');

  const start = async (mode: 'quick' | 'ai') => {
    save.clear();
    setPending(mode);
    try {
      const started = startedRunSchema.parse(
        await apiClient.post<unknown>(
          `${ADMIN_FRAMEWORKS_PATH}/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version.version)}/calibration-runs`,
          { body: { mode } }
        )
      );
      await onStarted(started.runId);
    } catch (err) {
      save.report(err);
    } finally {
      setPending(null);
    }
  };

  const selected = version.runs.find((r) => r.id === selectedRunId) ?? null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-lg">
            {version.version}
            <Badge variant={version.status === 'draft' ? 'secondary' : 'outline'}>
              {version.status}
            </Badge>
          </CardTitle>
          <CardDescription>
            <SnapshotLine version={version} />
          </CardDescription>
        </div>
        {version.runnable ? (
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={pending !== null}
                onClick={() => void start('quick')}
              >
                {pending === 'quick' ? 'Running…' : 'Quick run'}
              </Button>
              <Button
                size="sm"
                disabled={pending !== null || aiRunning}
                onClick={() => void start('ai')}
              >
                {pending === 'ai' ? 'Starting…' : aiRunning ? 'AI run running' : 'AI run'}
              </Button>
              <FieldHelp title="Quick and AI runs">
                <p>
                  A <strong>quick run</strong> scores every case of the calibration set on the quick
                  scan alone. It is free and takes under a second, and two quick runs of one version
                  always agree.
                </p>
                <p className="mt-2">
                  An <strong>AI run</strong> puts every case through every judge (about 26 × 9
                  calls) against the install organisation&apos;s budget, and takes several minutes.
                  It finishes in the background and is recorded as started by you. A complete AI run
                  of a draft is what lets it publish; publishing is done from the command line.
                </p>
              </FieldHelp>
            </div>
            <SaveError failure={save.failure} />
          </div>
        ) : (
          <p className="text-muted-foreground max-w-xs text-right text-xs">
            No calibration set is written for this version, so it cannot be run here.
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {version.runs.length === 0 ? (
          <p className="text-muted-foreground text-sm">No runs yet.</p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Agreement</TableHead>
                  {KIND_COLUMNS.map(([kind, label]) => (
                    <TableHead key={kind}>{label}</TableHead>
                  ))}
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead>By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {version.runs.map((run) => (
                  <TableRow
                    key={run.id}
                    data-state={run.id === selectedRunId ? 'selected' : undefined}
                    className="cursor-pointer"
                    onClick={() => onSelect(run.id)}
                  >
                    <TableCell className="whitespace-nowrap">
                      <button
                        type="button"
                        className="text-left underline-offset-4 hover:underline"
                        aria-label={`Show this ${run.mode} run's cases`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelect(run.id);
                        }}
                      >
                        <ClientDate date={run.createdAt} showTime />
                      </button>
                      {!run.ofCurrentFile && (
                        <span className="text-muted-foreground block text-xs">
                          of an earlier import
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{run.mode}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[run.status]}>{run.status}</Badge>
                      {run.totals && run.totals.judgeFailures > 0 && (
                        <span className="block text-xs text-red-700 dark:text-red-400">
                          {run.totals.judgeFailures} judge call(s) failed
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      <div className="font-medium">
                        {run.totals ? pct(run.totals.agreement) : '–'}
                      </div>
                      <Delta value={run.comparison?.agreementDelta} />
                    </TableCell>
                    {KIND_COLUMNS.map(([kind]) => (
                      <KindCell key={kind} run={run} kind={kind} />
                    ))}
                    <TableCell className="text-right tabular-nums">
                      {/* A running run has not finished spending, and a stopped
                          one never recorded what it spent. */}
                      {run.mode === 'ai' && run.status !== 'running' && run.status !== 'stopped'
                        ? `$${run.costUsd.toFixed(2)}`
                        : '–'}
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      {run.startedBy?.name ?? 'CLI'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {selected && <RunDetail run={selected} />}
      </CardContent>
    </Card>
  );
}

export function CalibrationPanel({ initial }: { initial: FrameworkCalibrationWire }) {
  const [data, setData] = useState(initial);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [framework] = frameworkCalibrationSchema
      .array()
      .parse(await apiClient.get<unknown>(ADMIN_FRAMEWORKS_PATH));
    if (framework) setData(framework);
  }, []);

  const anyRunning = data.versions.some((v) => v.runs.some((r) => r.status === 'running'));
  useEffect(() => {
    if (!anyRunning) return;
    const timer = setInterval(() => {
      // A failed poll is tried again on the next tick.
      reload().catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [anyRunning, reload]);

  const onStarted = useCallback(
    async (runId: string) => {
      setSelectedRunId(runId);
      // The run started; a failed read of the list is not a failed start, and
      // the next poll (or a reload of the page) shows it.
      await reload().catch(() => undefined);
    },
    [reload]
  );

  if (data.versions.length === 0) {
    return (
      <p className="text-muted-foreground rounded-md border p-6 text-center text-sm">
        No version of {data.name} has been imported yet.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {data.versions.map((version) => (
        <VersionCard
          key={version.id}
          slug={data.slug}
          version={version}
          selectedRunId={selectedRunId}
          onSelect={setSelectedRunId}
          onStarted={onStarted}
        />
      ))}
    </div>
  );
}
