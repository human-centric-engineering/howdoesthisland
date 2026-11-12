'use client';

/**
 * Create a team workspace (t-8): a name, then `POST /api/v1/workspaces`.
 *
 * On success it hands the new workspace's id to `onCreated`, which switches
 * into it: someone who has just made a workspace means to work in it.
 */
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
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
import { createdWorkspaceSchema } from '@/components/app/workspaces/schemas';
import {
  MAX_OWNED_WORKSPACES,
  createWorkspaceSchema,
  type CreateWorkspaceInput,
} from '@/lib/app/workspaces/validations';

/** The route's path; a fork route, so not in core's `API` table. */
export const WORKSPACES_ENDPOINT = '/api/v1/workspaces';

const SERVER_FIELDS: Partial<Record<string, keyof CreateWorkspaceInput>> = { name: 'name' };

export interface CreateWorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new workspace once it exists. */
  onCreated: (workspace: { id: string; name: string }) => Promise<void> | void;
}

export function CreateWorkspaceDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateWorkspaceDialogProps) {
  const [isLoading, setIsLoading] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors },
  } = useForm<CreateWorkspaceInput>({
    resolver: zodResolver(createWorkspaceSchema),
    mode: 'onTouched',
    defaultValues: { name: '' },
  });
  const save = useSaveFailure({
    fallback: 'Could not create the workspace. Try again in a moment.',
    fields: SERVER_FIELDS,
    setError,
  });

  const onSubmit = async (data: CreateWorkspaceInput) => {
    setIsLoading(true);
    try {
      const created = createdWorkspaceSchema.parse(
        await apiClient.post<unknown>(WORKSPACES_ENDPOINT, { body: data })
      );
      await onCreated(created);
      reset();
      onOpenChange(false);
    } catch (err) {
      save.report(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (isLoading) return;
    if (!next) {
      reset();
      save.clear();
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New workspace</DialogTitle>
          <DialogDescription>
            A shared workspace for a team. You will be its owner and can invite people from its
            settings.
          </DialogDescription>
        </DialogHeader>
        <form
          method="post"
          noValidate
          onSubmit={save.submit(handleSubmit(onSubmit, save.invalid))}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="workspace-name" className="flex items-center gap-1">
              Name
              <FieldHelp title="Workspace name">
                What everyone in the workspace sees in the switcher, such as your team or
                company&rsquo;s name. You can own up to {MAX_OWNED_WORKSPACES} workspaces, your own
                included.
              </FieldHelp>
            </Label>
            <Input
              id="workspace-name"
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
                  Creating…
                </>
              ) : (
                'Create workspace'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
