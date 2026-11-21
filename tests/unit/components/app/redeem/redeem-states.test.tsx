// @vitest-environment happy-dom

/**
 * What `/redeem` shows (t-60): the entry box, why a code is refused, the
 * signed-out hand-off to sign-up / sign-in, and the already-redeemed state.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import {
  CodeEntryForm,
  RedeemAlreadyRedeemed,
  RedeemEnterCode,
  RedeemNextSteps,
  RedeemRefused,
  RedeemSignedOut,
  creditsLabel,
  formatExpiry,
  redeemReturnPath,
} from '@/components/app/redeem/redeem-states';
import { AUTH_LANDING_ROUTE } from '@/lib/auth-landing/route';
import { USAGE_PAGE } from '@/lib/app/usage/wire';

const ACTIVE = {
  status: 'active' as const,
  code: 'ABCD-EFGH-JKMN',
  credits: 500,
  expiresAt: '2027-03-12T23:59:59.999Z',
};

function codeInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[name="code"]');
  if (!input) throw new Error('no code input rendered');
  return input;
}

describe('formatExpiry', () => {
  it('formats as an en-GB long date', () => {
    expect(formatExpiry('2027-03-12T10:00:00.000Z')).toBe('12 March 2027');
  });

  it('reads the date in UTC, not the local zone', () => {
    // 23:59 UTC is still the 12th, whatever zone the process runs in.
    expect(formatExpiry('2027-03-12T23:59:59.999Z')).toBe('12 March 2027');
    expect(formatExpiry('2027-03-13T00:00:00.000Z')).toBe('13 March 2027');
  });
});

describe('creditsLabel', () => {
  it('is singular for exactly one', () => {
    expect(creditsLabel(1)).toBe('1 CopyCredit');
  });

  it.each([0, 2, 500])('is plural for %i', (n) => {
    expect(creditsLabel(n)).toBe(`${n} CopyCredits`);
  });

  it('puts a thousands separator in large amounts', () => {
    expect(creditsLabel(12500)).toBe('12,500 CopyCredits');
  });
});

describe('redeemReturnPath', () => {
  it('returns to /redeem carrying the code', () => {
    expect(redeemReturnPath('ABCD-EFGH-JKMN')).toBe('/redeem?code=ABCD-EFGH-JKMN');
  });

  it('encodes characters that would break the query', () => {
    expect(redeemReturnPath('a b&c=d')).toBe('/redeem?code=a+b%26c%3Dd');
  });
});

describe('CodeEntryForm', () => {
  it('is a GET form to /redeem with an input named code, left for the page to check', () => {
    render(<CodeEntryForm />);
    const form = codeInput().closest('form');
    expect(form).toHaveAttribute('method', 'get');
    expect(form).toHaveAttribute('action', '/redeem');
    // The page answers an empty or malformed code itself, so the browser does not block it.
    expect(codeInput()).not.toBeRequired();
    expect(codeInput().closest('form')).toHaveAttribute('novalidate');
    expect(screen.getByLabelText('Your code')).toBe(codeInput());
    expect(screen.getByRole('button', { name: 'Check code' })).toHaveAttribute('type', 'submit');
  });

  it('starts empty, or with the default it is given', () => {
    const { unmount } = render(<CodeEntryForm />);
    expect(codeInput().value).toBe('');
    unmount();
    render(<CodeEntryForm defaultValue="abc" />);
    expect(codeInput().value).toBe('abc');
  });
});

describe('RedeemEnterCode', () => {
  it('asks for a code with the entry form', () => {
    render(<RedeemEnterCode />);
    expect(screen.getByRole('heading', { level: 1, name: 'Redeem a code' })).toBeInTheDocument();
    expect(codeInput().closest('form')).toHaveAttribute('action', '/redeem');
  });
});

describe('RedeemRefused', () => {
  it.each([
    ['unknown', { status: 'unknown' as const }, 'We don’t recognise this code'],
    [
      'expired',
      { status: 'expired' as const, code: 'ABCD-EFGH-JKMN', expiresAt: '2027-03-12T23:59:59.999Z' },
      'This code has expired',
    ],
    [
      'used-up',
      { status: 'used-up' as const, code: 'ABCD-EFGH-JKMN' },
      'This code has been used up',
    ],
    [
      'revoked',
      { status: 'revoked' as const, code: 'ABCD-EFGH-JKMN' },
      'This code has been withdrawn',
    ],
  ])('says %s in the heading', (_status, check, title) => {
    render(<RedeemRefused check={check} typed="whatever" />);
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
  });

  it('names the expiry date for an expired code', () => {
    render(
      <RedeemRefused
        check={{ status: 'expired', code: 'ABCD-EFGH-JKMN', expiresAt: '2027-03-12T23:59:59.999Z' }}
        typed="x"
      />
    );
    expect(screen.getByText(/until 12 March 2027/)).toBeInTheDocument();
    expect(screen.getByText('ABCD-EFGH-JKMN')).toBeInTheDocument();
  });

  it('refills the box with what was typed only for an unknown code', () => {
    const { unmount } = render(<RedeemRefused check={{ status: 'unknown' }} typed="abcd-typo" />);
    expect(codeInput().value).toBe('abcd-typo');
    unmount();

    for (const status of ['used-up', 'revoked'] as const) {
      const view = render(
        <RedeemRefused check={{ status, code: 'ABCD-EFGH-JKMN' }} typed="abcd-efgh-jkmn" />
      );
      expect(codeInput().value).toBe('');
      view.unmount();
    }

    render(
      <RedeemRefused
        check={{ status: 'expired', code: 'ABCD-EFGH-JKMN', expiresAt: '2027-03-12T23:59:59.999Z' }}
        typed="abcd-efgh-jkmn"
      />
    );
    expect(codeInput().value).toBe('');
  });
});

describe('RedeemSignedOut', () => {
  it('sends sign-up and sign-in back to /redeem with the code, URL-encoded', () => {
    render(<RedeemSignedOut check={ACTIVE} />);
    const expected = `callbackUrl=${encodeURIComponent('/redeem?code=ABCD-EFGH-JKMN')}`;
    expect(expected).toBe('callbackUrl=%2Fredeem%3Fcode%3DABCD-EFGH-JKMN');

    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      `/signup?${expected}`
    );
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      `/login?${expected}`
    );
  });

  it('says what the code gives and when it expires', () => {
    render(<RedeemSignedOut check={ACTIVE} />);
    expect(screen.getByText('500 CopyCredits')).toBeInTheDocument();
    expect(screen.getByText(/Redeem it by 12 March 2027/)).toBeInTheDocument();
  });
});

describe('RedeemAlreadyRedeemed', () => {
  it('says the code is already on the account, with next steps', () => {
    render(<RedeemAlreadyRedeemed code="ABCD-EFGH-JKMN" />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'You’ve redeemed this code' })
    ).toBeInTheDocument();
    expect(screen.getByText('ABCD-EFGH-JKMN')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See your credits' })).toBeInTheDocument();
  });
});

describe('RedeemNextSteps', () => {
  it('links to the landing route and the usage page', () => {
    render(<RedeemNextSteps />);
    expect(screen.getByRole('link', { name: 'Review some copy' })).toHaveAttribute(
      'href',
      AUTH_LANDING_ROUTE
    );
    expect(screen.getByRole('link', { name: 'See your credits' })).toHaveAttribute(
      'href',
      USAGE_PAGE
    );
  });
});
