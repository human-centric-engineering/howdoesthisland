import type { Metadata } from 'next';
import { getServerSession } from '@/lib/auth/utils';
import { checkCode } from '@/lib/app/credits/codes/redeem';
import { MAX_TYPED_CODE } from '@/lib/app/credits/codes/wire';
import { RedeemButton } from '@/components/app/redeem/redeem-button';
import {
  CodeGives,
  RedeemAlreadyRedeemed,
  RedeemEnterCode,
  RedeemPanel,
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
 *   has, says so.
 *
 * Page loads count against the per-IP code tier (`lib/app/rate-limit.ts`).
 */
export default async function RedeemPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams).code;
  const typed = (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, MAX_TYPED_CODE) ?? '';

  let body;
  if (!typed) {
    body = <RedeemEnterCode />;
  } else {
    const session = await getServerSession();
    const check = await checkCode(typed, session?.user.id);
    if (check.status !== 'active') {
      body = <RedeemRefused check={check} typed={typed} />;
    } else if (!session) {
      body = <RedeemSignedOut check={check} />;
    } else if (check.alreadyRedeemed) {
      body = <RedeemAlreadyRedeemed code={check.code} />;
    } else {
      body = (
        <RedeemPanel slug="Free review code" title="Redeem your code">
          <CodeGives check={check} />
          <RedeemButton code={check.code} credits={check.credits} />
        </RedeemPanel>
      );
    }
  }

  return <div className="container mx-auto px-4 py-8">{body}</div>;
}
