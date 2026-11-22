// @vitest-environment happy-dom

/**
 * The project form (t-71): the brief and the defaults, saved with PATCH.
 *
 * Mocked: the API client, the router, and the Radix select (a native one in
 * its place; see `select-mock.tsx`). What is proved: each picker offers only
 * the catalogue's ids, the culture pickers follow the culture switch, every
 * field has its help, the save sends the brief and defaults whole, and a
 * refused save shows by Save.
 *
 * @see components/app/projects/project-form.tsx
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  apiClient: { patch: vi.fn(), post: vi.fn(), get: vi.fn(), delete: vi.fn() },
}));
vi.mock('@/components/ui/select', async () => {
  const { selectMock } = await import('@/tests/unit/components/app/projects/select-mock');
  return selectMock;
});

import { ProjectForm } from '@/components/app/projects/project-form';
import { apiClient, APIClientError } from '@/lib/api/client';
import { aCatalogue, aProject } from '@/tests/unit/components/app/projects/fixtures';

/** The input a label names; the label also holds its help button. */
function field<T extends HTMLElement = HTMLElement>(label: RegExp): T {
  return screen.getByLabelText<T>(label, { selector: 'input, textarea, select' });
}

function optionValues(label: RegExp): string[] {
  const select = field(label);
  return within(select)
    .getAllByRole('option')
    .map((o) => o.getAttribute('value') ?? '');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(apiClient.patch).mockResolvedValue({});
});

