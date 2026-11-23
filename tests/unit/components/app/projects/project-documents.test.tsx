// @vitest-environment happy-dom

/**
 * A project's background documents (t-74): the list with each one's status,
 * adding a file or a page, and removing one.
 *
 * @see components/app/projects/project-documents.tsx
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  apiClient: { post: vi.fn(), delete: vi.fn() },
}));

import { DOCUMENT_POLL_MS, ProjectDocuments } from '@/components/app/projects/project-documents';
import { DOCUMENT_EXTENSIONS, type ProjectDocumentWire } from '@/components/app/projects/schemas';
import { SUPPORTED_EXTENSIONS } from '@/lib/app/intake/extract-text';
import { apiClient, APIClientError } from '@/lib/api/client';

function aDocument(over: Partial<ProjectDocumentWire> = {}): ProjectDocumentWire {
  return {
    id: 'doc-1',
    title: 'Brand guide',
    fileName: 'brand-guide.pdf',
    sourceUrl: null,
    status: 'ready',
    chunkCount: 12,
    addedAt: '2026-11-23T10:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ProjectDocuments', () => {
  it('lists each document with where it came from and its status', () => {
    render(
      <ProjectDocuments
        projectId="proj-1"
        documents={[
          aDocument(),
          aDocument({
            id: 'doc-2',
            title: 'About us',
            fileName: null,
            sourceUrl: 'https://example.com/about',
            status: 'processing',
          }),
          aDocument({ id: 'doc-3', title: 'Old deck', status: 'failed' }),
          aDocument({ id: 'doc-4', title: 'Tone notes', status: 'cleaning' }),
        ]}
      />
    );

    const rows = within(screen.getByRole('list', { name: 'Background documents' })).getAllByRole(
      'listitem'
    );
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringMatching(/Brand guide.*brand-guide\.pdf.*Ready/),
      expect.stringMatching(/About us.*example\.com.*Being read/),
      expect.stringMatching(/Old deck.*Could not be read/),
      expect.stringMatching(/Tone notes.*With an admin/),
    ]);
  });

  it('says when there are none', () => {
    render(<ProjectDocuments projectId="proj-1" documents={[]} />);

    expect(screen.getByText('No background documents yet.')).toBeInTheDocument();
  });

  it('adds a file as base64 and refreshes the page', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({});
    const user = userEvent.setup();
    render(<ProjectDocuments projectId="proj-1" documents={[]} />);

    const file = new File(['Our voice is plain.'], 'voice.txt', { type: 'text/plain' });
    await user.upload(screen.getByLabelText(/Add a file/, { selector: 'input' }), file);

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(apiClient.post).toHaveBeenCalledWith('/api/v1/projects/proj-1/documents', {
      body: {
        source: { file: { name: 'voice.txt', base64: btoa('Our voice is plain.') } },
      },
    });
  });

  it('shows the file being read until the API answers', async () => {
    let answer: (value: unknown) => void = () => {};
    vi.mocked(apiClient.post).mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const user = userEvent.setup();
    render(<ProjectDocuments projectId="proj-1" documents={[]} />);

    await user.upload(
      screen.getByLabelText(/Add a file/, { selector: 'input' }),
      new File(['x'], 'voice.txt')
    );

    expect(await screen.findByText('Reading voice.txt…')).toBeInTheDocument();
    expect(screen.getByLabelText(/Add a file/, { selector: 'input' })).toBeDisabled();
    await act(async () => answer({}));
    await waitFor(() => expect(screen.queryByText('Reading voice.txt…')).toBeNull());
  });

  it('refuses a file over the size cap without sending it', async () => {
    const user = userEvent.setup();
    render(<ProjectDocuments projectId="proj-1" documents={[]} />);

    const big = new File(['x'], 'huge.pdf');
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
    await user.upload(screen.getByLabelText(/Add a file/, { selector: 'input' }), big);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'huge.pdf is 11.0 MB; the largest we read is 10 MB.'
    );
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('adds a page by its address and clears the field', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({});
    const user = userEvent.setup();
    render(<ProjectDocuments projectId="proj-1" documents={[]} />);

    await user.type(
      screen.getByLabelText(/Add a page/, { selector: 'input' }),
      'https://example.com/about'
    );
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(apiClient.post).toHaveBeenCalledWith('/api/v1/projects/proj-1/documents', {
      body: { source: { url: 'https://example.com/about' } },
    });
    expect(screen.getByLabelText(/Add a page/, { selector: 'input' })).toHaveValue('');
  });

  it('shows why an add was refused and keeps the address', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(
      new APIClientError('This page could not be fetched.', 'FETCH_FAILED', 422)
    );
    const user = userEvent.setup();
    render(<ProjectDocuments projectId="proj-1" documents={[]} />);

    await user.type(
      screen.getByLabelText(/Add a page/, { selector: 'input' }),
      'https://example.com/gone'
    );
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This page could not be fetched.');
    expect(screen.getByLabelText(/Add a page/, { selector: 'input' })).toHaveValue(
      'https://example.com/gone'
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it('removes a document with DELETE and refreshes the page', async () => {
    vi.mocked(apiClient.delete).mockResolvedValue({});
    const user = userEvent.setup();
    render(<ProjectDocuments projectId="proj-1" documents={[aDocument()]} />);

    await user.click(screen.getByRole('button', { name: 'Remove Brand guide' }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(apiClient.delete).toHaveBeenCalledWith('/api/v1/projects/proj-1/documents/doc-1');
  });

  it('re-reads the list while a document is still being read, and stops once none is', () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <ProjectDocuments projectId="proj-1" documents={[aDocument({ status: 'processing' })]} />
    );

    vi.advanceTimersByTime(DOCUMENT_POLL_MS);
    expect(refresh).toHaveBeenCalledTimes(1);

    rerender(<ProjectDocuments projectId="proj-1" documents={[aDocument()]} />);
    vi.advanceTimersByTime(DOCUMENT_POLL_MS * 3);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('accepts the file types intake reads', () => {
    expect([...DOCUMENT_EXTENSIONS].sort()).toEqual([...SUPPORTED_EXTENSIONS].sort());
  });
});
