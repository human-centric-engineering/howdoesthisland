'use client';

/**
 * Sharing a report by link (t-32): make a link, copy it, revoke one.
 *
 * A dialog off the report's actions. Opening it reads the report's links
 * (`GET /api/v1/assessments/{id}/shares`, one call for the whole list). A
 * new link's address is shown once, here, because only its hash is kept:
 * closing the dialog loses it, and the list says so.
 *
 * A failed make or revoke shows by the button that was pressed
 * (`<SaveError>`), the one way every form here shows a failed save.
 */

import { useCallback, useReducer, useState } from 'react';
import { Check, Copy, Link2, Loader2 } from 'lucide-react';
import { z } from 'zod';
import { apiClient } from '@/lib/api/client';
import { useSaveFailure } from '@/lib/hooks/use-save-failure';
import {
  createdReportShareSchema,
  DEFAULT_SHARE_DAYS,
  reportShareSchema,
  type ReportShareWire,
} from '@/lib/app/reports/share/validations';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { FieldHelp } from '@/components/ui/field-help';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SaveError } from '@/components/forms/form-error';

/** The report's links (`GET`, `POST`). */
export const reportSharesPath = (assessmentId: string): string =>
  `/api/v1/assessments/${encodeURIComponent(assessmentId)}/shares`;

/** One link (`DELETE` revokes it). */
export const sharePath = (shareId: string): string =>
  `/api/v1/shares/${encodeURIComponent(shareId)}`;

/** The lifetimes offered, in days. The API takes any from 1 to 365. */
export const SHARE_LIFETIMES = [7, DEFAULT_SHARE_DAYS, 90] as const;

const STATE_LABEL: Record<ReportShareWire['state'], string> = {
  active: 'Active',
  expired: 'Expired',
  revoked: 'Revoked',
};

const sharesSchema = z.array(reportShareSchema);

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * The list, and what has changed since the latest load began. A load's
 * answer may predate a make or revoke made while it was in flight, so those
 * are laid over it rather than wiped by it; an older load's answer is dropped.
 */
interface SharesState {
  /** The list, or `null` until a load lands: a part-list is never shown as whole. */
  shares: ReportShareWire[] | null;
  /** This opening of the dialog, or `null` while it is closed. */
  session: symbol | null;
  /** The link made in this opening, whose address is shown once. */
  made: { id: string; url: string } | null;
  /** The latest load, by the token its caller made. */
  loading: symbol | null;
  /** Links made or revoked since that load began, in the order they changed. */
  touched: ReadonlyMap<string, ReportShareWire>;
}

type SharesAction =
  | { type: 'open'; session: symbol }
  | { type: 'close' }
  | { type: 'load'; id: symbol }
  | { type: 'loaded'; id: symbol; list: ReportShareWire[] }
  | { type: 'made'; share: ReportShareWire; url: string; session: symbol | null }
  | { type: 'revoked'; share: ReportShareWire };

function sharesReducer(state: SharesState, action: SharesAction): SharesState {
  switch (action.type) {
    case 'open':
      return { ...state, session: action.session, made: null };
    case 'close':
      // The address is shown once: closing the dialog lets it go.
      return { ...state, session: null, made: null };
    case 'load':
      // The last list may be stale by now (revoked elsewhere, expired), so
      // it is not shown while the new one loads.
      return { ...state, shares: null, loading: action.id, touched: new Map() };
    case 'loaded': {
      if (action.id !== state.loading) return state;
      const listed = new Set(action.list.map((s) => s.id));
      const added = [...state.touched.values()].filter((s) => !listed.has(s.id)).reverse();
      const shares = [...added, ...action.list.map((s) => state.touched.get(s.id) ?? s)];
      return { ...state, shares, loading: null };
    }
    case 'made':
      return {
        ...state,
        shares: state.shares && [action.share, ...state.shares],
        touched: new Map(state.touched).set(action.share.id, action.share),
        // Made in an opening since closed: its address is not brought back.
        made:
          action.session !== null && action.session === state.session
            ? { id: action.share.id, url: action.url }
            : state.made,
      };
    case 'revoked':
      return {
        ...state,
        shares:
          state.shares && state.shares.map((s) => (s.id === action.share.id ? action.share : s)),
        touched: new Map(state.touched).set(action.share.id, action.share),
        made: state.made?.id === action.share.id ? null : state.made,
      };
  }
}

