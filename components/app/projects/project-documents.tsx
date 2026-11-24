'use client';

/**
 * A project's background documents (t-74): the files and pages that explain
 * its work, which its AI reviewers are given passages from (t-75), each with
 * its status, and adding and removing them.
 *
 * Adding is `POST /api/v1/projects/{id}/documents`, which answers once the
 * document is read and indexed, so the row being added shows as being read
 * until then. A document someone else is adding reads as `processing` from
 * the list; while any does, the page refreshes every few seconds until it
 * settles, for at most five minutes. One with an admin (`pending_review`,
 * `cleaning`) is not polled: it waits on a person. Adding text the project
 * already holds says so, since the list does not change. Removing is `DELETE …/{docId}`
 * and needs no confirmation: the document can be added again.
 */
import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Globe, Loader2, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldHelp } from '@/components/ui/field-help';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SaveError } from '@/components/forms/form-error';
import { apiClient } from '@/lib/api/client';
import { NO_SERVER_FIELDS, useSaveFailure } from '@/lib/hooks/use-save-failure';
import {
  DOCUMENT_EXTENSIONS,
  projectDocumentEndpoint,
  projectDocumentsEndpoint,
  type ProjectDocumentWire,
} from '@/components/app/projects/schemas';
import { MAX_DOCUMENT_BYTES } from '@/lib/app/projects/validations';
import { readAsBase64 } from '@/lib/app/intake/read-as-base64';

/** How often the list is re-read while a document is still being read. */
export const DOCUMENT_POLL_MS = 4000;

/**
 * The most re-reads before the page stops polling (five minutes): a row left
 * `processing` by a request that died never settles, and a reload reads it again.
 */
export const DOCUMENT_MAX_POLLS = 75;

type Status = ProjectDocumentWire['status'];

/**
 * The status that settles without anyone acting. `pending_review` and
 * `cleaning` wait on an admin (a review, or a cleanup session), so are not polled.
 */
const SETTLING: readonly Status[] = ['processing'];

const STATUS_LABEL: Record<Status, string> = {
  processing: 'Being read',
  ready: 'Ready',
  failed: 'Could not be read',
  pending_review: 'With an admin',
  cleaning: 'With an admin',
};

