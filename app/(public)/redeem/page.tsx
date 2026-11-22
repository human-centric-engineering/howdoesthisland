import type { Metadata } from 'next';
import { getServerSession } from '@/lib/auth/utils';
import { checkCode } from '@/lib/app/credits/codes/redeem';
import { MAX_TYPED_CODE } from '@/lib/app/credits/codes/wire';
import { RedeemSignedIn } from '@/components/app/redeem/redeem-signed-in';
import {
  RedeemAlreadyRedeemed,
  RedeemEnterCode,
  RedeemRefused,
  RedeemSignedOut,
} from '@/components/app/redeem/redeem-states';

export const metadata: Metadata = {
  title: 'Redeem a code',
  description: 'Redeem a free review code for CopyCredits.',
  // The code is in the URL: never in a search index, never sent on.
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

/**
 * `/redeem?code=…`: where a free review code is used (t-60). A code's QR
 * card and its link land here (`redeemLink()`, t-59).
 *
 * Public. The code is checked with the service the check API answers from
 * (`checkCode`), as `/r/[token]` reads its link. Then:
 *
 * - no code: a box to type one into;
 * - not redeemable: says which, `unknown` for anything malformed or not found
 *   alike, and takes another;
 * - signed out: what it gives, and sign-up or sign-in that come back here
 *   with the code (their `callbackUrl`);
 * - signed in: what it gives, and a press that redeems it into the active
 *   workspace through `POST /api/v1/codes/redeem`; or, if this person already
 *   has, says so, ahead of the code's own state: someone who used a personal
 *   code's one redemption is told they have it, not that it is used up, as
 *   `redeemCode` tells them.
 *
 * A failed email verification comes back here (the sign-up form passes this
 * page as better-auth's `callbackURL`), with better-auth's `?error=`; the
 * panel then says the link did not work: signed out, how to get a new one;
 * signed in (as someone else, which is one way it fails), that the account
 * it was for is not verified, before offering to redeem as the person signed
 * in.
 *
 * A load with a code counts against the per-IP code tier
 * (`lib/app/rate-limit.ts`); one without, as the header's prefetched link is,
 * does not (t-66).
 */
export default async function RedeemPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params.code;
  const verificationFailed = params.error !== undefined;
  const typed = (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, MAX_TYPED_CODE) ?? '';

  let body;
  if (!typed) {
    body = <RedeemEnterCode />;
  } else {
    const session = await getServerSession();
    const check = await checkCode(typed, session?.user.id);
    if (session && check.status !== 'unknown' && check.alreadyRedeemed) {
      body = <RedeemAlreadyRedeemed code={check.code} />;
    } else if (check.status !== 'active') {
      body = <RedeemRefused check={check} typed={typed} />;
    } else if (!session) {
      body = <RedeemSignedOut check={check} verificationFailed={verificationFailed} />;
    } else {
      body = <RedeemSignedIn check={check} verificationFailed={verificationFailed} />;
    }
  }

  return <div className="container mx-auto px-4 py-8">{body}</div>;
}
