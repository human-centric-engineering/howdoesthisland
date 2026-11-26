'use client';

/**
 * Rewriting a review's copy from its report (t-82, `.context/app/rewrites.md`).
 *
 * A drawer off the report's actions. The writer picks a focus (balanced, or
 * one appeal) and the editor's draft streams in as it is written
 * (`POST /api/v1/rewrites`, `stream: true`). A finished draft can be copied,
 * or reviewed beside its original as a comparison (t-84), which then opens
 * (`/compare/[id]`).
 *
 * **Review this draft** compares the draft with the review it was rewritten
 * from (`POST /api/v1/comparisons`): the draft is reviewed with the
 * original's model version, reader context, project and AI reviewers, and the
 * original joins by its review, so it is not reviewed or charged again. When
 * that review no longer compares (its project's settings changed since),
 * the refusal offers **Review both again**, which reviews the original's copy
 * beside the draft, charged as two reviews (and the editor's verdict).
 *
 * Opening the drawer reads the review's earlier rewrites (one call for the
 * whole list, each with its draft), and any of them reopens. One still being
 * written is read again until it ends, rather than started again.
 *
 * **A stream that drops is never answered with a second rewrite.** The
 * rewrite carries on, and is charged, on the server whatever the reader does,
 * so the drawer reads the stored one to its end (`followRewrite`). The same
 * holds when the drawer is closed mid-draft: it is listed, writing, on the
 * next open.
 *
 * **Gaps the writer fills** (t-83). A finished draft's placeholders
 * (`[ADD: …]`, read by the server into `placeholders`) are listed under it as
 * short fields, each with its label. **Fill these and rewrite** starts the
 * next rewrite from that draft with the answers given (`fromRewriteId`,
 * `answers`); the gaps left blank stay in the new draft, as fields again.
 * The answers go to that rewrite only, not the project.
 *
 * **No brief** (t-83). On a review whose project has no brief, or that is in
 * no project, the drawer says what a brief adds and links to writing one
 * (`BriefInvite`). It never stops a rewrite.
 *
 * A refusal (no credits, over budget, too many at once) is shown beside the
 * button that was pressed, with `<SaveError>`, in the assess page's words.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Copy, Loader2, PenLine } from 'lucide-react';
import { z } from 'zod';
import { apiClient } from '@/lib/api/client';
import { useSaveFailure } from '@/lib/hooks/use-save-failure';
import { WORDS } from '@/lib/app/reports/words';
import { MAX_ANSWER_CHARS } from '@/lib/app/rewrites/validations';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { FieldHelp } from '@/components/ui/field-help';
import { SaveError } from '@/components/forms/form-error';
import { ASSESSMENTS_ENDPOINT } from '@/components/app/workbench/schemas';
import { COMPARISONS_ENDPOINT, comparePath } from '@/components/app/compare/schemas';
import { BriefInvite } from '@/components/app/projects/brief-invite';
import {
  answersFor,
  compareDraftBody,
  compareDraftRefusalOf,
  failureMessage,
  followRewrite,
  listRewrites,
  mergeRewrites,
  originalReviewSchema,
  rewriteRefusalOf,
  startedSince,
  streamRewrite,
  type RewriteAsk,
  type RewriteWire,
} from '@/components/app/report/rewrite-client';
import { BALANCED, type RewriteFocusOption } from '@/components/app/report/rewrite-focuses';

const createdIdSchema = z.object({ id: z.string().min(1) });

const timeFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const STATE_LABEL: Record<RewriteWire['status'], string> = {
  running: 'Writing…',
  completed: 'Done',
  failed: 'Stopped',
};

type Phase = 'idle' | 'writing' | 'ended';

const isAbort = (err: unknown): boolean => err instanceof DOMException && err.name === 'AbortError';

/** Which button started what is shown: its refusals are shown beside it. */
type Origin = 'write' | 'fill';