function StatusBadge({ status }: { status: Status }) {
  if (status === 'ready') return <Badge variant="secondary">{STATUS_LABEL.ready}</Badge>;
  if (status === 'failed') return <Badge variant="destructive">{STATUS_LABEL.failed}</Badge>;
  return (
    <Badge variant="outline" className="gap-1">
      {status === 'processing' ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
      {STATUS_LABEL[status]}
    </Badge>
  );
}

function sourceOf(doc: ProjectDocumentWire): string {
  if (doc.sourceUrl) {
    try {
      return new URL(doc.sourceUrl).hostname;
    } catch {
      return doc.sourceUrl;
    }
  }
  return doc.fileName ?? '';
}

export interface ProjectDocumentsProps {
  projectId: string;
  documents: ProjectDocumentWire[];
}

export function ProjectDocuments({ projectId, documents }: ProjectDocumentsProps) {
  const router = useRouter();
  const [url, setUrl] = useState('');
  /** What is being added: a file's name or a page's address, until the API answers. */
  const [adding, setAdding] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  /** The title of a document an add found the project already holds. */
  const [alreadyHeld, setAlreadyHeld] = useState<string | null>(null);
  const add = useSaveFailure({
    fallback: 'The document could not be added. Try again in a moment.',
    fields: NO_SERVER_FIELDS,
  });
  const remove = useSaveFailure({
    fallback: 'The document could not be removed. Try again in a moment.',
    fields: NO_SERVER_FIELDS,
  });

  const settling = documents.some((doc) => SETTLING.includes(doc.status));
  useEffect(() => {
    if (!settling) return;
    let polls = 0;
    const timer = setInterval(() => {
      router.refresh();
      if (++polls >= DOCUMENT_MAX_POLLS) clearInterval(timer);
    }, DOCUMENT_POLL_MS);
    return () => clearInterval(timer);
  }, [settling, router]);

  const submit = async (label: string, source: Record<string, unknown>) => {
    add.clear();
    setAlreadyHeld(null);
    setAdding(label);
    try {
      const answered = await apiClient.post<ProjectDocumentWire>(
        projectDocumentsEndpoint(projectId),
        { body: { source } }
      );
      const held = documents.find((doc) => doc.id === answered.id);
      if (held) setAlreadyHeld(held.title);
      router.refresh();
      return true;
    } catch (err) {
      add.report(err);
      return false;
    } finally {
      setAdding(null);
    }
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_DOCUMENT_BYTES) {
      add.show(
        `${file.name} is ${(file.size / 1_048_576).toFixed(1)} MB; the largest we read is ${MAX_DOCUMENT_BYTES / 1_048_576} MB.`
      );
      return;
    }
    let base64: string;
    try {
      base64 = await readAsBase64(file);
    } catch {
      add.show(`${file.name} could not be opened. Try choosing it again.`);
      return;
    }
    await submit(file.name, { file: { name: file.name, base64 } });
  };

  const onUrl = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const address = url.trim();
    if (!address) return;
    if (await submit(address, { url: address })) setUrl('');
  };

  const onRemove = async (doc: ProjectDocumentWire) => {
    remove.clear();
    setRemoving(doc.id);
    try {
      await apiClient.delete<unknown>(projectDocumentEndpoint(projectId, doc.id));
      router.refresh();
    } catch (err) {
      remove.report(err);
    } finally {
      setRemoving(null);
    }
  };

  const busy = adding !== null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Background documents</CardTitle>
        <CardDescription>
          Files and pages that explain this project&apos;s work: a positioning paper, a brand guide,
          last year&apos;s campaign. Each is read once and kept in your workspace&apos;s knowledge
          base.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {documents.length === 0 && !adding ? (
          <p className="text-muted-foreground text-sm">No background documents yet.</p>
        ) : (
          <ul className="divide-y rounded-md border" aria-label="Background documents">
            {documents.map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                {doc.sourceUrl ? (
                  <Globe className="text-muted-foreground h-4 w-4 shrink-0" aria-hidden />
                ) : (
                  <FileText className="text-muted-foreground h-4 w-4 shrink-0" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{doc.title}</p>
                  <p className="text-muted-foreground truncate text-xs">{sourceOf(doc)}</p>
                </div>
                <StatusBadge status={doc.status} />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={removing !== null}
                  onClick={() => void onRemove(doc)}
                  aria-label={`Remove ${doc.title}`}
                >
                  {removing === doc.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              </li>
            ))}
            {adding ? (
              <li className="flex items-center gap-3 px-3 py-2" aria-live="polite">
                <Loader2 className="text-muted-foreground h-4 w-4 shrink-0 animate-spin" />
                <p className="min-w-0 flex-1 truncate text-sm">Reading {adding}…</p>
              </li>
            ) : null}
          </ul>
        )}
        <SaveError failure={remove.failure} />

        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="project-document-file" className="flex items-center gap-1">
              Add a file
              <FieldHelp title="Add a file">
                A PDF, Word document, PowerPoint deck, web page, Markdown or plain text file, up to{' '}
                {MAX_DOCUMENT_BYTES / 1_048_576} MB. It is read once and kept in your
                workspace&apos;s knowledge base; the same file added to another project is not read
                twice.
              </FieldHelp>
            </Label>
            <Input
              id="project-document-file"
              type="file"
              accept={DOCUMENT_EXTENSIONS.join(',')}
              disabled={busy}
              onChange={(event) => void onFile(event)}
            />
          </div>
          <form
            method="post"
            noValidate
            className="space-y-2"
            onSubmit={(event) => void onUrl(event)}
          >
            <Label htmlFor="project-document-url" className="flex items-center gap-1">
              Add a page
              <FieldHelp title="Add a page">
                The address of a public web page, such as an About page or a published case study.
                We fetch it once, keep its main text and leave out menus and footers.
              </FieldHelp>
            </Label>
            <div className="flex gap-2">
              <Input
                id="project-document-url"
                type="url"
                inputMode="url"
                placeholder="https://"
                value={url}
                disabled={busy}
                onChange={(event) => setUrl(event.target.value)}
              />
              <Button type="submit" variant="outline" disabled={busy || url.trim() === ''}>
                Add
              </Button>
            </div>
          </form>
        </div>
        {alreadyHeld ? (
          <p role="status" className="text-muted-foreground text-sm">
            This project already holds that text, as {alreadyHeld}.
          </p>
        ) : null}
        <SaveError failure={add.failure} />
      </CardContent>
    </Card>
  );
}
