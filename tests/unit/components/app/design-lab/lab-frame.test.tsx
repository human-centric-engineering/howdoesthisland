import { afterEach, describe, expect, it, vi } from 'vitest';

const { notFoundError } = vi.hoisted(() => ({ notFoundError: new Error('NEXT_NOT_FOUND') }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw notFoundError;
  },
}));

import { designLabOnly, parseTheme } from '@/components/app/design-lab/lab-frame';

describe('designLabOnly', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('lets the lab render on the development server', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(() => designLabOnly()).not.toThrow();
  });

  it.each(['production', 'test'])('answers 404 when NODE_ENV is %s', (env) => {
    vi.stubEnv('NODE_ENV', env);
    expect(() => designLabOnly()).toThrow(notFoundError);
  });
});

describe('parseTheme', () => {
  it('reads dark only when asked for exactly', () => {
    expect(parseTheme('dark')).toBe('dark');
  });

  it.each([undefined, 'light', 'DARK', '', ['dark']])('falls back to light for %j', (value) => {
    expect(parseTheme(value)).toBe('light');
  });
});