describe('ProjectForm pickers', () => {
  it('offers only the version’s ids, after No default', () => {
    render(<ProjectForm project={aProject()} catalogue={aCatalogue()} />);

    expect(optionValues(/^Type of copy/)).toEqual(['__none__', 'general', 'landing_page']);
    expect(optionValues(/^Reader(?!’)/)).toEqual(['__none__', 'general', 'sceptic']);
    expect(optionValues(/^Reader’s role/)).toEqual(['__none__', 'cfo']);
    expect(optionValues(/^Relationship with the reader/)).toEqual(['__none__', 'cold', 'warm']);
  });

  it('leaves out the audience setting the engine refuses (archetype)', () => {
    render(<ProjectForm project={aProject()} catalogue={aCatalogue()} />);

    expect(
      screen.queryByLabelText(/^Audience archetype/, { selector: 'select' })
    ).not.toBeInTheDocument();
  });

  it('has no culture pickers, and no culture reviewer set, with the culture switch off', () => {
    render(<ProjectForm project={aProject()} catalogue={aCatalogue({ culture: false })} />);

    expect(
      screen.queryByLabelText(/^Reader’s culture/, { selector: 'select' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(/^Writer’s culture/, { selector: 'select' })
    ).not.toBeInTheDocument();
    expect(optionValues(/^AI reviewers/)).toEqual(['__none__', 'quick', 'core', 'craft', 'full']);
  });

  it('offers the version’s countries, and the culture reviewers, with the switch on', () => {
    render(<ProjectForm project={aProject()} catalogue={aCatalogue({ culture: true })} />);

    expect(optionValues(/^Reader’s culture/)).toEqual(['__none__', 'global', 'gb']);
    expect(optionValues(/^Writer’s culture/)).toEqual(['__none__', 'global', 'gb']);
    expect(optionValues(/^AI reviewers/)).toContain('culture');
  });

  it('keeps a stored default the version no longer has, marked as such', () => {
    const project = aProject({ defaults: { context: { contentType: 'haiku' } } });
    render(<ProjectForm project={project} catalogue={aCatalogue()} />);

    const select = field<HTMLSelectElement>(/^Type of copy/);
    expect(select.value).toBe('haiku');
    expect(
      within(select).getByRole('option', { name: 'haiku (not in this version)' })
    ).toBeTruthy();
  });
});

describe('ProjectForm help', () => {
  it('gives every field a help popover', () => {
    render(<ProjectForm project={aProject()} catalogue={aCatalogue({ culture: true })} />);

    // Name, five brief parts; type of copy, AI reviewers, reader, role, one
    // audience setting; two culture pickers.
    const fields = 1 + 5 + 4 + 1 + 2;
    expect(screen.getAllByRole('textbox')).toHaveLength(6);
    expect(screen.getAllByRole('combobox')).toHaveLength(fields - 6);
    expect(screen.getAllByRole('button', { name: 'More information' })).toHaveLength(fields);
  });
});

describe('ProjectForm save', () => {
  it('sends the brief and the defaults whole, leaving out what is blank or No default', async () => {
    const user = userEvent.setup();
    render(<ProjectForm project={aProject()} catalogue={aCatalogue({ culture: true })} />);

    await user.clear(field(/^Tone of voice/));
    await user.type(field(/^Goals/), '  Book a call  ');
    await user.selectOptions(field(/^Type of copy/), 'landing_page');
    await user.selectOptions(field(/^Relationship with the reader/), 'warm');
    await user.selectOptions(field(/^Reader’s culture/), 'gb');
    await user.selectOptions(field(/^AI reviewers/), 'craft');
    await user.click(screen.getByRole('button', { name: 'Save project' }));

    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledTimes(1));
    expect(apiClient.patch).toHaveBeenCalledWith('/api/v1/projects/proj-1', {
      body: {
        name: 'Spring launch',
        brief: { offer: 'Bookkeeping for sole traders', goals: 'Book a call' },
        defaults: {
          context: {
            contentType: 'landing_page',
            audience: { relationship: 'warm' },
            culture: { reader: 'gb' },
          },
          profile: 'craft',
        },
      },
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Saved.');
    expect(refresh).toHaveBeenCalled();
  });

  it('sends empty defaults once every picker is back on No default', async () => {
    const user = userEvent.setup();
    const project = aProject({ defaults: { context: { role: 'cfo' }, profile: 'core' } });
    render(<ProjectForm project={project} catalogue={aCatalogue()} />);

    await user.selectOptions(field(/^Reader’s role/), '__none__');
    await user.selectOptions(field(/^AI reviewers/), '__none__');
    await user.click(screen.getByRole('button', { name: 'Save project' }));

    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledTimes(1));
    expect(vi.mocked(apiClient.patch).mock.calls[0]?.[1]).toMatchObject({
      body: { defaults: {} },
    });
  });

  it('shows a refused save by Save, with the server’s message', async () => {
    vi.mocked(apiClient.patch).mockRejectedValue(
      new APIClientError(
        "The project's defaults do not fit its framework's latest version.",
        'DEFAULTS_INVALID',
        400,
        { issues: [{ path: 'defaults.context.contentType', message: 'Not a content type' }] }
      )
    );
    const user = userEvent.setup();
    render(<ProjectForm project={aProject()} catalogue={aCatalogue()} />);

    await user.selectOptions(field(/^Type of copy/), 'general');
    await user.click(screen.getByRole('button', { name: 'Save project' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "The project's defaults do not fit its framework's latest version."
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('puts a refused brief part’s message under that part', async () => {
    vi.mocked(apiClient.patch).mockRejectedValue(
      new APIClientError('Invalid request body', 'VALIDATION_ERROR', 400, {
        errors: [{ path: 'brief.markets', message: 'Too long' }],
      })
    );
    const user = userEvent.setup();
    render(<ProjectForm project={aProject()} catalogue={aCatalogue()} />);

    await user.type(field(/^Markets/), 'UK');
    await user.click(screen.getByRole('button', { name: 'Save project' }));

    expect(await screen.findByText('Too long')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('blocks a blank name without saving', async () => {
    const user = userEvent.setup();
    render(<ProjectForm project={aProject()} catalogue={aCatalogue()} />);

    await user.clear(field(/^Name/));
    await user.click(screen.getByRole('button', { name: 'Save project' }));

    expect(await screen.findByText('Give the project a name')).toBeInTheDocument();
    expect(apiClient.patch).not.toHaveBeenCalled();
  });
});
