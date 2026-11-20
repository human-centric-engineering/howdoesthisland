'use client';

/**
 * The admin CopyCredits page's body (t-57): active workspaces with their
 * balance and what their monthly spending limit leaves, a search, and a form
 * to grant or adjust one workspace's credits with a reason.
 *
 * Reads nothing itself: the page passes what `GET /api/v1/admin/credits`
 * answered, and a change refreshes the page so the list re-reads. A change
 * that leaves the balance worth more than the limit leaves this month says
 * so, because the limit, not the credits, would then stop the workspace's
 * reviews first.
 */

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { CheckCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FieldHelp } from '@/components/ui/field-help';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { SaveError } from '@/components/forms/form-error';
import { apiClient } from '@/lib/api/client';
import { NO_SERVER_FIELDS, useSaveFailure } from '@/lib/hooks/use-save-failure';
import {
  ADMIN_CREDITS_ENDPOINT,
  creditChangeResultSchema,
  creditChangeSchema,
  MAX_CREDIT_REASON,
  MAX_SEARCH,
  type AdminCreditsList,
  type AdminWorkspaceCredits,
  type CreditChangeResult,
} from '@/lib/app/credits/wire';

const count = new Intl.NumberFormat('en-GB');
const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** The route a change posts to. */
export function creditEntriesEndpoint(orgId: string): string {
  return `${ADMIN_CREDITS_ENDPOINT}/${encodeURIComponent(orgId)}/entries`;
}

function capText(workspace: AdminWorkspaceCredits): string {
  if (!workspace.cap) return 'No limit';
  return `${dollars.format(workspace.cap.remainingUsd)} of ${dollars.format(workspace.cap.limitUsd)}`;
}

interface ChangeFormProps {
  workspace: AdminWorkspaceCredits;
  onDone: (result: CreditChangeResult) => void;
  onFailed: () => void;
  onCancel: () => void;
}

