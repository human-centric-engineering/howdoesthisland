'use client';

/**
 * The admin review codes page's body (t-59): a form to make codes, and the
 * codes with what is used and left of each, their QR, and revoking one.
 *
 * Reads nothing itself: the page passes what `GET /api/v1/admin/codes`
 * answered, and a change refreshes the page so the list re-reads.
 *
 * **One mint per form, however often Save is pressed.** The form carries an
 * idempotency key, drawn afresh only once a mint succeeds, so a retry after
 * an answer that failed (the codes may have been made) answers with the same
 * codes rather than minting more.
 */

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { CheckCircle } from 'lucide-react';

import { CodeQr } from '@/components/app/admin/codes/code-qr';
import { SaveError } from '@/components/forms/form-error';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { FieldHelp } from '@/components/ui/field-help';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { formatCode } from '@/lib/app/credits/codes/generate';
import {
  ADMIN_CODES_ENDPOINT,
  issueCodesSchema,
  issuedCodesSchema,
  MAX_BATCH,
  MAX_CAMPAIGN,
  MAX_CODE_SEARCH,
  reviewCodeSchema,
  type AdminCodesList,
  type CodeStatus,
  type IssuedCodes,
  type ReviewCodeView,
} from '@/lib/app/credits/codes/wire';

const count = new Intl.NumberFormat('en-GB');
// UTC, so the server's render and the browser's agree.
const day = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });

const STATUS_TEXT: Record<CodeStatus, string> = {
  active: 'Active',
  'used-up': 'Used up',
  expired: 'Expired',
  revoked: 'Revoked',
};

/** The route that revokes a code. */
export function codeEndpoint(id: string): string {
  return `${ADMIN_CODES_ENDPOINT}/${encodeURIComponent(id)}`;
}

