/**
 * The models a workspace may run each judge and the editor on, and each
 * model's settings for that job (app-plan j4, D8 as amended 2026-11-14).
 *
 * **Why a list.** An agent's `maxTokens` is code-owned and written back by
 * every reconcile, so a workspace that binds a judge to a model with a lower
 * output limit has every call refused: `gpt-4o` stops at 16,384 tokens, and
 * the influence judge and the editor are set to 32,768. And the knobs that
 * would fix it (reply ceiling, reasoning effort, timeout) mean nothing to a
 * workspace. So a workspace chooses a model by name from its role's list, and
 * the entry carries what that model needs for the job.
 *
 * **Roles.** Three, because the jobs differ in size: a judge (a few thousand
 * tokens of scores, highlights and recommendations), the influence judge
 * (every perspective × lever, about 10–15k) and the editor (a rewrite of the
 * whole text, about 10–15k). A model can be on one role's list and not
 * another's.
 *
 * **Each entry's settings stay within its model's output limit**, which is
 * recorded beside them and held to by the tests. The judge call
 * (`runJudge`) takes its reply ceiling, timeout and reasoning effort from the
 * entry for the bound model, and refuses a binding with no entry rather than
 * sending it. The reply ceiling is a cap: a call still asks for no more than
 * its own job needs (`JUDGE_LIMITS`).
 *
 * **This is the interim list.** The interim models (`gpt-4.1` for the
 * judges, `gpt-5` for the editor) and candidates whose output limits are
 * published. k3 admits or removes entries, and sets their settings, by
 * measurement. Reasoning effort is `null` (the provider's default) until then.
 *
 * Output limits are the providers' published maximum output tokens; the
 * platform's model catalogue (`AiProviderModel`) does not carry them.
 */
import type { PlatformAgentBinding } from '@/lib/orchestration/agents/platform-agents';
import type { ReasoningEffort } from '@/lib/orchestration/llm/types';

export const JUDGE_ROLES = ['judge', 'influence', 'editor'] as const;
export type JudgeRole = (typeof JUDGE_ROLES)[number];

/** What a call to this model, in this role, is sent with. */
export interface ApprovedModelSettings {
  /** The most one call may produce, thinking included. At most `outputLimit`. */
  maxTokens: number;
  /** `null`: the provider's default. */
  reasoningEffort: ReasoningEffort | null;
  /** How long one attempt may take, in milliseconds. */
  timeoutMs: number;
}

export interface ApprovedModel {
  /** Provider slug, as on `AiProviderConfig.slug`. */
  provider: string;
  /** Model id, as on `AiProviderModel.modelId`. Unique within a role's list. */
  model: string;
  /** The model's name, as a workspace sees it. */
  label: string;
  /** At most one plain-language sentence on what choosing it trades. */
  tradeoff: string;
  /** The model's published maximum output tokens. */
  outputLimit: number;
  settings: ApprovedModelSettings;
}

const GPT_4_1 = { provider: 'openai', model: 'gpt-4.1', label: 'GPT-4.1', outputLimit: 32_768 };
const GPT_5 = { provider: 'openai', model: 'gpt-5', label: 'GPT-5', outputLimit: 128_000 };
const GPT_4O = { provider: 'openai', model: 'gpt-4o', label: 'GPT-4o', outputLimit: 16_384 };
const CLAUDE_SONNET_4 = {
  provider: 'anthropic',
  model: 'claude-sonnet-4',
  label: 'Claude Sonnet 4',
  outputLimit: 64_000,
};
const CLAUDE_HAIKU_4_5 = {
  provider: 'anthropic',
  model: 'claude-haiku-4.5',
  label: 'Claude Haiku 4.5',
  outputLimit: 64_000,
};

/** Two minutes for a judge, four for the larger jobs, longer on a reasoning model. */
const JUDGE_TIMEOUT_MS = 120_000;
const LARGE_TIMEOUT_MS = 240_000;
const REASONING_JUDGE_TIMEOUT_MS = 180_000;
const REASONING_LARGE_TIMEOUT_MS = 300_000;