export function RewriteDrawer({
  assessmentId,
  focuses,
  briefInvite = null,
}: {
  assessmentId: string;
  focuses: RewriteFocusOption[];
  /** Set when the review's project has no brief, or it is in none: the drawer invites one. */
  briefInvite?: { projectId: string | null } | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState(BALANCED);
  const [phase, setPhase] = useState<Phase>('idle');
  /** The rewrite shown, once it exists; `null` before its first event. */
  const [shown, setShown] = useState<RewriteWire | null>(null);
  const [draft, setDraft] = useState('');
  const [earlier, setEarlier] = useState<RewriteWire[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [usagePage, setUsagePage] = useState<string | null>(null);
  const [origin, setOrigin] = useState<Origin>('write');
  /**
   * What the writer has typed for each rewrite's placeholders: by rewrite,
   * then by placeholder id. Keyed by rewrite, as ids repeat across drafts, so
   * answers never show under another draft's gaps, and a fill that fails
   * leaves them on the draft they answered.
   */
  const [answersBy, setAnswersBy] = useState<Record<string, Record<string, string>>>({});
  const [reviewUsagePage, setReviewUsagePage] = useState<string | null>(null);
  /** Set when the original's review no longer compares: reviewing both again would. */
  const [offerReviewAgain, setOfferReviewAgain] = useState(false);
  const rewrite = useSaveFailure({ fallback: 'The rewrite could not be started. Try again.' });
  const review = useSaveFailure({
    fallback: `The ${WORDS.review} of this draft could not be started. Try again.`,
  });
  const listFailure = useSaveFailure({
    fallback: 'The earlier rewrites could not be read. Close this and open it again.',
  });
  /** Stops whatever is reading a rewrite: a stream, or the reads following one. */
  const reading = useRef<AbortController | null>(null);
  /** Every rewrite seen since the page opened, as last seen: laid over each list read. */
  const seen = useRef(new Map<string, RewriteWire>());
  /** Bumped by each list read and by closing, so only the latest read's answer is shown. */
  const listRead = useRef(0);
  /**
   * The ids the server last listed, this open: what a rewrite found after a
   * drop must not be. `null` until a read succeeds; never the rows the drawer
   * remembered itself, which are not the server's word on what was there.
   */
  const listed = useRef<ReadonlySet<string> | null>(null);

  const nameOf = useCallback(
    (id: string) => focuses.find((f) => f.id === id)?.name ?? id,
    [focuses]
  );

  const remember = useCallback((r: RewriteWire) => {
    seen.current.set(r.id, r);
    // A list that could not be read stays unread: one row is not the history.
    setEarlier((list) => (list ? mergeRewrites(list, [r]) : list));
  }, []);

  const stopReading = () => {
    reading.current?.abort();
    reading.current = null;
  };

  const newReader = (): AbortSignal => {
    stopReading();
    const controller = new AbortController();
    reading.current = controller;
    return controller.signal;
  };

  useEffect(() => () => reading.current?.abort(), []);

  const showEnded = useCallback(
    (r: RewriteWire) => {
      setShown(r);
      setDraft(r.draft);
      setPhase('ended');
      remember(r);
      if (r.status === 'failed') rewrite.show(failureMessage(r));
    },
    [remember, rewrite]
  );

  /**
   * Read a stored rewrite to its end: one reopened while it runs, or whose
   * stream dropped. While it runs, the draft shown only grows: the stored one
   * is saved every few seconds, so it can be behind what streamed. Once it
   * ends, the stored draft is the whole of it.
   */
  const follow = async (r: RewriteWire, signal: AbortSignal) => {
    setShown(r);
    setDraft((d) => (r.draft.length > d.length ? r.draft : d));
    setPhase('writing');
    try {
      const ended = await followRewrite(
        r.id,
        (now) => {
          setShown(now);
          setDraft((d) => (now.draft.length > d.length ? now.draft : d));
          remember(now);
        },
        signal
      );
      showEnded(ended);
    } catch (err) {
      if (isAbort(err) || signal.aborted) return;
      setPhase('ended');
      rewrite.show(
        'The rewrite could not be read. Close this and open it again to see where it got to.'
      );
    }
  };

  const loadEarlier = async (): Promise<RewriteWire[] | null> => {
    const read = ++listRead.current;
    try {
      const fromServer = await listRewrites(assessmentId);
      const list = mergeRewrites(fromServer, seen.current.values());
      if (read === listRead.current) {
        listed.current = new Set(fromServer.map((r) => r.id));
        setEarlier(list);
        listFailure.clear();
      }
      return list;
    } catch (err) {
      if (read === listRead.current) listFailure.report(err);
      return null;
    }
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      void loadEarlier();
      return;
    }
    // The rewrite carries on without the drawer; it is listed on the next open.
    stopReading();
    listRead.current++;
    listed.current = null;
    setEarlier(null);
    setPhase('idle');
    setShown(null);
    setDraft('');
    setCopied(false);
    setAnswersBy({});
    setOrigin('write');
    rewrite.clear();
    review.clear();
    setOfferReviewAgain(false);
  };

  const write = async (ask: RewriteAsk, from: Origin) => {
    rewrite.clear();
    review.clear();
    setOfferReviewAgain(false);
    setOrigin(from);
    setUsagePage(null);
    setCopied(false);
    // A run refused before it starts puts back the draft shown, with what was
    // typed for its gaps: a fill's refusal then shows beside its button.
    const prior = shown && phase === 'ended' ? { rewrite: shown, draft } : null;
    const notStarted = () => {
      if (prior) {
        setShown(prior.rewrite);
        setDraft(prior.draft);
        setPhase('ended');
      } else {
        setPhase('idle');
      }
    };
    const signal = newReader();
    setShown(null);
    setDraft('');
    setPhase('writing');
    // What was listed before asking: a rewrite found after a drop must be
    // new. Pressed before the list arrived, it is read first; with no list,
    // a drop is never matched to a rewrite (`known` stays null).
    if (!listed.current) await loadEarlier();
    if (signal.aborted) return;
    const known = listed.current;
    try {
      const outcome = await streamRewrite(
        assessmentId,
        ask,
        {
          onStart: (r) => {
            setShown(r);
            remember(r);
          },
          onText: (text) => setDraft((d) => d + text),
        },
        signal
      );
      if (outcome.kind === 'done') {
        showEnded(outcome.rewrite);
        return;
      }
      if (outcome.rewrite) {
        await follow(outcome.rewrite, signal);
        return;
      }
      // Dropped before its first event: it may still have started.
      const list = await loadEarlier();
      if (signal.aborted) return;
      const started =
        list && known
          ? startedSince(list, { sentAt: outcome.sentAt, focus: ask.focus, known })
          : null;
      if (started) {
        await follow(started, signal);
        return;
      }
      notStarted();
      rewrite.show(
        list && known
          ? 'The connection dropped before the rewrite started. If it did start, it is listed below.'
          : 'The connection dropped before the rewrite started, and the earlier rewrites could not be read. Close this and open it again before trying again: if it did start, it will be listed.'
      );
    } catch (err) {
      if (signal.aborted) return;
      notStarted();
      const refusal = rewriteRefusalOf(err);
      if (refusal) {
        rewrite.show(refusal.message);
        setUsagePage(refusal.usagePage);
      } else {
        rewrite.report(err);
      }
    }
  };

  /** The next rewrite, from the shown one's draft with the gaps the writer filled. */
  const fill = (from: RewriteWire) => {
    const answers = answersFor(from.placeholders, answersBy[from.id] ?? {});
    if (Object.keys(answers).length === 0) return;
    void write({ focus: from.focus, fromRewriteId: from.id, answers }, 'fill');
  };

  const reopen = (r: RewriteWire) => {
    rewrite.clear();
    review.clear();
    setOfferReviewAgain(false);
    setOrigin('write');
    setUsagePage(null);
    setReviewUsagePage(null);
    setCopied(false);
    const signal = newReader();
    setDraft('');
    if (r.status === 'running') void follow(r, signal);
    else showEnded(r);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
    } catch {
      // No clipboard (an insecure origin, a denied permission): the draft is
      // selected for the reader to copy by hand.
      const box = document.getElementById('rewrite-draft');
      if (box) window.getSelection()?.selectAllChildren(box);
    }
  };

  /** Compare the shown draft with its original; `reviewAgain` reviews the original's copy too. */
  const reviewDraft = async (reviewAgain = false) => {
    if (!shown) return;
    review.clear();
    setReviewUsagePage(null);
    setOfferReviewAgain(false);
    setReviewing(true);
    try {
      const original = originalReviewSchema.parse(
        await apiClient.get<unknown>(`${ASSESSMENTS_ENDPOINT}/${encodeURIComponent(assessmentId)}`)
      );
      const created = createdIdSchema.parse(
        await apiClient.post<unknown>(COMPARISONS_ENDPOINT, {
          body: compareDraftBody(
            { ...original, id: assessmentId },
            { text: draft, focusName: nameOf(shown.focus) },
            reviewAgain
          ),
        })
      );
      router.push(comparePath(created.id));
    } catch (err) {
      const refusal = compareDraftRefusalOf(err);
      if (refusal) {
        review.show(refusal.message);
        setReviewUsagePage(refusal.usagePage);
        setOfferReviewAgain(refusal.reviewAgain);
      } else {
        review.report(err);
      }
      setReviewing(false);
    }
  };

  const writing = phase === 'writing';
  const finished = phase === 'ended' && shown?.status === 'completed';
  const gaps = finished && shown ? shown.placeholders : [];
  const typed = (shown && answersBy[shown.id]) || {};
  const answered = shown ? Object.keys(answersFor(shown.placeholders, typed)).length : 0;

  const refusal = (
    <>
      <SaveError failure={rewrite.failure} />
      {rewrite.failure && usagePage ? (
        <p className="text-sm">
          <Link href={usagePage} className="underline">
            See this month&rsquo;s usage
          </Link>
        </p>
      ) : null}
    </>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <PenLine aria-hidden="true" />
          Rewrite
        </Button>
      </DialogTrigger>
      <DialogContent
        className="data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-100 top-0 right-0 left-auto flex h-dvh w-full max-w-2xl translate-x-0 translate-y-0 flex-col gap-5 overflow-y-auto rounded-none sm:rounded-none"
        aria-describedby="rewrite-drawer-description"
      >
        <DialogHeader>
          <DialogTitle>Rewrite the copy</DialogTitle>
          <DialogDescription id="rewrite-drawer-description">
            The editor rewrites the copy from this {WORDS.review}&rsquo;s findings. Each rewrite is
            charged in credits, as a {WORDS.review} is.
          </DialogDescription>
        </DialogHeader>

        {briefInvite ? <BriefInvite projectId={briefInvite.projectId} runs="rewrite" /> : null}

        <fieldset className="space-y-2" disabled={writing}>
          <legend className="mb-2 flex items-center gap-1 text-sm font-medium">
            Focus
            <FieldHelp title="Focus">
              What the editor works on. Balanced works on the copy as a whole; an appeal raises that
              one without weakening the others. You can rewrite again with another focus: each
              rewrite is kept below.
            </FieldHelp>
          </legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {focuses.map((f) => (
              <div key={f.id} className="flex items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  id={`rewrite-focus-${f.id}`}
                  name="rewrite-focus"
                  value={f.id}
                  checked={focus === f.id}
                  onChange={() => setFocus(f.id)}
                />
                <label htmlFor={`rewrite-focus-${f.id}`}>{f.name}</label>
                <FieldHelp title={f.name} ariaLabel={`About ${f.name}`}>
                  {f.help}
                </FieldHelp>
              </div>
            ))}
          </div>
        </fieldset>

        <div className="space-y-2">
          <Button
            type="button"
            onClick={() => void write({ focus }, 'write')}
            disabled={writing || reviewing}
          >
            {writing ? (
              <>
                <Loader2 className="animate-spin" aria-hidden="true" />
                Writing…
              </>
            ) : (
              'Write a rewrite'
            )}
          </Button>
          {origin === 'write' || gaps.length === 0 ? refusal : null}
        </div>

        {phase !== 'idle' ? (
          <section aria-labelledby="rewrite-draft-heading" className="space-y-3">
            <h3 id="rewrite-draft-heading" className="text-sm font-medium">
              {shown ? `${nameOf(shown.focus)} rewrite` : 'Rewrite'}
              {writing ? ' · writing…' : ''}
            </h3>
            <div
              id="rewrite-draft"
              aria-busy={writing}
              className="min-h-40 rounded-md border bg-(--hd-paper) p-4 text-sm leading-relaxed whitespace-pre-wrap"
            >
              {draft || (writing ? 'The editor is starting…' : '')}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void copy()}
                disabled={draft === '' || writing}
              >
                {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void reviewDraft()}
                disabled={!finished || reviewing}
              >
                {reviewing ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                Review this draft
              </Button>
              <FieldHelp title="Review this draft">
                Reviews this draft with the original&rsquo;s reader settings, project and{' '}
                {WORDS.aiReviewers}, and opens it side by side with the original&rsquo;s{' '}
                {WORDS.review}, with the editor&rsquo;s verdict on which lands better. The
                draft&rsquo;s {WORDS.review} is charged, as any is, and so is the verdict when the{' '}
                {WORDS.review} calls enough {WORDS.aiReviewers} for one. The original is not
                reviewed again.
              </FieldHelp>
            </div>
            <SaveError failure={review.failure} />
            {review.failure && offerReviewAgain ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void reviewDraft(true)}
                disabled={reviewing}
              >
                Review both again
              </Button>
            ) : null}
            {review.failure && reviewUsagePage ? (
              <p className="text-sm">
                <Link href={reviewUsagePage} className="underline">
                  See this month&rsquo;s usage
                </Link>
              </p>
            ) : null}
          </section>
        ) : null}

        {shown && gaps.length > 0 ? (
          <section aria-labelledby="rewrite-gaps-heading" className="space-y-3 border-t pt-4">
            <h3 id="rewrite-gaps-heading" className="flex items-center gap-1 text-sm font-medium">
              Facts the editor needs
              <FieldHelp title="Facts the editor needs">
                The editor left a gap wherever a stronger version needs a fact only you know. Fill
                in the ones you can and rewrite: the editor puts each fact where its gap is, and
                leaves the gaps you skip. Your answers go to this rewrite only, not to the project.
              </FieldHelp>
            </h3>
            {gaps.map((g) => (
              <div key={g.id} className="space-y-1">
                <Label htmlFor={`rewrite-gap-${g.id}`}>{g.label}</Label>
                <Input
                  id={`rewrite-gap-${g.id}`}
                  value={typed[g.id] ?? ''}
                  maxLength={MAX_ANSWER_CHARS}
                  autoComplete="off"
                  disabled={writing || reviewing}
                  onChange={(e) => {
                    const value = e.target.value;
                    setAnswersBy((by) => ({
                      ...by,
                      [shown.id]: { ...by[shown.id], [g.id]: value },
                    }));
                  }}
                />
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              onClick={() => fill(shown)}
              disabled={writing || reviewing || answered === 0}
            >
              Fill these and rewrite
            </Button>
            {origin === 'fill' ? refusal : null}
          </section>
        ) : null}

        <section aria-labelledby="rewrite-earlier-heading" className="space-y-2 border-t pt-4">
          <h3 id="rewrite-earlier-heading" className="text-sm font-medium">
            Earlier rewrites
          </h3>
          <SaveError failure={listFailure.failure} />
          {earlier === null ? (
            listFailure.failure ? null : (
              <p className="text-sm text-(--hd-muted)">Loading…</p>
            )
          ) : earlier.length === 0 ? (
            <p className="text-sm text-(--hd-muted)">None yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {earlier.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-4 py-2 text-left hover:underline disabled:opacity-60 disabled:hover:no-underline"
                    aria-current={shown?.id === r.id ? 'true' : undefined}
                    onClick={() => reopen(r)}
                    // Reopening another would stop the stream: text not yet
                    // saved would be lost from view.
                    disabled={writing}
                  >
                    <span>
                      {nameOf(r.focus)} · {timeFormat.format(new Date(r.createdAt))}
                    </span>
                    <span className="text-(--hd-muted)">{STATE_LABEL[r.status]}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}
