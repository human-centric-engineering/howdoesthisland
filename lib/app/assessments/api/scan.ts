/**
 * The quick scan (t-24): deterministic, no model called, nothing stored.
 *
 * It needs no workspace: it reads only the framework tables, which are shared
 * config (`version.ts`), and writes nothing. It takes pasted text only;
 * fetching a page or reading a file needs an account (D14). Whether it is
 * offered at all, and who may run it, is `lib/app/quick-scan.ts` (t-61).
 */
import { z } from 'zod';
import { APIError } from '@/lib/api/errors';
import { countWords } from '@/lib/app/intake/extract-text';
import { assessableText } from '@/lib/app/assessments/text';
import { versionToScore } from '@/lib/app/assessments/api/version';
import { contextFor, notScorable, refusingAsApi } from '@/lib/app/assessments/api/service';
import { scoresOf } from '@/lib/app/assessments/run';
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

export async function runQuickScan(
  body: Omit<z.infer<typeof scanRequestSchema>, 'code'>
): Promise<QuickScanView> {
  const resolved = await versionToScore(body);
  const ctx = contextFor(resolved, body.context);
  const text = await refusingAsApi(() => assessableText(body.text));
  const { engine } = resolved;
  // Answered as `store: false` answers it: the same text would throw again.
  const result = notScorable(
    () => engine.assemble(text, ctx, engine.quickScan(text, ctx), {}, null),
    0
  );
  return {
    framework: resolved.framework,
    wordCount: countWords(text),
    ...scoresOf(result),
    context: ctx,
    result,
  };
}
