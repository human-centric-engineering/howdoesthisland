'use client';

/**
 * Archive a project, or restore an archived one (t-71). Archiving is
 * `DELETE /api/v1/projects/{id}` and keeps the project's reviews linked to it;
 * restoring is `PATCH { archived: false }`. Neither loses anything, so neither
 * asks to confirm.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { SaveError } from '@/components/forms/form-error';
import { apiClient } from '@/lib/api/client';
import { NO_SERVER_FIELDS, useSaveFailure } from '@/lib/hooks/use-save-failure';
import { projectEndpoint } from '@/components/app/projects/schemas';

export interface ProjectArchiveProps {
  projectId: string;
  archived: boolean;
}

export function ProjectArchive({ projectId, archived }: ProjectArchiveProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const save = useSaveFailure({
    fallback: archived
      ? 'The project could not be restored. Try again in a moment.'
      : 'The project could not be archived. Try again in a moment.',
    fields: NO_SERVER_FIELDS,
  });

  const toggle = async () => {
    save.clear();
    setBusy(true);
    try {
      if (archived) {
        await apiClient.patch<unknown>(projectEndpoint(projectId), { body: { archived: false } });
      } else {
        await apiClient.delete<unknown>(projectEndpoint(projectId));
      }
      router.refresh();
    } catch (err) {
      save.report(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" disabled={busy} onClick={() => void toggle()}>
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        {archived ? 'Restore project' : 'Archive project'}
      </Button>
      <SaveError failure={save.failure} />
    </div>
  );
}
