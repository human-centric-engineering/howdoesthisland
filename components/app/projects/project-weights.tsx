'use client';

/**
 * A project's adjustment to the model's weights (t-72, D5): for a team that
 * knows its reader better than the model's averages. Saves with
 * `PATCH /api/v1/projects/{id}` `{ overlay }`, which replaces it whole.
 *
 * **Shown only when the version in use declares bounds**, since a version
 * without them allows no adjustment. The one exception is a project still
 * holding an adjustment the version no longer allows: every review in it is
 * refused until it is removed, so the section says so and offers that,
 * rather than hiding the cause.
 *
 * Only what the version lets move is offered, in points of the mix, with its
 * limit; the API checks it again on save.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { FieldHelp } from '@/components/ui/field-help';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormError, SaveError } from '@/components/forms/form-error';
import { apiClient, APIClientError } from '@/lib/api/client';
import { NO_SERVER_FIELDS, useSaveFailure } from '@/lib/hooks/use-save-failure';
import { WORDS } from '@/lib/app/reports/words';
import {
  projectEndpoint,
  type DefaultsCatalogue,
  type ProjectWire,
} from '@/components/app/projects/schemas';
import {
  APPEAL_IDS,
  coreDimensions,
  describeOverlay,
  movableAppeals,
  overlayBodyOf,
  storedOverlayReadable,
  weightsFormSchema,
  weightsIssues,
  weightsValuesOf,
  type Adjustment,
  type WeightsFormValues,
} from '@/components/app/projects/project-overlay';

export interface ProjectWeightsProps {
  project: ProjectWire;
  catalogue: DefaultsCatalogue;
}

export function ProjectWeights({ project, catalogue }: ProjectWeightsProps) {
  const adjustment = catalogue.request.adjustment;
  if (adjustment) {
    return <WeightsForm project={project} catalogue={catalogue} adjustment={adjustment} />;
  }
  if (project.overlay === null) return null;
  return <NotAllowed project={project} catalogue={catalogue} />;
}

const TITLE = 'Weighting';

/** A stored adjustment the version in use allows none of: what it is, and removing it. */
function NotAllowed({ project, catalogue }: ProjectWeightsProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const save = useSaveFailure({
    fallback: 'The adjustment could not be removed. Try again in a moment.',
    fields: NO_SERVER_FIELDS,
  });
  const described = storedOverlayReadable(project)
    ? describeOverlay(weightsValuesOf(project), catalogue)
    : [];

  const removeIt = async () => {
    save.clear();
    setBusy(true);
    try {
      await apiClient.patch<unknown>(projectEndpoint(project.id), { body: { overlay: null } });
      router.refresh();
    } catch (err) {
      save.report(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{TITLE}</CardTitle>
        <CardDescription>
          This project adjusts the model&rsquo;s weights
          {described.length > 0 ? `: ${described.join(' · ')}` : ''}. The latest model version
          allows no adjustment, so {WORDS.review}s in this project scored with it are refused until
          the adjustment is removed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Button type="button" variant="outline" disabled={busy} onClick={() => void removeIt()}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Remove the adjustment
        </Button>
        <SaveError failure={save.failure} />
      </CardContent>
    </Card>
  );
}

function WeightsForm({
  project,
  catalogue,
  adjustment,
}: ProjectWeightsProps & { adjustment: Adjustment }) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [initial] = useState(() => weightsValuesOf(project));
  const readable = storedOverlayReadable(project);
  // What the version lets move, and any appeal the project moved that it no
  // longer does, so a refused value is seen rather than sent unseen.
  const movable = movableAppeals(catalogue, adjustment);
  const stranded = APPEAL_IDS.filter(
    (a) => initial.weights[a] !== 0 && !movable.some((m) => m.id === a)
  ).map((a) => ({
    id: a,
    name: catalogue.result.appeals.find((x) => x.id === a)?.name ?? a,
    most: 0,
  }));
  const appeals = [...movable, ...stranded];
  // The core dimensions, then any the project names that this version lacks,
  // so a stored id the API now refuses is seen, and can be unticked, rather
  // than sent unseen and filling the quota.
  const core = coreDimensions(catalogue);
  const dimensions = [
    ...core,
    ...[...new Set([...initial.add, ...initial.remove])]
      .filter((id) => !core.some((d) => d.id === id))
      .map((id) => ({ id, name: `${id} (not in this version)` })),
  ];
  const { add: canAdd, remove: canRemove } = adjustment.priorityDimensions;
  // A list the version no longer offers still shows while the project uses it.
  const showAdd = canAdd > 0 || initial.add.length > 0;
  const showRemove = canRemove > 0 || initial.remove.length > 0;

  const {
    register,
    control,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isDirty },
  } = useForm<WeightsFormValues>({
    resolver: zodResolver(weightsFormSchema(adjustment)),
    mode: 'onTouched',
    defaultValues: initial,
  });
  const save = useSaveFailure({
    fallback: 'The weighting could not be saved. Try again in a moment.',
    // `OVERLAY_INVALID` is placed by `weightsIssues`, below.
    fields: NO_SERVER_FIELDS,
    setError,
    errors,
  });

  const onSubmit = async (values: WeightsFormValues) => {
    setIsLoading(true);
    setSaved(false);
    try {
      await apiClient.patch<unknown>(projectEndpoint(project.id), { body: overlayBodyOf(values) });
      reset(values);
      setSaved(true);
      router.refresh();
    } catch (err) {
      const refused =
        err instanceof APIClientError && err.code === 'OVERLAY_INVALID'
          ? weightsIssues(err.details)
          : null;
      if (!refused) {
        save.report(err);
        return;
      }
      for (const { field, message } of refused.fields) setError(field, { type: 'server', message });
      save.show(refused.other.join(' ') || 'The weighting does not fit the model version in use.');
    } finally {
      setIsLoading(false);
    }
  };

  const pickList = (name: 'add' | 'remove', most: number, id: string) => (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <div className="grid gap-2 sm:grid-cols-2" role="group" aria-labelledby={id}>
          {dimensions.map((d) => {
            const checked = field.value.includes(d.id);
            const full = !checked && field.value.length >= most;
            return (
              <label key={d.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={checked}
                  disabled={isLoading || full}
                  onCheckedChange={(on) =>
                    field.onChange(
                      on ? [...field.value, d.id] : field.value.filter((x) => x !== d.id)
                    )
                  }
                  onBlur={field.onBlur}
                />
                {d.name}
              </label>
            );
          })}
        </div>
      )}
    />
  );

  return (
    <form
      method="post"
      noValidate
      onSubmit={save.submit(handleSubmit(onSubmit, save.invalid))}
      aria-label={TITLE}
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{TITLE}</CardTitle>
          <CardDescription>
            When you know this project&rsquo;s reader better than the model&rsquo;s averages, shift
            the mix of appeals and what counts as a priority, within the limits this model version
            sets. Every {WORDS.review} in the project is scored this way, and its report says so.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {readable ? null : (
            <p className="text-muted-foreground text-sm" role="note">
              This project&rsquo;s stored adjustment is not in a shape this page can show. Saving
              replaces it with what is set here.
            </p>
          )}
          {appeals.length > 0 ? (
            <fieldset className="space-y-4">
              <legend className="text-sm font-medium">The mix of appeals</legend>
              <div className="grid gap-4 md:grid-cols-2">
                {appeals.map((a) => (
                  <div key={a.id} className="space-y-2">
                    <Label htmlFor={`weight-${a.id}`} className="flex items-center gap-1">
                      {a.name}, in points
                      <FieldHelp title={`${a.name} weight`}>
                        {a.most > 0
                          ? `Points of the mix to add to ${a.name} (or take off, below zero), up to ${a.most} either way. The other appeals give way in proportion, so the mix still adds up to 100.`
                          : `This model version does not let ${a.name} move. Set it to 0 to save.`}
                      </FieldHelp>
                    </Label>
                    <Input
                      id={`weight-${a.id}`}
                      type="number"
                      inputMode="decimal"
                      step="1"
                      min={-a.most}
                      max={a.most}
                      disabled={isLoading}
                      {...register(`weights.${a.id}`, { valueAsNumber: true })}
                    />
                    <FormError message={errors.weights?.[a.id]?.message} />
                  </div>
                ))}
              </div>
            </fieldset>
          ) : null}
          {showAdd ? (
            <fieldset className="space-y-3">
              <legend id="weights-add" className="flex items-center gap-1 text-sm font-medium">
                Make a priority (up to {canAdd})
                <FieldHelp title="Make a priority">
                  A priority counts half again in its appeal&rsquo;s score, and the AI reviewers are
                  told to weigh it. Choose what matters most for this project&rsquo;s reader,
                  whatever the type of copy.
                </FieldHelp>
              </legend>
              {pickList('add', canAdd, 'weights-add')}
              <FormError message={errors.add?.message} />
            </fieldset>
          ) : null}
          {showRemove ? (
            <fieldset className="space-y-3">
              <legend id="weights-remove" className="flex items-center gap-1 text-sm font-medium">
                No longer a priority (up to {canRemove})
                <FieldHelp title="No longer a priority">
                  If the type of copy counts one of these as a priority, it no longer does for this
                  project. One it does not count changes nothing.
                </FieldHelp>
              </legend>
              {pickList('remove', canRemove, 'weights-remove')}
              <FormError message={errors.remove?.message} />
            </fieldset>
          ) : null}
          <div className="space-y-3">
            <div className="flex items-center gap-4">
              <Button type="submit" disabled={isLoading || (!isDirty && readable)}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  'Save weighting'
                )}
              </Button>
              {saved && !isDirty ? (
                <p className="flex items-center gap-2 text-sm" role="status">
                  <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                  Saved.
                </p>
              ) : null}
            </div>
            <SaveError failure={save.failure} />
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
