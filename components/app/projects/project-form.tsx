'use client';

/**
 * A project's brief and defaults (t-71): written once, so a review in the
 * project need not restate who the copy is for. Saves with
 * `PATCH /api/v1/projects/{id}`, which replaces the brief and the defaults
 * whole.
 *
 * Every default picker is filled from the framework version's own ids (its
 * catalogue), with "No default" first: left there, a review takes the
 * version's own default. The culture pickers, and the culture reviewer set,
 * appear only when the version serves countries, which it does only with the
 * culture switch on. A stored default the version cannot take is shown,
 * marked "not in this version", rather than dropped: saving sends it, and the
 * API's refusal says which to change.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Controller, useForm, type Control } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { FieldHelp } from '@/components/ui/field-help';
import { SettingPicker } from '@/components/app/projects/setting-picker';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormError, SaveError } from '@/components/forms/form-error';
import { apiClient, APIClientError } from '@/lib/api/client';
import { useSaveFailure } from '@/lib/hooks/use-save-failure';
import { WORDS } from '@/lib/app/reports/words';
import {
  projectEndpoint,
  type DefaultsCatalogue,
  type ProjectWire,
} from '@/components/app/projects/schemas';
import {
  NO_DEFAULT,
  audiencePickers,
  cultureOptions,
  defaultsIssues,
  formValuesOf,
  patchBodyOf,
  profileOptions,
  projectFormSchema,
  storedContextReadable,
  withStored,
  type PickerOption,
  type ProjectFormValues,
} from '@/components/app/projects/project-defaults';

/** Server path → the field that shows it. */
const SERVER_FIELDS: Partial<Record<string, keyof ProjectFormValues>> = {
  name: 'name',
  'brief.offer': 'offer',
  'brief.audience': 'audience',
  'brief.voice': 'voice',
  'brief.markets': 'markets',
  'brief.goals': 'goals',
};

const BRIEF_FIELDS: Array<{
  key: 'offer' | 'audience' | 'voice' | 'markets' | 'goals';
  label: string;
  help: string;
  placeholder: string;
}> = [
  {
    key: 'offer',
    label: 'What you offer',
    help: 'The product, service or idea the copy sells, in your own words.',
    placeholder: 'For example: a bookkeeping service for sole traders, from £20 a month',
  },
  {
    key: 'audience',
    label: 'Who it is for',
    help: 'The reader you are writing for: who they are, what they know and what they want. The audience defaults below say the same in the model’s own terms.',
    placeholder: 'For example: self-employed tradespeople who do their own books and dread January',
  },
  {
    key: 'voice',
    label: 'Tone of voice',
    help: 'How the brand or author sounds: the words you would use to brief a writer.',
    placeholder: 'For example: plain, warm and a little dry. Never salesy.',
  },
  {
    key: 'markets',
    label: 'Markets',
    help: 'Where the copy runs: countries, regions or markets. Leave it blank if it does not matter.',
    placeholder: 'For example: UK, then Ireland',
  },
  {
    key: 'goals',
    label: 'Goals',
    help: 'What the copy must achieve: the one thing a reader should do or believe after reading it.',
    placeholder: 'For example: book a free 15-minute call',
  },
];

interface PickerProps {
  control: Control<ProjectFormValues>;
  name: `modifiers.${string}` | Exclude<keyof ProjectFormValues, 'modifiers'>;
  id: string;
  label: string;
  help: string;
  options: PickerOption[];
  /** The value the project holds, kept as a choice even when the version lacks it. */
  stored: string;
  disabled: boolean;
  noDefaultLabel?: string;
}

function Picker({
  control,
  name,
  id,
  label,
  help,
  options,
  stored,
  disabled,
  noDefaultLabel = 'No default',
}: PickerProps) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <SettingPicker
          id={id}
          label={label}
          help={help}
          options={withStored(options, stored)}
          value={typeof field.value === 'string' ? field.value : NO_DEFAULT}
          onChange={field.onChange}
          onBlur={field.onBlur}
          disabled={disabled}
          noneLabel={noDefaultLabel}
        >
          <FormError message={fieldState.error?.message} />
        </SettingPicker>
      )}
    />
  );
}

export interface ProjectFormProps {
  project: ProjectWire;
  catalogue: DefaultsCatalogue;
}

