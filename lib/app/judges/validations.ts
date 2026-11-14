/** Request shapes for choosing a judge's model (j4). */
import { z } from 'zod';
import { orgIdSchema } from '@/lib/validations/tenancy';

/** `workspaces/[id]/judges/[key]` segments: a judge slot or `editor`. */
export const judgeModelParamsSchema = z.object({
  id: orgIdSchema,
  key: z.string().regex(/^(judge_[a-z_]+|editor)$/, 'Not a judge or the editor'),
});

/** `{ model }`: a model id from the agent's options, or `null` for the default. */
export const chooseJudgeModelSchema = z.object({
  model: z.string().trim().min(1).max(200).nullable(),
});
