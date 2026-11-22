'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { FieldHelp } from '@/components/ui/field-help';
import { FormError, SaveError } from '@/components/forms/form-error';
import { NoScriptNotice } from '@/components/forms/no-script-notice';
import { apiClient } from '@/lib/api/client';
import { useSaveFailure } from '@/lib/hooks/use-save-failure';
import { MAX_CONTENT_CHARS } from '@/lib/app/assessments/limits';
import { REDEEM_PATH } from '@/lib/app/credits/codes/wire';
import { asQuickScanSummary, type QuickScanSummary } from '@/lib/app/quick-scan/summary';
import { QUICK_SCAN_COPY as C } from '@/components/app/quick-scan/quick-scan-copy';

/**
 * The free quick scan's form and its answer (t-68). Posts to
 * `POST /api/v1/scan`, which answers a signed-out visitor the scores and a
 * caveat, and a signed-in one the full result; either is checked and shown
 * as the scores (`asQuickScanSummary`).
 *
 * The caveat is shown beside the score, never only before it, so nobody
 * reads a quick-scan score as the AI reviewers' verdict.
 */

const SCAN_PATH = '/api/v1/scan';
const GENERAL = 'general';

const formSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, 'Paste some copy to scan.')
    .max(MAX_CONTENT_CHARS, `That’s over ${MAX_CONTENT_CHARS.toLocaleString('en-GB')} characters.`),
  contentType: z.string(),
});
type FormValues = z.infer<typeof formSchema>;

export interface NamedOption {
  id: string;
  name: string;
}

interface Props {
  /** Types of copy, by id and name, in the version's order. */
  contentTypes: NamedOption[];
  /** Appeals by id and name, to name the scores. */
  appeals: NamedOption[];
}

export function QuickScanForm({ contentTypes, appeals }: Props) {
  const [result, setResult] = useState<QuickScanSummary | null>(null);
  const [running, setRunning] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    mode: 'onTouched',
    defaultValues: {
      text: '',
      contentType: contentTypes.some((t) => t.id === GENERAL)
        ? GENERAL
        : (contentTypes[0]?.id ?? ''),
    },
  });
  const save = useSaveFailure({ fallback: C.failed, errors });

  const onSubmit = async ({ text, contentType }: FormValues) => {
    setRunning(true);
    try {
      const data = await apiClient.post<unknown>(SCAN_PATH, {
        body: { text, ...(contentType ? { context: { contentType } } : {}) },
      });
      // A signed-in visitor gets the full result; the page shows its scores alike.
      setResult(asQuickScanSummary(data));
    } catch (err) {
      setResult(null);
      save.report(err);
    } finally {
      setRunning(false);
    }
  };

  const nameOf = (id: string) => appeals.find((a) => a.id === id)?.name ?? id;

  return (
    <div className="space-y-10">
      <form
        method="post"
        noValidate
        onSubmit={save.submit(handleSubmit(onSubmit, save.invalid))}
        className="space-y-5"
        data-testid="quick-scan-form"
      >
        <NoScriptNotice />
        <div className="space-y-2">
          <Label htmlFor="quick-scan-text">{C.textLabel}</Label>
          <Textarea
            id="quick-scan-text"
            className="min-h-[220px] resize-y text-base"
            aria-describedby="quick-scan-text-hint"
            disabled={running}
            {...register('text')}
          />
          <p id="quick-scan-text-hint" className="text-sm text-(--hd-muted)">
            {C.textHint}
          </p>
          <FormError message={errors.text?.message} />
        </div>

        {contentTypes.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="quick-scan-type">{C.typeLabel}</Label>
              <FieldHelp title={C.typeLabel}>{C.typeHelp}</FieldHelp>
            </div>
            <select
              id="quick-scan-type"
              disabled={running}
              className="border-input bg-background h-10 w-full max-w-sm rounded-md border px-3 text-base"
              {...register('contentType')}
            >
              {contentTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <SaveError failure={save.failure} />
        <Button type="submit" size="lg" disabled={running}>
          {running ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              {C.running}
            </>
          ) : (
            C.submit
          )}
        </Button>
      </form>

      {/* Always mounted, so a screen reader announces the result when it arrives. */}
      <div aria-live="polite">
        {result && (
          <section
            aria-labelledby="quick-scan-result"
            className="space-y-6 border-t border-(--hd-rule) pt-8"
            data-testid="quick-scan-result"
          >
            <h2 id="quick-scan-result" className="text-3xl font-bold">
              {C.resultH}
            </h2>
            {result.overall !== null && (
              <p className="flex items-baseline gap-3">
                <span className="text-6xl font-extrabold tabular-nums">{result.overall}</span>
                <span className="text-(--hd-muted)">{C.outOf}</span>
                {result.band && <span className="text-xl font-semibold">{result.band}</span>}
              </p>
            )}
            {result.appeals.length > 0 && (
              <ul className="grid max-w-xl gap-3">
                {result.appeals.map((a) => (
                  <li key={a.id} className="grid grid-cols-[7rem_1fr_3rem] items-center gap-3">
                    <span className="font-semibold">{nameOf(a.id)}</span>
                    <span
                      className="h-2 overflow-hidden rounded-full bg-(--hd-rule)"
                      aria-hidden="true"
                    >
                      <span
                        className="block h-full rounded-full bg-(--hd-ink)"
                        style={{ width: `${Math.max(0, Math.min(100, a.score))}%` }}
                      />
                    </span>
                    <span className="text-right tabular-nums">{a.score}</span>
                  </li>
                ))}
              </ul>
            )}
            <p
              className="max-w-[64ch] border-l-4 border-(--hd-red) pl-4 leading-relaxed"
              data-testid="quick-scan-caveat"
            >
              {/* The server's own words, beside the score it gave. */}
              {result.caveat}
            </p>
            <div className="space-y-4 bg-(--hd-ink) p-6 text-(--hd-paper) sm:p-8">
              <h3 className="text-2xl font-bold">{C.fullH}</h3>
              <p className="max-w-[60ch] leading-relaxed opacity-80">{C.full}</p>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                <Button
                  asChild
                  size="lg"
                  className="bg-(--hd-paper) text-(--hd-ink) hover:bg-(--hd-paper)/90"
                >
                  <Link href={REDEEM_PATH} data-testid="quick-scan-redeem">
                    {C.redeem}
                  </Link>
                </Button>
                <Link href="/signup" className="underline underline-offset-4">
                  {C.signup}
                </Link>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