export function SharePanel({ assessmentId }: { assessmentId: string }) {
  const [open, setOpen] = useState(false);
  const [{ shares, session, made }, dispatch] = useReducer(sharesReducer, {
    shares: null,
    session: null,
    made: null,
    loading: null,
    touched: new Map(),
  });
  const [days, setDays] = useState<string>(String(DEFAULT_SHARE_DAYS));
  const [copied, setCopied] = useState(false);
  /** What is in flight: `'make'`, or the id of the link being revoked. */
  const [busy, setBusy] = useState<string | null>(null);
  const make = useSaveFailure({ fallback: 'The link could not be made. Try again.' });
  const revoke = useSaveFailure({ fallback: 'The link could not be revoked. Try again.' });
  const load = useSaveFailure({ fallback: "This report's links could not be loaded." });

  const loadShares = useCallback(async () => {
    const id = Symbol('load');
    dispatch({ type: 'load', id });
    try {
      const list = sharesSchema.parse(await apiClient.get<unknown>(reportSharesPath(assessmentId)));
      dispatch({ type: 'loaded', id, list });
    } catch (err) {
      load.report(err);
    }
    // `load` is a new object each render; its `report` is what matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assessmentId]);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      dispatch({ type: 'open', session: Symbol('open') });
      load.clear();
      void loadShares();
    } else {
      dispatch({ type: 'close' });
      setCopied(false);
      make.clear();
      revoke.clear();
    }
  };

  const onMake = make.submit(async (e) => {
    e?.preventDefault();
    setBusy('make');
    setCopied(false);
    try {
      const share = createdReportShareSchema.parse(
        await apiClient.post<unknown>(reportSharesPath(assessmentId), {
          body: { expiresInDays: Number(days) },
        })
      );
      // Into the list as the list reads it: the token stays out of it.
      const view: ReportShareWire = reportShareSchema.parse(share);
      dispatch({ type: 'made', share: view, url: share.url, session });
    } catch (err) {
      make.report(err);
    } finally {
      setBusy(null);
    }
  });

  const onRevoke = (shareId: string) =>
    revoke.submit(async () => {
      setBusy(shareId);
      try {
        const next = reportShareSchema.parse(await apiClient.delete<unknown>(sharePath(shareId)));
        dispatch({ type: 'revoked', share: next });
      } catch (err) {
        revoke.report(err, "Couldn't revoke the link");
      } finally {
        setBusy(null);
      }
    });

  const onCopy = async () => {
    if (!made) return;
    try {
      await navigator.clipboard.writeText(made.url);
      setCopied(true);
    } catch {
      // No clipboard (an insecure origin, a denied permission): the address
      // is selected in its box for the reader to copy by hand.
      document.getElementById('share-link-url')?.focus();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Link2 aria-hidden="true" />
          Share
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share this report</DialogTitle>
          <DialogDescription>
            Anyone with the link can read the report without an account, until it expires or you
            revoke it. It does not show the workspace, who ran the review, or what it cost.
          </DialogDescription>
        </DialogHeader>

        <form method="post" onSubmit={onMake} className="space-y-3" noValidate>
          <div className="space-y-2">
            {/* The ⓘ sits beside the label, not in it, so the select is named "Link works for". */}
            <div className="flex items-center gap-1">
              <Label htmlFor="share-lifetime">Link works for</Label>
              <FieldHelp title="How long a link works">
                <p>
                  After this the link opens nothing, as if it had been revoked. Make a new one if it
                  is still needed.
                </p>
                <p className="mt-2">
                  Revoking stops a link at once, so a short life matters most for a link you might
                  forget about.
                </p>
              </FieldHelp>
            </div>
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger id="share-lifetime" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SHARE_LIFETIMES.map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {d} days
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={busy !== null}>
            {busy === 'make' ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <Link2 aria-hidden="true" />
            )}
            Make a link
          </Button>
          <SaveError failure={make.failure} />
        </form>

        {made ? (
          <div className="space-y-2" role="status">
            <Label htmlFor="share-link-url">New link</Label>
            <div className="flex gap-2">
              <Input
                id="share-link-url"
                readOnly
                value={made.url}
                onFocus={(e) => e.currentTarget.select()}
                className="font-mono text-xs md:text-xs"
              />
              <Button type="button" variant="outline" size="sm" onClick={() => void onCopy()}>
                {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <p className="text-sm text-(--hd-muted)">
              Copy it now: it is shown only once. You can revoke it below.
            </p>
          </div>
        ) : null}

        <div className="space-y-2">
          <h3 className="font-mono text-xs text-(--hd-muted) uppercase">Links to this report</h3>
          <SaveError failure={load.failure} />
          {shares === null ? (
            load.failure ? null : (
              <p className="text-sm text-(--hd-muted)">Loading…</p>
            )
          ) : shares.length === 0 ? (
            <p className="text-sm text-(--hd-muted)">No links yet.</p>
          ) : (
            <ul className="grid gap-2 text-sm">
              {shares.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3">
                  <span>
                    <b>{STATE_LABEL[s.state]}</b>
                    {' · '}
                    {s.state === 'revoked' && s.revokedAt
                      ? `revoked ${formatDate(s.revokedAt)}`
                      : `${s.state === 'expired' ? 'expired' : 'expires'} ${formatDate(s.expiresAt)}`}
                    {' · '}
                    {s.viewCount === 1 ? '1 view' : `${s.viewCount} views`}
                  </span>
                  {s.state === 'active' ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy !== null}
                      onClick={onRevoke(s.id)}
                    >
                      {busy === s.id ? (
                        <Loader2 className="animate-spin" aria-hidden="true" />
                      ) : null}
                      Revoke
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <SaveError failure={revoke.failure} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
