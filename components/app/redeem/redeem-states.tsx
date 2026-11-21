import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AUTH_LANDING_ROUTE } from '@/lib/auth-landing/route';
import { REDEEM_PATH, type CodeCheck } from '@/lib/app/credits/codes/wire';
import { USAGE_PAGE } from '@/lib/app/usage/wire';

/**
 * What `/redeem` shows (t-60): a box to type a code into, why a code cannot
 * be redeemed, and what it gives someone signed out or already holding it.
 * Signed in, the page adds `<RedeemButton>`.
 */

const DATE = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' });

/** `12 March 2027`, in UTC as codes are made. */
export function formatExpiry(iso: string): string {
  return DATE.format(new Date(iso));
}

/** `500 CopyCredits`, or `1 CopyCredit`. */
export function creditsLabel(credits: number): string {
  return `${credits.toLocaleString('en-GB')} CopyCredit${credits === 1 ? '' : 's'}`;
}

/** The redeem page's sheet: a slug, a heading, and what follows. */
export function RedeemPanel({
  slug,
  title,
  children,
}: {
  slug: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby="redeem-heading"
      className="hd-sheet mx-auto max-w-2xl px-6 py-10 md:px-10"
    >
      <p className="hd-slug">{slug}</p>
      <h1 id="redeem-heading" className="mt-3 text-3xl font-bold">
        {title}
      </h1>
      <div className="mt-4 space-y-4 text-lg text-(--hd-muted)">{children}</div>
    </section>
  );
}

/**
 * A box to type a code into. A plain GET form back to this page, so it works
 * without JavaScript and the page checks what was typed.
 */
export function CodeEntryForm({ defaultValue = '' }: { defaultValue?: string }) {
  return (
    <form method="get" action={REDEEM_PATH} className="space-y-3 text-base">
      <Label htmlFor="redeem-code">Your code</Label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          id="redeem-code"
          name="code"
          defaultValue={defaultValue}
          placeholder="ABCD-EFGH-JKMN"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          required
          aria-describedby="redeem-code-hint"
          className="font-mono sm:max-w-xs"
        />
        <Button type="submit">Check code</Button>
      </div>
      <p id="redeem-code-hint" className="text-sm">
        Twelve letters and numbers, from your card or email. Dashes and case don’t matter.
      </p>
    </form>
  );
}

/** No code yet: say what a code is for, and take one. */
export function RedeemEnterCode() {
  return (
    <RedeemPanel slug="Free review code" title="Redeem a code">
      <p>
        A free review code adds CopyCredits to your workspace, which pay for reviews of your copy by
        the AI reviewers.
      </p>
      <CodeEntryForm />
    </RedeemPanel>
  );
}

type Refused = Exclude<CodeCheck, { status: 'active' }>;

const REFUSED_TITLES: Record<Refused['status'], string> = {
  unknown: 'We don’t recognise this code',
  expired: 'This code has expired',
  'used-up': 'This code has been used up',
  revoked: 'This code has been withdrawn',
};

/** Why a code cannot be redeemed, and a box to try another. */
export function RedeemRefused({ check, typed }: { check: Refused; typed: string }) {
  return (
    <RedeemPanel slug="Free review code" title={REFUSED_TITLES[check.status]}>
      {check.status === 'unknown' && <p>Check it against your card or email, and try again.</p>}
      {check.status === 'expired' && (
        <p>
          <span className="font-mono">{check.code}</span> could be redeemed until{' '}
          {formatExpiry(check.expiresAt)}.
        </p>
      )}
      {check.status === 'used-up' && (
        <p>
          <span className="font-mono">{check.code}</span> has been redeemed as many times as it
          allows.
        </p>
      )}
      {check.status === 'revoked' && (
        <p>
          <span className="font-mono">{check.code}</span> can no longer be redeemed.
        </p>
      )}
      <p>If you were given another code, enter it here.</p>
      <CodeEntryForm defaultValue={check.status === 'unknown' ? typed : ''} />
    </RedeemPanel>
  );
}

/** What an active code gives, in a sentence. */
export function CodeGives({ check }: { check: Extract<CodeCheck, { status: 'active' }> }) {
  return (
    <p>
      <span className="font-mono">{check.code}</span> gives your workspace{' '}
      <strong className="text-(--hd-ink)">{creditsLabel(check.credits)}</strong> for reviews by the
      AI reviewers. Redeem it by {formatExpiry(check.expiresAt)}.
    </p>
  );
}

/** Where sign-up and sign-in send someone back to: this page, with the code. */
export function redeemReturnPath(code: string): string {
  return `${REDEEM_PATH}?${new URLSearchParams({ code }).toString()}`;
}

/** An active code, signed out: create an account or sign in, and come back here. */
export function RedeemSignedOut({ check }: { check: Extract<CodeCheck, { status: 'active' }> }) {
  const callback = new URLSearchParams({ callbackUrl: redeemReturnPath(check.code) }).toString();
  return (
    <RedeemPanel slug="Free review code" title="Your code is good">
      <CodeGives check={check} />
      <p>Create an account to redeem it, or sign in if you have one. You’ll come back here.</p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button asChild>
          <Link href={`/signup?${callback}`}>Create an account</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={`/login?${callback}`}>Sign in</Link>
        </Button>
      </div>
    </RedeemPanel>
  );
}

/** Signed in, and this person has redeemed the code already. */
export function RedeemAlreadyRedeemed({ code }: { code: string }) {
  return (
    <RedeemPanel slug="Free review code" title="You’ve redeemed this code">
      <p>
        <span className="font-mono">{code}</span> is already on your account. Each person can redeem
        a code once.
      </p>
      <RedeemNextSteps />
    </RedeemPanel>
  );
}

/** Where to go once the credits are in. */
export function RedeemNextSteps() {
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <Button asChild>
        <Link href={AUTH_LANDING_ROUTE}>Review some copy</Link>
      </Button>
      <Button asChild variant="outline">
        <Link href={USAGE_PAGE}>See your credits</Link>
      </Button>
    </div>
  );
}
