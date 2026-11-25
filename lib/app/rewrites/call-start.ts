/**
 * What a rewrite keeps of its call as it starts (t-85): enough to price it
 * should its process die part-way through the stream, when the call itself
 * never writes its cost row. `service.ts` writes it (`Rewrite.callStart`),
 * from `streamAgent`'s `onStart`; `recover.ts` reads it back.
 */
import { z } from 'zod';
import type { StreamStart } from '@/lib/app/judges/run-judge';

export const rewriteCallStartSchema = z.object({
  agentId: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  isLocal: z.boolean(),
  promptTokens: z.number().int().nonnegative(),
  /** The framework version its cost row names, as the call's own would. */
  frameworkVersion: z.string().min(1),
}) satisfies z.ZodType<StreamStart & { frameworkVersion: string }>;

export type RewriteCallStart = z.infer<typeof rewriteCallStartSchema>;

/** The stored value read back, or `null` when there is none or it is not one. */
export function parseRewriteCallStart(value: unknown): RewriteCallStart | null {
  const parsed = rewriteCallStartSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
