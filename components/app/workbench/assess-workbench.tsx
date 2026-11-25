'use client';

/**
 * The `/assess` workbench (t-78): copy in, a review out.
 *
 * The copy is pasted text, a file or a page's address; the reader settings
 * and the AI reviewers are the version's (its catalogue), each with its
 * help. Choosing a project fills the settings and the reviewers from its
 * defaults, and each can still be changed (`assess-draft.ts`).
 *
 * Starting it posts to `POST /api/v1/assessments`, then shows the review
 * live (`ReviewProgress`): its quick scan at once, from the 202, then each
 * AI reviewer as it lands, then the report. A review with no AI reviewer is
 * final at once and opens its report straight away.
 *
 * Comparing (t-89) is the fourth tab: 2–5 pasted drafts, each with an
 * optional name, reviewed with the same reader and AI reviewers. Starting it
 * posts to `POST /api/v1/comparisons` and opens the comparison's page
 * (`/compare/[id]`), which follows the drafts as they run.
 *
 * Before it starts, copy in no project, or in one with no brief, is invited
 * to have one (`BriefInvite`, t-83): what a brief adds, with an example, and
 * where to write it. It never stops the review.
 *
 * The draft, less any file, is kept in this browser until the review starts.
 * A refusal is shown beside Start with `<SaveError>`, in words a person can
 * act on, with a link to the usage page when it is about credits or budget.
 */
import { useState, type BaseSyntheticEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, X } from 'lucide-react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { FieldHelp } from '@/components/ui/field-help';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SaveError } from '@/components/forms/form-error';
import { apiClient } from '@/lib/api/client';
import { useSaveFailure } from '@/lib/hooks/use-save-failure';
import { useLocalStorage } from '@/lib/hooks/use-local-storage';
import { sendUpload } from '@/lib/app/intake/send-upload';
import { MAX_CONTENT_CHARS, MAX_REVIEW_FILE_BYTES } from '@/lib/app/assessments/limits';
import { DRAFT_LABEL_MAX, MAX_DRAFTS, MIN_DRAFTS } from '@/lib/app/comparisons/validations';
import { WORDS } from '@/lib/app/reports/words';
import { SettingPicker } from '@/components/app/projects/setting-picker';
import { BriefInvite, hasBrief } from '@/components/app/projects/brief-invite';
import { DOCUMENT_EXTENSIONS, type ProjectWire } from '@/components/app/projects/schemas';
import {
  NO_DEFAULT,
  QUICK_PROFILE,
  audiencePickers,
  cultureOptions,
  withStored,
  type PickerOption,
} from '@/components/app/projects/project-defaults';
import {
  CHOOSE_REVIEWERS,
  DRAFT_KEY,
  EMPTY_DRAFT,
  NO_PROJECT,
  SOURCES,
  choosableReviewers,
  comparisonDraftsOf,
  defaultsOf,
  fixedByProject,
  problemsOf,
  readDraft,
  refusalOf,
  jsonSourceOf,
  requestOptionsOf,
  reviewerName,
  reviewerSetOptions,
  settingsInProject,
  staleDefaultsOf,
  type CompareDraft,
  type Draft,
  type SettingKey,
} from '@/components/app/workbench/assess-draft';
import {
  ASSESSMENTS_ENDPOINT,
  FINAL_STATES,
  createdReviewSchema,
  reportPath,
  type AssessCatalogue,
  type CreatedReview,
} from '@/components/app/workbench/schemas';
import { ReviewProgress } from '@/components/app/workbench/review-progress';
import { COMPARISONS_ENDPOINT, comparePath } from '@/components/app/compare/schemas';

const MODEL_DEFAULT = 'The model’s default';

const createdIdSchema = z.object({ id: z.string().min(1) });

/** A host that refuses the upload before the route reads it (Vercel staging, over 4.5 MB). */
const FILE_TOO_LARGE_FOR_HOST =
  'This file is too large for this server to accept. Paste its text instead, or try a smaller file.';

const COMPARE_STARTED_UNREADABLE =
  'The comparison has started, but this page could not read the reply, so it cannot open it. There is no need to start it again: it is in your reviews.';

const STARTED_UNREADABLE = `The ${WORDS.review} has started, but this page could not read the reply, so it cannot show its progress. There is no need to start it again.`;

export interface AssessWorkbenchProps {
  catalogue: AssessCatalogue;
  /** The version {@link catalogue} is, which the review is run on. */
  version: string;
  /** The workspace's live projects on this framework. */
  projects: ProjectWire[];
}

const words = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