export function ProjectForm({ project, catalogue }: ProjectFormProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  // From the project as last loaded, so a refresh after a save drops a
  // picker for a stored value the save cleared.
  const stored = formValuesOf(project, catalogue);
  const [initial] = useState(stored);
  // The culture pickers follow the switch, and also appear while a culture is
  // stored, so one the switch now refuses is seen rather than dropped.
  const showCulture =
    catalogue.request.countries !== undefined ||
    stored.cultureReader !== NO_DEFAULT ||
    stored.cultureWriter !== NO_DEFAULT;
  const audience = audiencePickers(catalogue, stored.modifiers);
  const contextReadable = storedContextReadable(project);
  const {
    register,
    control,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isDirty },
  } = useForm<ProjectFormValues>({
    resolver: zodResolver(projectFormSchema),
    mode: 'onTouched',
    defaultValues: initial,
  });
  const save = useSaveFailure({
    fallback: 'The project could not be saved. Try again in a moment.',
    fields: SERVER_FIELDS,
    setError,
    errors,
  });

  const onSubmit = async (values: ProjectFormValues) => {
    setIsLoading(true);
    setSaved(false);
    try {
      await apiClient.patch<unknown>(projectEndpoint(project.id), {
        body: patchBodyOf(values),
      });
      reset(values);
      setSaved(true);
      router.refresh();
    } catch (err) {
      // The API names each default it refuses; put each under its picker.
      const refused =
        err instanceof APIClientError && err.code === 'DEFAULTS_INVALID'
          ? defaultsIssues(err.details)
          : null;
      if (!refused) {
        save.report(err);
        return;
      }
      for (const { field, message } of refused.fields) setError(field, { type: 'server', message });
      const count = refused.fields.length;
      save.show(
        [
          count ? `${count} ${count === 1 ? 'default needs' : 'defaults need'} changing.` : '',
          ...refused.other,
        ]
          .filter(Boolean)
          .join(' ') || 'The project’s defaults do not fit the model version in use.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const countries = cultureOptions(catalogue);

  return (
    <form
      method="post"
      noValidate
      onSubmit={save.submit(handleSubmit(onSubmit, save.invalid))}
      className="space-y-6"
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">The brief</CardTitle>
          <CardDescription>
            What the copy must do, for whom, in what voice, written down once for the project. Every
            part of it is optional.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="project-name" className="flex items-center gap-1">
              Name
              <FieldHelp title="Project name">
                What the workspace calls this project: a client, a product or a campaign. Only
                people in the workspace see it.
              </FieldHelp>
            </Label>
            <Input
              id="project-name"
              autoComplete="off"
              disabled={isLoading}
              {...register('name')}
            />
            <FormError message={errors.name?.message} />
          </div>
          {BRIEF_FIELDS.map((f) => (
            <div key={f.key} className="space-y-2">
              <Label htmlFor={`brief-${f.key}`} className="flex items-center gap-1">
                {f.label}
                <FieldHelp title={f.label}>{f.help}</FieldHelp>
              </Label>
              <Textarea
                id={`brief-${f.key}`}
                rows={3}
                placeholder={f.placeholder}
                disabled={isLoading}
                {...register(f.key)}
              />
              <FormError message={errors[f.key]?.message} />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Defaults for its {WORDS.review}s</CardTitle>
          <CardDescription>
            What a {WORDS.review} in this project takes unless it says otherwise. Left on No
            default, a {WORDS.review} takes the model&rsquo;s own.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {contextReadable ? null : (
            <p className="text-muted-foreground text-sm" role="note">
              This project&rsquo;s stored defaults are not in a shape this page can show. Saving
              replaces them with what is chosen here.
            </p>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <Picker
              control={control}
              name="contentType"
              stored={stored.contentType}
              id="default-content-type"
              label={WORDS.TypeOfCopy}
              help="What kind of piece it is. It sets the mix of appeals the copy is scored against, and the length it is measured by."
              options={catalogue.request.contentTypes.map((c) => ({ value: c.id, label: c.name }))}
              disabled={isLoading}
            />
            <Picker
              control={control}
              name="profile"
              stored={stored.profile}
              id="default-profile"
              label={WORDS.AiReviewers}
              help="Which AI reviewers read the copy. A set other than the quick scan or all of them also runs the four appeals. More reviewers take longer and cost more."
              options={profileOptions(catalogue)}
              disabled={isLoading}
            />
          </div>

          <fieldset className="space-y-4">
            <legend className="text-sm font-medium">The reader</legend>
            <div className="grid gap-4 md:grid-cols-2">
              <Picker
                control={control}
                name="archetype"
                stored={stored.archetype}
                id="default-archetype"
                label="Reader"
                help="The kind of reader the copy is written for, as the model describes readers."
                options={catalogue.request.archetypes.map((a) => ({ value: a.id, label: a.name }))}
                disabled={isLoading}
              />
              <Picker
                control={control}
                name="role"
                stored={stored.role}
                id="default-role"
                label="Reader’s role"
                help="The reader’s job, when the copy is for a senior decision-maker. Leave it on No default for anyone else."
                options={catalogue.request.roles.map((r) => ({ value: r.id, label: r.name }))}
                disabled={isLoading}
              />
              {audience.map((m) => (
                <Picker
                  key={m.id}
                  control={control}
                  name={`modifiers.${m.id}`}
                  stored={stored.modifiers[m.id] ?? NO_DEFAULT}
                  id={`default-audience-${m.id}`}
                  label={m.name}
                  help={
                    m.help ??
                    `${m.name}, for every review in this project. It changes what the AI reviewers expect of the copy.`
                  }
                  options={m.options}
                  disabled={isLoading}
                />
              ))}
            </div>
          </fieldset>

          {showCulture ? (
            <fieldset className="space-y-4">
              <legend className="text-sm font-medium">Culture</legend>
              <div className="grid gap-4 md:grid-cols-2">
                <Picker
                  control={control}
                  name="cultureReader"
                  stored={stored.cultureReader}
                  id="default-culture-reader"
                  label="Reader’s culture"
                  help="Where the reader is from. The culture reviewer checks the copy against that culture’s expectations."
                  options={countries}
                  disabled={isLoading}
                />
                <Picker
                  control={control}
                  name="cultureWriter"
                  stored={stored.cultureWriter}
                  id="default-culture-writer"
                  label="Writer’s culture"
                  help="Where the writer is from, so the review can point out habits that will not travel to the reader."
                  options={countries}
                  disabled={isLoading}
                />
              </div>
            </fieldset>
          ) : null}
        </CardContent>
      </Card>

      <div className="space-y-3">
        <div className="flex items-center gap-4">
          {/* Unreadable stored defaults can be replaced without changing a field. */}
          <Button type="submit" disabled={isLoading || (!isDirty && contextReadable)}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              'Save project'
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
    </form>
  );
}