const settings = (maxTokens: number, timeoutMs: number): ApprovedModelSettings => ({
  maxTokens,
  reasoningEffort: null,
  timeoutMs,
});

export const APPROVED_MODELS: Readonly<Record<JudgeRole, readonly ApprovedModel[]>> = {
  judge: [
    {
      ...GPT_4_1,
      tradeoff: 'The default: quick and consistent.',
      settings: settings(16_384, JUDGE_TIMEOUT_MS),
    },
    {
      ...GPT_5,
      tradeoff: 'Thinks before it scores: slower, and costs more.',
      settings: settings(16_384, REASONING_JUDGE_TIMEOUT_MS),
    },
    {
      ...GPT_4O,
      tradeoff: 'An older model: cheaper, and less careful.',
      settings: settings(16_384, JUDGE_TIMEOUT_MS),
    },
    {
      ...CLAUDE_SONNET_4,
      tradeoff: "Anthropic's all-rounder.",
      settings: settings(16_384, JUDGE_TIMEOUT_MS),
    },
    {
      ...CLAUDE_HAIKU_4_5,
      tradeoff: 'Fast and cheap, and less thorough.',
      settings: settings(16_384, JUDGE_TIMEOUT_MS),
    },
  ],
  influence: [
    {
      ...GPT_4_1,
      tradeoff: 'The default: quick and consistent.',
      settings: settings(32_768, LARGE_TIMEOUT_MS),
    },
    {
      ...GPT_5,
      tradeoff: 'Thinks before it scores: slower, and costs more.',
      settings: settings(32_768, REASONING_LARGE_TIMEOUT_MS),
    },
    {
      ...GPT_4O,
      tradeoff: 'Cheaper, but its shorter replies can cut a long report short.',
      settings: settings(16_384, LARGE_TIMEOUT_MS),
    },
    {
      ...CLAUDE_SONNET_4,
      tradeoff: "Anthropic's all-rounder.",
      settings: settings(32_768, LARGE_TIMEOUT_MS),
    },
  ],
  editor: [
    {
      ...GPT_5,
      tradeoff: 'The default: the most careful rewrites.',
      settings: settings(32_768, REASONING_LARGE_TIMEOUT_MS),
    },
    {
      ...GPT_4_1,
      tradeoff: 'Quicker and cheaper, and plainer rewrites.',
      settings: settings(32_768, LARGE_TIMEOUT_MS),
    },
    {
      ...CLAUDE_SONNET_4,
      tradeoff: "Anthropic's all-rounder.",
      settings: settings(32_768, LARGE_TIMEOUT_MS),
    },
  ],
};

/** The role a judge slot runs in: the influence judge's own, or a judge's. */
export function roleOfSlot(slot: string): Exclude<JudgeRole, 'editor'> {
  return slot === 'judge_influence' ? 'influence' : 'judge';
}

/** The entry for `binding` on `role`'s list, or `undefined` when it has none. */
export function approvedEntry(
  role: JudgeRole,
  binding: PlatformAgentBinding
): ApprovedModel | undefined {
  return APPROVED_MODELS[role].find(
    (entry) => entry.provider === binding.provider && entry.model === binding.model
  );
}

const ROLE_NAMES: Record<JudgeRole, string> = {
  judge: 'this judge',
  influence: 'the influence judge',
  editor: 'the editor',
};

/** Why `binding` is refused for `role`, or `null` when it is on the list. */
export function refuseUnapproved(role: JudgeRole, binding: PlatformAgentBinding): string | null {
  if (approvedEntry(role, binding)) return null;
  const names = APPROVED_MODELS[role].map((entry) => entry.label).join(', ');
  const what = binding.model ? `"${binding.model}"` : 'Inheriting a model';
  return `${what} is not approved for ${ROLE_NAMES[role]}. Choose one of: ${names}.`;
}
