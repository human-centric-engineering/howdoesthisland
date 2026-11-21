// @vitest-environment happy-dom

/**
 * `/redeem` (t-60): an async server component. Only the session and
 * `checkCode` are faked; the states and the button render for real.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/auth/utils', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/app/credits/codes/redeem', () => ({ checkCode: vi.fn() }));
vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  apiClient: { post: vi.fn(), get: vi.fn(), delete: vi.fn() },
}));
vi.mock('@/lib/logging', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import RedeemPage from '@/app/(public)/redeem/page';
import { getServerSession } from '@/lib/auth/utils';
import { checkCode } from '@/lib/app/credits/codes/redeem';
import { createMockSession } from '@/tests/types/mocks';

const ACTIVE = {
  status: 'active' as const,
  code: 'ABCD-EFGH-JKMN',
  credits: 500,
  expiresAt: '2027-03-12T23:59:59.999Z',
  alreadyRedeemed: false,
};

const renderPage = async (code?: string | string[], extra: Record<string, string> = {}) =>
  render(
    await RedeemPage({
      searchParams: Promise.resolve(code === undefined ? extra : { code, ...extra }),
    })
  );

const signIn = () => vi.mocked(getServerSession).mockResolvedValue(createMockSession());

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getServerSession).mockResolvedValue(null);
});

describe('RedeemPage', () => {
  it('shows the entry form and checks nothing when there is no code', async () => {
    await renderPage();
    expect(screen.getByRole('heading', { name: 'Redeem a code' })).toBeInTheDocument();
    expect(checkCode).not.toHaveBeenCalled();
  });

  it('treats a blank code as no code', async () => {
    await renderPage('   ');
    expect(screen.getByRole('heading', { name: 'Redeem a code' })).toBeInTheDocument();
    expect(checkCode).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: 'unknown' as const, alreadyRedeemed: false }, 'We don’t recognise this code'],
    [
      {
        status: 'expired' as const,
        code: 'ABCD-EFGH-JKMN',
        expiresAt: '2027-03-12T23:59:59.999Z',
        alreadyRedeemed: false,
      },
      'This code has expired',
    ],
    [
      { status: 'used-up' as const, code: 'ABCD-EFGH-JKMN', alreadyRedeemed: false },
      'This code has been used up',
    ],
    [
      { status: 'revoked' as const, code: 'ABCD-EFGH-JKMN', alreadyRedeemed: false },
      'This code has been withdrawn',
    ],
  ])('shows the refusal for %j', async (check, title) => {
    vi.mocked(checkCode).mockResolvedValue(check);
    await renderPage('abcd');
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /to my workspace/ })).not.toBeInTheDocument();
  });

  it('refills the box with the typed code when it is unknown', async () => {
    vi.mocked(checkCode).mockResolvedValue({ status: 'unknown', alreadyRedeemed: false });
    await renderPage('  typo-code ');
    expect(document.querySelector<HTMLInputElement>('input[name="code"]')?.value).toBe('typo-code');
  });

  it('offers sign-up and sign-in, carrying the code, to someone signed out', async () => {
    vi.mocked(checkCode).mockResolvedValue(ACTIVE);
    await renderPage('abcd');

    const cb = 'callbackUrl=%2Fredeem%3Fcode%3DABCD-EFGH-JKMN';
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      `/signup?${cb}`
    );
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', `/login?${cb}`);
    expect(screen.queryByRole('button', { name: /to my workspace/ })).not.toBeInTheDocument();
    expect(checkCode).toHaveBeenCalledWith('abcd', undefined);
  });

  it('shows the redeem button, checked for this user, to someone signed in', async () => {
    signIn();
    vi.mocked(checkCode).mockResolvedValue(ACTIVE);
    await renderPage('abcd-efgh-jkmn');

    expect(
      screen.getByRole('button', { name: 'Add 500 CopyCredits to my workspace' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Create an account' })).not.toBeInTheDocument();
    expect(checkCode).toHaveBeenCalledWith('abcd-efgh-jkmn', createMockSession().user.id);
  });

  it('says so when the signed-in user has already redeemed it', async () => {
    signIn();
    vi.mocked(checkCode).mockResolvedValue({ ...ACTIVE, alreadyRedeemed: true });
    await renderPage('abcd');

    expect(screen.getByRole('heading', { name: 'You’ve redeemed this code' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /to my workspace/ })).not.toBeInTheDocument();
  });

  it.each([
    ['used up', { status: 'used-up' as const, code: 'ABCD-EFGH-JKMN' }],
    [
      'expired',
      { status: 'expired' as const, code: 'ABCD-EFGH-JKMN', expiresAt: '2026-01-01T00:00:00.000Z' },
    ],
    ['revoked', { status: 'revoked' as const, code: 'ABCD-EFGH-JKMN' }],
  ])(
    'tells someone who redeemed a code now %s that they have it, not why others cannot',
    async (_name, check) => {
      signIn();
      vi.mocked(checkCode).mockResolvedValue({ ...check, alreadyRedeemed: true });
      await renderPage('abcd');

      expect(
        screen.getByRole('heading', { name: 'You’ve redeemed this code' })
      ).toBeInTheDocument();
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    }
  );

  it('says a verification link failed when better-auth sends someone back with an error', async () => {
    vi.mocked(checkCode).mockResolvedValue(ACTIVE);
    await renderPage('abcd', { error: 'TOKEN_EXPIRED' });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The link in your verification email didn’t work'
    );
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('says nothing about verification without an error', async () => {
    vi.mocked(checkCode).mockResolvedValue(ACTIVE);
    await renderPage('abcd');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('uses the first value when code is repeated', async () => {
    vi.mocked(checkCode).mockResolvedValue({ status: 'unknown', alreadyRedeemed: false });
    await renderPage(['first', 'second']);
    expect(checkCode).toHaveBeenCalledWith('first', undefined);
  });

  it('cuts a code over 64 characters to 64 before checking it', async () => {
    vi.mocked(checkCode).mockResolvedValue({ status: 'unknown', alreadyRedeemed: false });
    await renderPage('x'.repeat(100));
    expect(checkCode).toHaveBeenCalledWith('x'.repeat(64), undefined);
  });
});