function ChangeForm({ workspace, onDone, onFailed, onCancel }: ChangeFormProps) {
  const [kind, setKind] = useState<'grant' | 'adjust'>('grant');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const save = useSaveFailure({
    fallback: 'The credits could not be changed. Try again in a moment.',
    fields: NO_SERVER_FIELDS,
  });

  const submit = async () => {
    const parsed = creditChangeSchema.safeParse({
      kind,
      amount: amount.trim() === '' ? Number.NaN : Number(amount),
      reason,
    });
    if (
      save.block(
        parsed.success
          ? []
          : parsed.error.issues.map((issue) => ({
              field: `credit-${String(issue.path[0] ?? 'amount')}`,
              message: issue.message,
            }))
      ) ||
      !parsed.success
    ) {
      return;
    }
    setSaving(true);
    try {
      const result = creditChangeResultSchema.parse(
        await apiClient.post<unknown>(creditEntriesEndpoint(workspace.orgId), {
          body: parsed.data,
        })
      );
      onDone(result);
    } catch (err) {
      save.report(err);
      // The change may have been saved although the answer failed: show the
      // real balance before anyone presses again.
      onFailed();
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      method="post"
      onSubmit={save.submit(async (e) => {
        e?.preventDefault();
        await submit();
      })}
      className="bg-muted/40 space-y-4 rounded-md border p-4"
      aria-label={`Change credits for ${workspace.name}`}
      noValidate
    >
      <div className="grid gap-4 sm:grid-cols-[10rem_10rem_1fr]">
        <div className="space-y-2">
          <Label htmlFor="credit-kind" className="flex items-center gap-1">
            Change{' '}
            <FieldHelp title="Grant or adjust">
              <p>
                A grant gives the workspace credits, for a pilot, a goodwill gesture or a purchase
                made outside the app.
              </p>
              <p className="mt-2">
                An adjustment corrects the balance up or down, for example credits granted to the
                wrong workspace. It can take the balance below zero.
              </p>
            </FieldHelp>
          </Label>
          <Select value={kind} onValueChange={(v) => setKind(v === 'adjust' ? 'adjust' : 'grant')}>
            <SelectTrigger id="credit-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="grant">Grant</SelectItem>
              <SelectItem value="adjust">Adjust</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="credit-amount" className="flex items-center gap-1">
            Credits{' '}
            <FieldHelp title="How many credits">
              <p>
                Whole credits. 100 credits is about $1 of AI cost, so a full review usually costs
                tens of credits.
              </p>
              <p className="mt-2">
                {kind === 'grant'
                  ? 'A grant is a positive number.'
                  : 'For an adjustment, a negative number takes credits away.'}
              </p>
            </FieldHelp>
          </Label>
          <Input
            id="credit-amount"
            name="credit-amount"
            type="number"
            inputMode="numeric"
            step={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="credit-reason" className="flex items-center gap-1">
            Reason{' '}
            <FieldHelp title="Why">
              <p>
                Recorded with the change, with your name, and shown to whoever reads the
                workspace&rsquo;s ledger. Say enough that someone else would understand it later.
              </p>
            </FieldHelp>
          </Label>
          <Input
            id="credit-reason"
            name="credit-reason"
            maxLength={MAX_CREDIT_REASON}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : kind === 'grant' ? 'Grant credits' : 'Adjust credits'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
      <SaveError failure={save.failure} />
    </form>
  );
}

export interface CreditsPanelProps {
  initial: AdminCreditsList;
  query: string;
}

export function CreditsPanel({ initial, query }: CreditsPanelProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState(query);
  const [open, setOpen] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string; result: CreditChangeResult } | null>(null);

  const runSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = search.trim();
    router.push(q ? `${pathname}?q=${encodeURIComponent(q)}` : pathname);
  };

  return (
    <div className="space-y-4">
      {/* form-method-ignore: a search box, whose query belongs in the URL */}
      <form role="search" onSubmit={runSearch} className="flex max-w-md items-end gap-2" noValidate>
        <div className="flex-1 space-y-2">
          <Label htmlFor="credit-search">Find a workspace</Label>
          <Input
            id="credit-search"
            placeholder="Name or slug"
            maxLength={MAX_SEARCH}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      {done ? (
        <div role="status" className="space-y-1 rounded-md border p-4 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
            {done.name} now has {count.format(done.result.balance)} credits.
          </p>
          {done.result.capWarning ? (
            <p className="text-muted-foreground">
              That is worth {dollars.format(done.result.capWarning.balanceUsd)}, more than the{' '}
              {dollars.format(done.result.capWarning.remainingUsd)} its monthly spending limit of{' '}
              {dollars.format(done.result.capWarning.limitUsd)} leaves this month. Its reviews will
              stop at the limit with credits unspent. Raise the limit on the workspace&rsquo;s admin
              page if it should spend them this month.
            </p>
          ) : null}
        </div>
      ) : null}

      {initial.workspaces.length === 0 ? (
        <p className="text-muted-foreground rounded-md border p-6 text-center text-sm">
          {query ? `No active workspace matches “${query}”.` : 'No active workspaces.'}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Workspace</TableHead>
              <TableHead className="text-right">Credits</TableHead>
              <TableHead className="text-right">
                <span className="inline-flex items-center gap-1">
                  Limit left this month{' '}
                  <FieldHelp title="The monthly spending limit">
                    <p>
                      A safety ceiling on what a workspace&rsquo;s AI can spend in a month, whatever
                      its credits. Credits are what it pays for reviews with; the limit stops it
                      spending more than this in any one month.
                    </p>
                  </FieldHelp>
                </span>
              </TableHead>
              <TableHead className="sr-only">Change</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initial.workspaces.map((workspace) => (
              <TableRow key={workspace.orgId} className="align-top">
                <TableCell>
                  <span className="font-medium">{workspace.name}</span>
                  <span className="text-muted-foreground block text-xs">{workspace.slug}</span>
                  {open === workspace.orgId ? (
                    <div className="mt-3">
                      <ChangeForm
                        workspace={workspace}
                        onCancel={() => setOpen(null)}
                        onFailed={() => router.refresh()}
                        onDone={(result) => {
                          setOpen(null);
                          setDone({ name: workspace.name, result });
                          router.refresh();
                        }}
                      />
                    </div>
                  ) : null}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {count.format(workspace.balance)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{capText(workspace)}</TableCell>
                <TableCell className="text-right">
                  {open === workspace.orgId ? null : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setDone(null);
                        setOpen(workspace.orgId);
                      }}
                    >
                      Change
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {initial.truncated ? (
        <p className="text-muted-foreground text-sm">
          More workspaces match than are listed. Search to narrow the list.
        </p>
      ) : null}
    </div>
  );
}