export function AssessWorkbench({ catalogue, version, projects }: AssessWorkbenchProps) {
  const router = useRouter();
  const [stored, setStored, clearStored] = useLocalStorage<unknown>(DRAFT_KEY, EMPTY_DRAFT);
  const read = readDraft(stored);
  // A project archived or deleted since the draft was kept is dropped.
  const project = projects.find((p) => p.id === read.projectId) ?? null;
  const draft: Draft = project
    ? { ...read, settings: settingsInProject(read.settings, project, catalogue) }
    : { ...read, projectId: NO_PROJECT };
  const update = (patch: Partial<Draft>) =>
    setStored((prev: unknown) => ({ ...readDraft(prev), ...patch }));
  const setSetting = (key: Exclude<SettingKey, `modifiers.${string}`>, value: string) =>
    update({ settings: { ...draft.settings, [key]: value } });
  const setModifier = (id: string, value: string) => {
    const modifiers = { ...draft.settings.modifiers };
    if (value === NO_DEFAULT) delete modifiers[id];
    else modifiers[id] = value;
    update({ settings: { ...draft.settings, modifiers } });
  };

  const [file, setFile] = useState<File | null>(null);
  // Bumped to empty the file input, which holds its own file.
  const [fileInput, setFileInput] = useState(0);
  const [sending, setSending] = useState(false);
  const [started, setStarted] = useState<CreatedReview | null>(null);
  const [usagePage, setUsagePage] = useState<string | null>(null);
  const save = useSaveFailure({
    fallback: `The ${WORDS.review} could not be started. Try again in a moment.`,
  });

  const fixed = fixedByProject(project, catalogue);
  const noneFor = (key: SettingKey): string | null => (fixed.has(key) ? null : MODEL_DEFAULT);
  const s = draft.settings;
  const showCulture =
    catalogue.request.countries !== undefined ||
    s.cultureReader !== NO_DEFAULT ||
    s.cultureWriter !== NO_DEFAULT;
  const countries = cultureOptions(catalogue);
  const audience = audiencePickers(catalogue, s.modifiers);
  const reviewers = choosableReviewers(catalogue);
  const stale = staleDefaultsOf(project, catalogue);
  const offeredAudience = new Set(catalogue.request.audience.map((m) => m.id));
  const appealNames = Object.fromEntries(catalogue.result.appeals.map((a) => [a.id, a.name]));

  const setCompareDraft = (i: number, patch: Partial<CompareDraft>) =>
    update({ drafts: draft.drafts.map((d, j) => (j === i ? { ...d, ...patch } : d)) });
  const comparing = draft.source === 'compare';

  const onSubmit = async (e?: BaseSyntheticEvent) => {
    e?.preventDefault();
    setUsagePage(null);
    if (save.block(problemsOf(draft, file, catalogue, project))) return;
    setSending(true);
    try {
      const options = requestOptionsOf(draft, catalogue, version);
      if (comparing) {
        const reply = await apiClient.post<unknown>(COMPARISONS_ENDPOINT, {
          body: { drafts: comparisonDraftsOf(draft), ...options },
        });
        // From here every draft is a review: the draft is spent.
        clearStored();
        const created = createdIdSchema.safeParse(reply);
        if (created.success) router.push(comparePath(created.data.id));
        else save.show(COMPARE_STARTED_UNREADABLE);
        return;
      }
      const source = jsonSourceOf(draft);
      // A file goes as its own bytes in a multipart upload (t-80); text and a
      // page as JSON. `problemsOf` has made sure a file draft has its file.
      const data =
        source === null && file
          ? await sendUpload(ASSESSMENTS_ENDPOINT, file, options, FILE_TOO_LARGE_FOR_HOST)
          : await apiClient.post<unknown>(ASSESSMENTS_ENDPOINT, {
              body: { source, ...options },
            });
      // From here the review exists and is charged: whatever the reply holds,
      // the draft is spent, and nothing may invite starting it again.
      clearStored();
      setFile(null);
      setFileInput((n) => n + 1);
      const review = createdReviewSchema.safeParse(data);
      if (review.success) {
        if (FINAL_STATES.has(review.data.status)) router.push(reportPath(review.data.id));
        else setStarted(review.data);
        return;
      }
      // A reply this page cannot read in full still names the review: its
      // report page shows it, running or done.
      const created = createdIdSchema.safeParse(data);
      if (created.success) router.push(reportPath(created.data.id));
      else save.show(STARTED_UNREADABLE);
    } catch (err) {
      const refusal = refusalOf(err);
      if (refusal) {
        save.show(refusal.message);
        setUsagePage(refusal.usagePage);
      } else {
        save.report(err);
      }
    } finally {
      setSending(false);
    }
  };

  if (started) {
    return (
      <div className="hd-sheet px-6 py-10 md:px-10">
        <ReviewProgress
          assessmentId={started.id}
          reviewers={started.judges.map((slot) => ({
            slot,
            name: reviewerName(catalogue, slot),
          }))}
          appealNames={appealNames}
          initial={{
            status: started.status,
            quickScan: started.quickScan ?? null,
            runs: started.judgeRuns ?? [],
          }}
          onDone={() => router.push(reportPath(started.id))}
        />
      </div>
    );
  }

  const projectOptions: PickerOption[] = projects.map((p) => ({ value: p.id, label: p.name }));

  return (
    <form
      method="post"
      noValidate
      onSubmit={save.submit(onSubmit)}
      className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]"
    >
      <div className="hd-sheet p-5">
        <Tabs
          value={draft.source}
          onValueChange={(v) => {
            const source = SOURCES.find((x) => x === v);
            if (source) update({ source });
          }}
        >
          <TabsList aria-label="What to review">
            <TabsTrigger value="text">Text</TabsTrigger>
            <TabsTrigger value="file">File</TabsTrigger>
            <TabsTrigger value="url">Web page</TabsTrigger>
            <TabsTrigger value="compare">Compare drafts</TabsTrigger>
          </TabsList>

          <TabsContent value="text" className="mt-4 space-y-2">
            <Label htmlFor="assess-text" className="flex items-center gap-1">
              The copy to review
              <FieldHelp title="The copy to review">
                Up to {MAX_CONTENT_CHARS.toLocaleString('en-GB')} characters, pasted as it reads:
                the words are reviewed, not the layout. This text is kept in this browser&rsquo;s
                draft until the {WORDS.review} starts.
              </FieldHelp>
            </Label>
            <Textarea
              id="assess-text"
              value={draft.text}
              onChange={(e) => update({ text: e.target.value })}
              placeholder="Paste the copy: anything from a headline to a 20-page proposal."
              className="min-h-[340px] resize-y text-base"
              disabled={sending}
            />
            <p className="text-right text-sm text-(--hd-muted) tabular-nums">
              {words(draft.text).toLocaleString('en-GB')} words
            </p>
          </TabsContent>

          {/* Kept mounted while hidden: remounting would empty the file input
              while the file chosen in it is still the one Start sends. */}
          <TabsContent
            value="file"
            forceMount
            className="mt-4 space-y-2 data-[state=inactive]:hidden"
          >
            <Label htmlFor="assess-file" className="flex items-center gap-1">
              A file to review
              <FieldHelp title="A file to review">
                PDF, Word, PowerPoint, HTML, Markdown or plain text, up to{' '}
                {MAX_REVIEW_FILE_BYTES / 1_048_576} MB; for a larger one, paste its text. Its text
                is read and reviewed; a scanned PDF with no text in it cannot be. The file is not
                kept in this browser&rsquo;s draft.
              </FieldHelp>
            </Label>
            <Input
              key={fileInput}
              id="assess-file"
              type="file"
              accept={DOCUMENT_EXTENSIONS.join(',')}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={sending}
            />
          </TabsContent>

          <TabsContent value="url" className="mt-4 space-y-2">
            <Label htmlFor="assess-url" className="flex items-center gap-1">
              The page&rsquo;s address
              <FieldHelp title="The page’s address">
                A public web page. We fetch it once and review its text. A page behind a sign-in, or
                one that builds itself in the browser, may come back empty: paste its text instead.
              </FieldHelp>
            </Label>
            <Input
              id="assess-url"
              type="url"
              inputMode="url"
              value={draft.url}
              onChange={(e) => update({ url: e.target.value })}
              placeholder="https://example.com/pricing"
              disabled={sending}
            />
          </TabsContent>

          <TabsContent value="compare" className="mt-4 space-y-5">
            <p className="text-sm text-(--hd-muted)">
              Paste {MIN_DRAFTS} to {MAX_DRAFTS} versions of the same piece. Each is reviewed for
              the same reader by the same {WORDS.aiReviewers}, and counts as one {WORDS.review}.
              Then the editor says which lands better, and why.
            </p>
            {draft.drafts.map((d, i) => (
              <fieldset key={i} className="space-y-2 rounded-md border border-(--hd-rule) p-3">
                <legend className="px-1 text-sm font-semibold">Draft {i + 1}</legend>
                <div className="flex items-end gap-2">
                  <div className="flex-1 space-y-1">
                    <Label htmlFor={`compare-label-${i}`} className="flex items-center gap-1">
                      Name (optional)
                      <FieldHelp title="The draft’s name">
                        What to call this draft on the comparison, such as &ldquo;Subject line
                        A&rdquo;, up to {DRAFT_LABEL_MAX} characters. Left empty, it is called Draft{' '}
                        {i + 1}.
                      </FieldHelp>
                    </Label>
                    <Input
                      id={`compare-label-${i}`}
                      value={d.label}
                      onChange={(e) => setCompareDraft(i, { label: e.target.value })}
                      placeholder={`Draft ${i + 1}`}
                      disabled={sending}
                    />
                  </div>
                  {draft.drafts.length > MIN_DRAFTS ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => update({ drafts: draft.drafts.filter((_, j) => j !== i) })}
                      disabled={sending}
                    >
                      <X className="mr-1 h-4 w-4" aria-hidden />
                      Remove draft {i + 1}
                    </Button>
                  ) : null}
                </div>
                <Label htmlFor={`compare-text-${i}`} className="flex items-center gap-1">
                  The copy
                  <FieldHelp title="The draft’s copy">
                    Up to {MAX_CONTENT_CHARS.toLocaleString('en-GB')} characters, pasted as it
                    reads. Kept in this browser&rsquo;s draft until the comparison starts.
                  </FieldHelp>
                </Label>
                <Textarea
                  id={`compare-text-${i}`}
                  value={d.text}
                  onChange={(e) => setCompareDraft(i, { text: e.target.value })}
                  className="min-h-[140px] resize-y text-base"
                  disabled={sending}
                />
                <p className="text-right text-sm text-(--hd-muted) tabular-nums">
                  {words(d.text).toLocaleString('en-GB')} words
                </p>
              </fieldset>
            ))}
            {draft.drafts.length < MAX_DRAFTS ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => update({ drafts: [...draft.drafts, { label: '', text: '' }] })}
                disabled={sending}
              >
                <Plus className="mr-1 h-4 w-4" aria-hidden />
                Add a draft
              </Button>
            ) : null}
          </TabsContent>
        </Tabs>
      </div>

      <div className="hd-sheet space-y-5 p-5 xl:sticky xl:top-6">
        <h2 className="text-2xl font-bold">The reader</h2>
        {projects.length > 0 ? (
          <SettingPicker
            id="assess-project"
            label="Project"
            help="The project this review belongs to. Its defaults fill in the settings below, which you can still change, and its brief and background documents go to the AI reviewers."
            options={withStored(projectOptions, draft.projectId)}
            value={draft.projectId}
            onChange={(id) =>
              update({
                projectId: id,
                ...defaultsOf(projects.find((p) => p.id === id) ?? null, catalogue),
              })
            }
            noneLabel="No project"
            disabled={sending}
          />
        ) : null}
        {!project || !hasBrief(project.brief) ? (
          <BriefInvite projectId={project?.id ?? null} runs="review" />
        ) : null}
        {project && stale.length > 0 ? (
          <div role="note" className="space-y-1 text-sm">
            <p>
              This project&rsquo;s defaults name settings this version of the model does not have:{' '}
              {stale.join(', ')}. Each {WORDS.review} in it is refused until they are fixed.
            </p>
            <Link href={`/projects/${encodeURIComponent(project.id)}`} className="underline">
              Fix the project&rsquo;s defaults
            </Link>
          </div>
        ) : null}

        <SettingPicker
          id="assess-content-type"
          label={WORDS.TypeOfCopy}
          help="What kind of piece it is. It sets the mix of appeals the copy is scored against, and the length it is measured by."
          options={withStored(
            catalogue.request.contentTypes.map((c) => ({ value: c.id, label: c.name })),
            s.contentType
          )}
          value={s.contentType}
          onChange={(v) => setSetting('contentType', v)}
          noneLabel={noneFor('contentType')}
          disabled={sending}
        />
        <SettingPicker
          id="assess-archetype"
          label="Reader"
          help="The kind of reader the copy is written for, as the model describes readers."
          options={withStored(
            catalogue.request.archetypes.map((a) => ({ value: a.id, label: a.name })),
            s.archetype
          )}
          value={s.archetype}
          onChange={(v) => setSetting('archetype', v)}
          noneLabel={noneFor('archetype')}
          disabled={sending}
        />
        <SettingPicker
          id="assess-role"
          label="Reader’s role"
          help="The reader’s job, when the copy is for a senior decision-maker. Leave it for anyone else."
          options={withStored(
            catalogue.request.roles.map((r) => ({ value: r.id, label: r.name })),
            s.role
          )}
          value={s.role}
          onChange={(v) => setSetting('role', v)}
          noneLabel={noneFor('role')}
          disabled={sending}
        />
        {showCulture ? (
          <SettingPicker
            id="assess-culture-reader"
            label="Reader’s culture"
            help="Where the reader is from. The culture reviewer checks the copy against that culture’s expectations."
            options={withStored(countries, s.cultureReader)}
            value={s.cultureReader}
            onChange={(v) => setSetting('cultureReader', v)}
            noneLabel={noneFor('cultureReader')}
            disabled={sending}
          />
        ) : null}

        <details className="rounded-md border border-(--hd-rule) px-3 py-2">
          <summary className="cursor-pointer text-sm font-semibold">Fine-tune the reader</summary>
          <div className="mt-4 space-y-4">
            {audience.map((m) => (
              <SettingPicker
                key={m.id}
                id={`assess-audience-${m.id}`}
                label={m.name}
                help={
                  offeredAudience.has(m.id) && m.options.length > 0
                    ? (m.help ?? `${m.name}. It changes what the AI reviewers expect of the copy.`)
                    : fixed.has(`modifiers.${m.id}`)
                      ? 'A default this project holds for a setting this version does not take. It can only be changed on the project’s page.'
                      : 'Kept from an earlier draft, for a setting this version does not take. Set it back to the model’s default.'
                }
                options={withStored(m.options, s.modifiers[m.id] ?? NO_DEFAULT)}
                value={s.modifiers[m.id] ?? NO_DEFAULT}
                onChange={(v) => setModifier(m.id, v)}
                noneLabel={noneFor(`modifiers.${m.id}`)}
                disabled={sending}
              />
            ))}
            {showCulture ? (
              <SettingPicker
                id="assess-culture-writer"
                label="Writer’s culture"
                help="Where the writer is from, so the review can point out habits that will not travel to the reader."
                options={withStored(countries, s.cultureWriter)}
                value={s.cultureWriter}
                onChange={(v) => setSetting('cultureWriter', v)}
                noneLabel={noneFor('cultureWriter')}
                disabled={sending}
              />
            ) : null}
          </div>
        </details>

        <SettingPicker
          id="assess-profile"
          label={WORDS.AiReviewers}
          help="Which AI reviewers read the copy. A set other than the quick scan or all of them also runs the four appeals. More reviewers take longer and cost more."
          options={withStored(reviewerSetOptions(catalogue), draft.profile)}
          value={draft.profile}
          onChange={(v) => update({ profile: v })}
          noneLabel={null}
          disabled={sending}
        />
        {draft.profile === CHOOSE_REVIEWERS ? (
          <fieldset id="assess-reviewers" className="space-y-2">
            <legend className="flex items-center gap-1 text-sm font-medium">
              Tick the {WORDS.aiReviewers} to run
              <FieldHelp title={`Tick the ${WORDS.aiReviewers} to run`}>
                Each one ticked reads the copy for what it covers and adds what it finds to the
                report. More {WORDS.aiReviewers} take longer and cost more.
              </FieldHelp>
            </legend>
            {reviewers.map((r) => (
              <label key={r.slot} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.judges.includes(r.slot)}
                  disabled={sending}
                  onChange={(e) =>
                    update({
                      judges: e.target.checked
                        ? reviewers
                            .map((x) => x.slot)
                            .filter((slot) => slot === r.slot || draft.judges.includes(slot))
                        : draft.judges.filter((slot) => slot !== r.slot),
                    })
                  }
                />
                {r.name}
              </label>
            ))}
          </fieldset>
        ) : null}

        {comparing && draft.profile === QUICK_PROFILE ? (
          <p role="note" className="text-sm text-(--hd-muted)">
            With the quick scan alone, the drafts are scored but the editor gives no verdict on
            which lands better.
          </p>
        ) : null}

        <div className="space-y-3">
          <Button type="submit" size="lg" className="w-full" disabled={sending}>
            {sending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                Starting…
              </>
            ) : comparing ? (
              `Compare the ${draft.drafts.length} drafts`
            ) : (
              `Start the ${WORDS.review}`
            )}
          </Button>
          <SaveError failure={save.failure} />
          {save.failure && usagePage ? (
            <p className="text-sm">
              <Link href={usagePage} className="underline">
                See this month&rsquo;s usage
              </Link>
            </p>
          ) : null}
        </div>
      </div>
    </form>
  );
}
