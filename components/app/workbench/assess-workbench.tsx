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
 * The draft, less any file, is kept in this browser until the review starts.
 * A refusal is shown beside Start with `<SaveError>`, in words a person can
 * act on, with a link to the usage page when it is about credits or budget.
 */
import { useState, type BaseSyntheticEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
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
import { readAsBase64 } from '@/lib/app/intake/read-as-base64';
import { MAX_REVIEW_FILE_BYTES } from '@/lib/app/assessments/limits';
import { WORDS } from '@/lib/app/reports/words';
import { SettingPicker } from '@/components/app/projects/setting-picker';
import { DOCUMENT_EXTENSIONS, type ProjectWire } from '@/components/app/projects/schemas';
import {
  NO_DEFAULT,
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
  defaultsOf,
  fixedByProject,
  problemsOf,
  readDraft,
  refusalOf,
  requestBodyOf,
  reviewerName,
  reviewerSetOptions,
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

const MODEL_DEFAULT = 'The model’s default';

export interface AssessWorkbenchProps {
  catalogue: AssessCatalogue;
  /** The workspace's live projects on this framework. */
  projects: ProjectWire[];
}

const words = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

export function AssessWorkbench({ catalogue, projects }: AssessWorkbenchProps) {
  const router = useRouter();
  const [stored, setStored, clearStored] = useLocalStorage<unknown>(DRAFT_KEY, EMPTY_DRAFT);
  const read = readDraft(stored);
  // A project archived or deleted since the draft was kept is dropped.
  const project = projects.find((p) => p.id === read.projectId) ?? null;
  const draft: Draft = project ? read : { ...read, projectId: NO_PROJECT };
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
  const appealNames = Object.fromEntries(catalogue.result.appeals.map((a) => [a.id, a.name]));

  const onSubmit = async (e?: BaseSyntheticEvent) => {
    e?.preventDefault();
    setUsagePage(null);
    if (save.block(problemsOf(draft, file))) return;
    setSending(true);
    try {
      const chosen =
        draft.source === 'file' && file
          ? { name: file.name, base64: await readAsBase64(file) }
          : null;
      const data = await apiClient.post<unknown>(ASSESSMENTS_ENDPOINT, {
        body: requestBodyOf(draft, chosen),
      });
      const review = createdReviewSchema.parse(data);
      clearStored();
      setFile(null);
      if (FINAL_STATES.has(review.status)) router.push(reportPath(review.id));
      else setStarted(review);
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
          </TabsList>

          <TabsContent value="text" className="mt-4 space-y-2">
            <Label htmlFor="assess-text">The copy to review</Label>
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

          <TabsContent value="file" className="mt-4 space-y-2">
            <Label htmlFor="assess-file" className="flex items-center gap-1">
              A file to review
              <FieldHelp title="A file to review">
                PDF, Word, PowerPoint, HTML, Markdown or plain text, up to{' '}
                {MAX_REVIEW_FILE_BYTES / 1_048_576} MB. Its text is read and reviewed; a scanned PDF
                with no text in it cannot be. The file is not kept in this browser&rsquo;s draft.
              </FieldHelp>
            </Label>
            <Input
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
                help={m.help ?? `${m.name}. It changes what the AI reviewers expect of the copy.`}
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
            <legend className="text-sm font-medium">Tick the {WORDS.aiReviewers} to run</legend>
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

        <div className="space-y-3">
          <Button type="submit" size="lg" className="w-full" disabled={sending}>
            {sending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                Starting…
              </>
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
