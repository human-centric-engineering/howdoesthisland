/**
 * The shapes the judge-model settings read from
 * `GET /api/v1/workspaces/[id]/judges` (j4), validated rather than cast.
 */
import { z } from 'zod';
import { JUDGE_ROLES } from '@/lib/app/judges/approved-models';

export const judgeModelsEndpoint = (orgId: string): string =>
  `/api/v1/workspaces/${encodeURIComponent(orgId)}/judges`;

export const judgeModelEndpoint = (orgId: string, key: string): string =>
  `${judgeModelsEndpoint(orgId)}/${encodeURIComponent(key)}`;

export const judgeModelChoiceSchema = z.object({
  key: z.string(),
  name: z.string(),
  role: z.enum(JUDGE_ROLES),
  current: z.object({ model: z.string(), label: z.string(), approved: z.boolean() }).nullable(),
  followsDefault: z.boolean(),
  options: z.array(
    z.object({
      model: z.string(),
      label: z.string(),
      tradeoff: z.string(),
      isDefault: z.boolean(),
    })
  ),
});

export type JudgeModelChoiceView = z.infer<typeof judgeModelChoiceSchema>;

export const judgeModelListSchema = z.object({ agents: z.array(judgeModelChoiceSchema) });
