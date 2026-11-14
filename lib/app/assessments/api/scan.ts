/**
 * The free quick scan (t-24, D7): deterministic, no model called, nothing
 * stored.
 *
 * Open to anyone, signed in or not, and needs no workspace: it reads only the
 * framework tables, which are shared config (`version.ts`), and writes
 * nothing. It takes pasted text only; fetching a page or reading a file needs
 * an account (D14).
 */
import { z } from 'zod';
import { APIError } from '@/lib/api/errors';
import { countWords } from '@/lib/app/intake/extract-text';
import { assessableText } from '@/lib/app/assessments/text';
import { resolveVersion } from '@/lib/app/assessments/api/version';
import { contextFor, refusingAsApi, scoresOf } from '@/lib/app/assessments/api/service';
import type { QuickScanView } from '@/lib/app/assessments/api/views';
import type { scanRequestSchema } from '@/lib/app/assessments/api/validations';

/** Keys a signed-in caller may send to `POST assessments`, and an anonymous scan may not. */
const ACCOUNT_ONLY = ['url', 'file', 'source'] as const;

const bodyObject = z.record(z.string(), z.unknown());

/**
 * Refuse a scan that asks for a page or a file, with a reason, before the
 * strict schema would answer it as an unknown key.
 */
export function refuseAccountOnlyInput(body: unknown): void {
  const parsed = bodyObject.safeParse(body);
  if (!parsed.success) return;
  if (ACCOUNT_ONLY.some((key) => key in parsed.data)) {
    throw new APIError(
      'Fetching a page or reading a file needs an account. Paste the text here, or sign in and use POST /api/v1/assessments.',
      'ACCOUNT_REQUIRED',
      401
    );
  }
}

export async function quickScan(body: z.infer<typeof scanRequestSchema>): Promise<QuickScanView> {
  const resolved = await resolveVersion(body);
  const ctx = contextFor(resolved, body.context);
  const text = await refusingAsApi(() => assessableText(body.text));
  const { engine } = resolved;
  const result = engine.assemble(text, ctx, engine.quickScan(text, ctx), {}, null);
  return {
    framework: resolved.framework,
    wordCount: countWords(text),
    ...scoresOf(result),
    context: ctx,
    result,
  };
}
