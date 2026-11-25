// @vitest-environment happy-dom

/**
 * The invitation to write a brief (t-83).
 *
 * @see components/app/projects/brief-invite.tsx
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BriefInvite, briefHref, hasBrief } from '@/components/app/projects/brief-invite';

describe('hasBrief', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty brief', {}],
    ['parts that are only whitespace', { offer: '   ', voice: '\n\t' }],
    ['parts left undefined', { offer: undefined, goals: undefined }],
  ])('is false for %s', (_name, brief) => {
    expect(hasBrief(brief)).toBe(false);
  });

  it('is true when any one part says something, however many are blank', () => {
    expect(hasBrief({ offer: '  ', goals: ' Book a call ' })).toBe(true);
  });
});

describe('briefHref', () => {
  it('names the project’s page, encoding its id', () => {
    expect(briefHref('proj-1')).toBe('/projects/proj-1');
    expect(briefHref('a/b c')).toBe('/projects/a%2Fb%20c');
  });

  it('names the projects page for copy in no project', () => {
    expect(briefHref(null)).toBe('/projects');
  });
});

describe('BriefInvite', () => {
  it('links a project with no brief to its own page', () => {
    render(<BriefInvite projectId="proj-1" runs="rewrite" />);
    expect(screen.getByRole('complementary', { name: 'Add a brief' })).toBeInTheDocument();
    expect(screen.getByText('This project has no brief yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Write the project’s brief' })).toHaveAttribute(
      'href',
      '/projects/proj-1'
    );
  });

  it('links copy in no project to the projects page', () => {
    render(<BriefInvite projectId={null} runs="rewrite" />);
    expect(screen.getByText('This copy is in no project, so it has no brief')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Make a project with a brief' })).toHaveAttribute(
      'href',
      '/projects'
    );
  });

  it('says what still runs without one: the rewrite, or the review', () => {
    const { unmount } = render(<BriefInvite projectId={null} runs="rewrite" />);
    expect(screen.getByText(/the rewrite runs all the same/)).toBeInTheDocument();
    unmount();
    render(<BriefInvite projectId={null} runs="review" />);
    expect(screen.getByText(/the review runs all the same/)).toBeInTheDocument();
  });
});