/** A date field's day as the moment it ends, in UTC: a code lasts the whole of its last day. */
export function endOfDay(date: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T23:59:59.999Z` : '';
}

const numberOrNaN = (value: string) => (value.trim() === '' ? Number.NaN : Number(value));

function CreateForm({
  defaultExpiry,
  minExpiry,
  maxExpiry,
  onDone,
}: {
  defaultExpiry: string;
  minExpiry: string;
  maxExpiry: string;
  onDone: (result: IssuedCodes) => void;
}) {
  const router = useRouter();
  const [howMany, setHowMany] = useState('1');
  const [credits, setCredits] = useState('');
  const [uses, setUses] = useState('1');
  const [expires, setExpires] = useState(defaultExpiry);
  const [campaign, setCampaign] = useState('');
  const [key, setKey] = useState(() => crypto.randomUUID());
  // A changed field is a different request: it gets a key of its own, or a
  // mint whose answer was lost would refuse every later Save with 409.
  const edit = (set: (value: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    set(e.target.value);
    setKey(crypto.randomUUID());
  };
  const [saving, setSaving] = useState(false);
  const save = useSaveFailure({
    fallback: 'The codes could not be made. Try again in a moment: a retry will not make more.',
    fields: NO_SERVER_FIELDS,
  });

  const submit = async () => {
    const parsed = issueCodesSchema.safeParse({
      count: numberOrNaN(howMany),
      creditsPerRedemption: numberOrNaN(credits),
      maxRedemptions: numberOrNaN(uses),
      expiresAt: endOfDay(expires),
      campaign,
      idempotencyKey: key,
    });
    if (
      save.block(
        parsed.success
          ? []
          : parsed.error.issues.map((issue) => ({
              field: `code-${String(issue.path[0] ?? 'count')}`,
              message: issue.message,
            }))
      ) ||
      !parsed.success
    ) {
      return;
    }
    setSaving(true);
    try {
      const result = issuedCodesSchema.parse(
        await apiClient.post<unknown>(ADMIN_CODES_ENDPOINT, { body: parsed.data })
      );
      setKey(crypto.randomUUID());
      onDone(result);
    } catch (err) {
      save.report(err);
      // The codes may have been made although the answer failed: show them.
      router.refresh();
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
      className="space-y-4 rounded-md border p-4"
      aria-label="Make review codes"
      noValidate
    >
      <h2 className="font-medium">Make codes</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="space-y-2 lg:col-span-2">
          <Label htmlFor="code-campaign" className="flex items-center gap-1">
            Campaign{' '}
            <FieldHelp title="What the codes are for">
              <p>
                A label for where these codes are going: an event, a card run, a representative or a
                lead-gen flow. It is shown in the list, and you can search by it.
              </p>
              <p className="mt-2">Whoever redeems a code does not see it.</p>
            </FieldHelp>
          </Label>
          <Input
            id="code-campaign"
            name="code-campaign"
            maxLength={MAX_CAMPAIGN}
            placeholder="e.g. Content Marketing World 2027"
            value={campaign}
            onChange={edit(setCampaign)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="code-creditsPerRedemption" className="flex items-center gap-1">
            Credits each use{' '}
            <FieldHelp title="Credits per redemption">
              <p>
                The CopyCredits a workspace gets each time someone redeems the code. 100 credits is
                about $1 of AI cost.
              </p>
              <p className="mt-2">
                For a free review, give enough for one full review by the AI reviewers, with a
                little to spare: a review is charged for what it actually spent.
              </p>
            </FieldHelp>
          </Label>
          <Input
            id="code-creditsPerRedemption"
            name="code-creditsPerRedemption"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={credits}
            onChange={edit(setCredits)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="code-maxRedemptions" className="flex items-center gap-1">
            Uses per code{' '}
            <FieldHelp title="Maximum redemptions">
              <p>
                How many times one code can be redeemed. <strong>1</strong> for a personal code
                handed to one person.
              </p>
              <p className="mt-2">
                More for a QR card that several people will scan, such as a card on an event stand:
                each person who redeems it uses one, until none are left.
              </p>
            </FieldHelp>
          </Label>
          <Input
            id="code-maxRedemptions"
            name="code-maxRedemptions"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={uses}
            onChange={edit(setUses)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="code-count" className="flex items-center gap-1">
            How many codes{' '}
            <FieldHelp title="How many codes">
              <p>
                How many separate codes to make, all alike. Make one for a QR card, or a batch of
                personal codes for a representative to hand out, one each.
              </p>
              <p className="mt-2">At most {MAX_BATCH} at a time.</p>
            </FieldHelp>
          </Label>
          <Input
            id="code-count"
            name="code-count"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_BATCH}
            step={1}
            value={howMany}
            onChange={edit(setHowMany)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="code-expiresAt" className="flex items-center gap-1">
            Expires{' '}
            <FieldHelp title="When the codes stop working">
              <p>
                The codes work until the end of this day (UTC), then can no longer be redeemed.
                Credits already given stay given.
              </p>
              <p className="mt-2">
                Printed cards outlive their event, so give them an end. At most three years ahead.
              </p>
            </FieldHelp>
          </Label>
          <Input
            id="code-expiresAt"
            name="code-expiresAt"
            type="date"
            min={minExpiry}
            max={maxExpiry}
            value={expires}
            onChange={edit(setExpires)}
          />
        </div>
      </div>
      <Button type="submit" disabled={saving}>
        {saving ? 'Making…' : 'Make codes'}
      </Button>
      <SaveError failure={save.failure} />
    </form>
  );
}

function RevokeButton({ code, onRevoked }: { code: ReviewCodeView; onRevoked: () => void }) {
  const [busy, setBusy] = useState(false);
  const save = useSaveFailure({
    fallback: 'The code could not be revoked. Try again in a moment.',
    fields: NO_SERVER_FIELDS,
  });

  const revoke = async () => {
    setBusy(true);
    try {
      reviewCodeSchema.parse(await apiClient.delete<unknown>(codeEndpoint(code.id)));
      onRevoked();
    } catch (err) {
      save.report(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button type="button" size="sm" variant="outline" disabled={busy}>
            {busy ? 'Revoking…' : 'Revoke'}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke {formatCode(code.code)}?</AlertDialogTitle>
            <AlertDialogDescription>
              Nobody will be able to redeem it again, and a printed QR of it will stop working.
              Credits it already gave stay given. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => void revoke()}>Revoke</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <SaveError failure={save.failure} />
    </div>
  );
}

export interface CodesPanelProps {
  initial: AdminCodesList;
  query: string;
  /** The expiry date field's first value, `YYYY-MM-DD`. */
  defaultExpiry: string;
  /** The earliest and latest days the date field offers, `YYYY-MM-DD` (today and three years ahead). */
  minExpiry: string;
  maxExpiry: string;
}

export function CodesPanel({
  initial,
  query,
  defaultExpiry,
  minExpiry,
  maxExpiry,
}: CodesPanelProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState(query);
  const [open, setOpen] = useState<string | null>(null);
  const [made, setMade] = useState<IssuedCodes | null>(null);

  const runSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = search.trim();
    router.push(q ? `${pathname}?q=${encodeURIComponent(q)}` : pathname);
  };

  return (
    <div className="space-y-6">
      <CreateForm
        defaultExpiry={defaultExpiry}
        minExpiry={minExpiry}
        maxExpiry={maxExpiry}
        onDone={(result) => {
          setMade(result);
          router.refresh();
        }}
      />

      {made ? (
        <div role="status" className="space-y-2 rounded-md border p-4 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
            {made.replayed
              ? 'These codes were already made by this form; nothing new was made.'
              : made.codes.length === 1
                ? 'Made 1 code.'
                : `Made ${count.format(made.codes.length)} codes.`}
          </p>
          <ul className="font-mono">
            {made.codes.map((code) => (
              <li key={code.id}>{formatCode(code.code)}</li>
            ))}
          </ul>
          <p className="text-muted-foreground">Each one&rsquo;s link and QR are in the list.</p>
        </div>
      ) : null}

      {/* form-method-ignore: a search box, whose query belongs in the URL */}
      <form role="search" onSubmit={runSearch} className="flex max-w-md items-end gap-2" noValidate>
        <div className="flex-1 space-y-2">
          <Label htmlFor="code-search">Find codes</Label>
          <Input
            id="code-search"
            placeholder="Campaign or code"
            maxLength={MAX_CODE_SEARCH}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      {initial.codes.length === 0 ? (
        <p className="text-muted-foreground rounded-md border p-6 text-center text-sm">
          {query ? `No code matches “${query}”.` : 'No codes yet.'}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead className="text-right">Credits each</TableHead>
              <TableHead className="text-right">Used</TableHead>
              <TableHead className="text-right">Left</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="sr-only">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initial.codes.map((code) => (
              <TableRow key={code.id} className="align-top">
                <TableCell>
                  <span className="font-mono font-medium">{formatCode(code.code)}</span>
                  <span className="text-muted-foreground block text-xs">{code.campaign}</span>
                  {open === code.id ? (
                    <div className="mt-3">
                      <CodeQr code={code} />
                    </div>
                  ) : null}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {count.format(code.creditsPerRedemption)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {count.format(code.redemptionsUsed)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {count.format(code.redemptionsLeft)}
                </TableCell>
                <TableCell>{day.format(new Date(code.expiresAt))}</TableCell>
                <TableCell>{STATUS_TEXT[code.status]}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      aria-expanded={open === code.id}
                      onClick={() => setOpen(open === code.id ? null : code.id)}
                    >
                      {open === code.id ? 'Hide QR' : 'QR and link'}
                    </Button>
                    {code.status === 'revoked' ? null : (
                      <RevokeButton code={code} onRevoked={() => router.refresh()} />
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {initial.truncated ? (
        <p className="text-muted-foreground text-sm">
          More codes match than are listed. Search to narrow the list.
        </p>
      ) : null}
    </div>
  );
}
