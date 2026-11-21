'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { SaveError } from '@/components/forms/form-error';
import { apiClient } from '@/lib/api/client';
import { useSaveFailure } from '@/lib/hooks/use-save-failure';
import {
  CODES_REDEEM_ENDPOINT,
  redemptionSchema,
  type Redemption,
} from '@/lib/app/credits/codes/wire';
import { creditsLabel, RedeemNextSteps } from '@/components/app/redeem/redeem-states';

/**
 * Signed in, an active code: one press redeems it into the workspace the
 * person is acting in (`POST /api/v1/codes/redeem`), then says what it gave
 * and where to go next. A press, not a redemption on load, so the person sees
 * what they are adding before they add it, and a link opened by anything
 * else redeems nothing.
 */
export function RedeemButton({ code, credits }: { code: string; credits: number }) {
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<Redemption | null>(null);
  const save = useSaveFailure({ fallback: 'That did not work. Try again in a moment.' });

  async function redeem() {
    save.clear();
    setPending(true);
    try {
      const data = await apiClient.post<unknown>(CODES_REDEEM_ENDPOINT, { body: { code } });
      setDone(redemptionSchema.parse(data));
    } catch (err) {
      save.report(err);
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-4" role="status">
        <p className="text-(--hd-ink)">
          Added <strong>{creditsLabel(done.credits)}</strong> to {done.workspace.name}. Its balance
          is now {creditsLabel(done.balance)}.
        </p>
        <RedeemNextSteps />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Button type="button" onClick={() => void redeem()} disabled={pending}>
        {pending ? 'Adding…' : `Add ${creditsLabel(credits)} to my workspace`}
      </Button>
      <SaveError failure={save.failure} />
    </div>
  );
}
