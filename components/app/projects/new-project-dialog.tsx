'use client';

/**
 * Make a project (t-71): a name, then `POST /api/v1/projects`, then its page,
 * where the brief and defaults are written. The framework is HowDoesThisLand's,
 * the API's default.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Plus } from 'lucide-react';
import { z } from 'zod';

import { apiClient } from '@/lib/api/client';
import { useSaveFailure } from '@/lib/hooks/use-save-failure';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FieldHelp } from '@/components/ui/field-help';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormError, SaveError } from '@/components/forms/form-error';
import { MAX_PROJECT_NAME } from '@/lib/app/projects/validations';
import { PROJECTS_ENDPOINT } from '@/components/app/projects/schemas';

const newProjectSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Give the project a name')
    .max(MAX_PROJECT_NAME, `Keep it under ${MAX_PROJECT_NAME} characters`),
});

type NewProjectInput = z.infer<typeof newProjectSchema>;

const SERVER_FIELDS: Partial<Record<string, keyof NewProjectInput>> = { name: 'name' };

const createdSchema = z.object({ id: z.string() });

export function NewProjectDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors },
  } = useForm<NewProjectInput>({
    resolver: zodResolver(newProjectSchema),
    mode: 'onTouched',
    defaultValues: { name: '' },
  });
  const save = useSaveFailure({
    fallback: 'Could not make the project. Try again in a moment.',
    fields: SERVER_FIELDS,
    setError,
  });

  const onSubmit = async (data: NewProjectInput) => {
    setIsLoading(true);
    let response: unknown;
    try {
      response = await apiClient.post<unknown>(PROJECTS_ENDPOINT, { body: { name: data.name } });
    } catch (err) {
      save.report(err);
      setIsLoading(false);
      return;
    }
    // The project exists from here: nothing below may read as a failed save,
    // or "Try again" would make a second one.
    const created = createdSchema.safeParse(response);
    reset();
    setIsLoading(false);
    setOpen(false);
    if (created.success) router.push(`/projects/${encodeURIComponent(created.data.id)}`);
    else router.refresh();
  };

  const handleOpenChange = (next: boolean) => {
    if (isLoading) return;
    if (!next) {
      reset();
      save.clear();
    }
    setOpen(next);
  };

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        <Plus className="mr-2 h-4 w-4" />
        New project
      </Button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>
              Name it now. You write its brief and defaults on the next page.
            </DialogDescription>
          </DialogHeader>
          <form
            method="post"
            noValidate
            onSubmit={save.submit(handleSubmit(onSubmit, save.invalid))}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="new-project-name" className="flex items-center gap-1">
                Name
                <FieldHelp title="Project name">
                  A client, a product or a campaign: whatever this piece of the workspace&rsquo;s
                  work is called. Everyone in the workspace sees it, and you can change it later.
                </FieldHelp>
              </Label>
              <Input
                id="new-project-name"
                autoComplete="off"
                disabled={isLoading}
                {...register('name')}
              />
              <FormError message={errors.name?.message} />
            </div>
            <SaveError failure={save.failure} />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={isLoading}
                onClick={() => handleOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Making it…
                  </>
                ) : (
                  'Make project'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
