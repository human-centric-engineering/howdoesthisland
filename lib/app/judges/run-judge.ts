/**
 * Run one judge on its workspace's agent (app-plan j3, §8.3, D17).
 *
 * The engine builds the call (`buildJudgeRequest`, t-18); this makes it. The
 * call goes to the provider directly with the agent's binding, not through
 * chat, so the reply can be held to a strict schema. Going direct skips what
 * the chat routes check, so this applies the agent's own limits itself:
 *
 * 1. **Budget**: `checkBudget` under `withAgentBudgetLock`, as the chat
 *    handler does, refusing before any provider call when the agent, its
 *    workspace or the install is over its monthly cap.
 * 2. **Rate limit**: the agent's `rateLimitRpm`, on a limiter of its own keyed
 *    by agent id. Only when the workspace has set one: the monthly caps
 *    already bound spend, and consumer chat's 10 RPM fallback
 *    (`agentChatLimiter`) means something else.
 * 3. **Binding**: the agent's provider and model, inherited at run time
 *    (`resolveAgentProviderAndModel`) while either is unset.
 * 4. **Call**: `runStructuredCompletion` with the slot's schema in strict
 *    mode and the slot's `maxTokens` / timeout, never above the agent's
 *    ceiling. A reply that does not parse, or that the engine's validator
 *    refuses as malformed, gets the runner's one retry.
 * 5. **Cost**: one `AiCostLog` row per run, with `{ judge, frameworkVersion,
 *    assessmentId? }` in its metadata, counting every attempt the provider
 *    billed: the retry, and an attempt that failed, as well as the one that
 *    answered. The runner sums both attempts only when it succeeds, so the
 *    usage is read off the provider's responses here instead.
 * 6. **Result**: the engine's post-validated output and its drop record.
 *
 * **Tenant context is the caller's.** The agent is looked up by the org's
 * slug, and at `TENANCY_MODE=multi` the provider manager's spend gate refuses
 * a call with no org in context, so `runJudge` runs inside `runAsOrg` (a
 * request's guard enters it; a job or script enters it explicitly).
 *
 * Tenancy posture: `judgeLimiter` is keyed by agent id, unique across orgs.
 */
import type { FrameworkEngine, JudgeDrop } from '@/lib/app/frameworks/engine';
import { judgeAgentSlug } from '@/lib/app/judges/agents';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging';
import { resolveAgentProviderAndModel } from '@/lib/orchestration/llm/agent-resolver';
import { withAgentBudgetLock } from '@/lib/orchestration/llm/budget-mutex';
import { checkBudget, logCost } from '@/lib/orchestration/llm/cost-tracker';
import { ProviderError } from '@/lib/orchestration/llm/provider';
import { primaryCallContext } from '@/lib/orchestration/llm/provider-eligibility';
import { getProvider } from '@/lib/orchestration/llm/provider-manager';
import { runStructuredCompletion } from '@/lib/orchestration/llm/structured-completion';
import type { LlmFinishReason, LlmUsage } from '@/lib/orchestration/llm/types';
import { createDynamicLimiter } from '@/lib/security/rate-limit';
import { requireOrgId } from '@/lib/tenancy/context';
import type { AiCostLog } from '@/types/prisma';
import { CostOperation } from '@/types/orchestration';

/**
 * A limiter of the judges' own, keyed by agent id. Its default is never used:
 * it is asked only with the agent's own `rateLimitRpm`.
 */
const judgeLimiter = createDynamicLimiter('agent-judge', Number.MAX_SAFE_INTEGER);

export type JudgeRunErrorCode =
  /** The workspace has no agent for this slot. */
  | 'agent_not_found'
  /** The workspace has switched the agent off. */
  | 'agent_inactive'
  /** The agent, its workspace or the install is over its monthly budget. */
  | 'over_budget'
  /** The agent's own `rateLimitRpm` is used up for this minute. */
  | 'rate_limited'
  /** Both attempts came back as something other than a reply of the slot's shape. */
  | 'malformed'
  /** The reply was cut off at `maxTokens`, on both attempts. */
  | 'truncated'
  /** The provider declined to answer (a content filter). */
  | 'refused'
  /** The provider call failed: auth, network, timeout, a spend gate. */
  | 'provider_error';

/** Why a judge did not produce a reply. Its message never carries the reply or the prompt. */
export class JudgeRunError extends Error {
  readonly code: JudgeRunErrorCode;
  /** For `rate_limited`: when the window resets, in Unix seconds. */
  readonly resetAt?: number;

  constructor(
    code: JudgeRunErrorCode,
    message: string,
    options: { cause?: unknown; resetAt?: number } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'JudgeRunError';
    this.code = code;
    if (options.resetAt !== undefined) this.resetAt = options.resetAt;
  }
}

export interface RunJudgeInput<Ctx, Output> {
  /** The engine over the version being run (`def.createEngine(model)`). */
  engine: FrameworkEngine<Ctx, unknown, unknown, unknown, Output>;
  /** The version being run, for the cost row: `<framework slug>@<version>`. */
  frameworkVersion: string;
  text: string;
  ctx: Ctx;
  /** The project's context block (f-projects), when the assessment has a project. */
  projectContext?: string | null;
  /** The assessment this run is for; absent on an ephemeral run (§8.2). */
  assessmentId?: string;
  /**
   * Who asked for the run, for the cost row: a real `User.id` from the
   * session, never a synthetic visitor id. Absent for a job.
   */
  userId?: string | null;
}

export interface JudgeRun<Output> {
  slot: string;
  output: Output;
  /** What post-validation dropped or changed in the reply. */
  drops: JudgeDrop[];
  provider: string;
  model: string;
  /** Tokens billed across every attempt. */
  usage: { input: number; output: number; attempts: number };
  costUsd: number;
  /** The cost row's id, or `null` when it could not be written. */
  costLogId: string | null;
  finishReason: LlmFinishReason;
}

const RETRY_MESSAGE =
  'Your previous reply was not a valid JSON object in the shape the brief gives. Reply again with exactly one JSON object in that shape: no prose around it and no code fences.';

/**
 * Run the judge for `slot` on the current workspace's agent. Throws
 * {@link JudgeRunError}; the cost of every billed attempt is logged first,
 * whatever the outcome.
 */
export async function runJudge<Ctx, Output>(
  slot: string,
  input: RunJudgeInput<Ctx, Output>
): Promise<JudgeRun<Output>> {
  const orgId = requireOrgId();
  const slug = judgeAgentSlug(slot);
  const agent = await prisma.aiAgent.findUnique({
    where: { orgId_slug: { orgId, slug } },
    select: {
      id: true,
      isActive: true,
      provider: true,
      model: true,
      temperature: true,
      maxTokens: true,
      rateLimitRpm: true,
      systemInstructions: true,
    },
  });
  if (!agent) {
    throw new JudgeRunError('agent_not_found', `This workspace has no agent for ${slot}.`);
  }
  if (!agent.isActive) {
    throw new JudgeRunError('agent_inactive', `The agent for ${slot} is switched off.`);
  }

  const budget = await withAgentBudgetLock(agent.id, () => checkBudget(agent.id));
  if (!budget.withinBudget) {
    throw new JudgeRunError('over_budget', `The ${slot} judge is over its monthly budget.`);
  }

  if (agent.rateLimitRpm !== null) {
    const limit = judgeLimiter.check(agent.id, agent.rateLimitRpm);
    if (!limit.success) {
      throw new JudgeRunError('rate_limited', `The ${slot} judge is over its rate limit.`, {
        resetAt: limit.reset,
      });
    }
  }

  const binding = await resolveAgentProviderAndModel(
    { provider: agent.provider, model: agent.model, fallbackProviders: [] },
    'chat'
  );
  const request = input.engine.buildJudgeRequest(
    slot,
    input.text,
    input.ctx,
    input.projectContext ?? null
  );

  // Every response the provider returns, and the usage on any error it
  // raises, so the cost row counts what was billed on every path.
  const billed: LlmUsage[] = [];

  let outcome:
    | { value: { output: Output; drops: JudgeDrop[] }; finishReason: LlmFinishReason }
    | { error: JudgeRunError };
  try {
    const provider = meteredProvider(
      await getProvider(binding.providerSlug, primaryCallContext(binding.provenance)),
      billed,
      slot
    );
    const result = await runStructuredCompletion({
      provider,
      model: binding.model,
      messages: [
        { role: 'system', content: agent.systemInstructions },
        { role: 'user', content: request.prompt },
      ],
      parse: (raw) => {
        const reply = parseJson(raw);
        if (reply === undefined) return null;
        const checked = input.engine.validateJudgeReply(slot, reply, input.text);
        return checked.ok ? { output: checked.output, drops: checked.drops } : null;
      },
      retryUserMessage: RETRY_MESSAGE,
      onFinalFailure: () =>
        new JudgeRunError('malformed', `The ${slot} judge's reply was not usable, twice.`),
      responseSchema: request.schema,
      responseSchemaName: request.schemaName,
      responseSchemaStrict: true,
      temperature: agent.temperature,
      maxTokens: Math.min(request.maxTokens, agent.maxTokens),
      timeoutMs: request.timeoutMs,
      phase: 'judge',
    });
    outcome = { value: result.value, finishReason: result.finishReason };
  } catch (err) {
    outcome = { error: toJudgeRunError(slot, err) };
  }

  // `logCost` is called with its FK columns written out, so the platform's
  // attribution guard (`cost-log-fk-attribution.test.ts`) can read them:
  // `agent.id` is the row just loaded, and `userId` is a real `User.id` or
  // nothing (see `RunJudgeInput.userId`).
  const usage = sumUsage(billed);
  const cost =
    billed.length === 0
      ? { id: null, costUsd: 0 }
      : await settleCost(
          logCost({
            agentId: agent.id,
            userId: input.userId ?? null,
            provider: binding.providerSlug,
            model: binding.model,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            ...(usage.cacheReadTokens ? { cacheReadTokens: usage.cacheReadTokens } : {}),
            ...(usage.cacheWriteTokens ? { cacheWriteTokens: usage.cacheWriteTokens } : {}),
            ...(usage.serviceTier ? { serviceTier: usage.serviceTier } : {}),
            operation: CostOperation.CHAT,
            metadata: {
              judge: slot,
              frameworkVersion: input.frameworkVersion,
              ...(input.assessmentId ? { assessmentId: input.assessmentId } : {}),
              attempts: billed.length,
              ...('error' in outcome ? { error: outcome.error.code } : {}),
            },
          }),
          { agentId: agent.id, judge: slot }
        );

  if ('error' in outcome) throw outcome.error;
  return {
    slot,
    output: outcome.value.output,
    drops: outcome.value.drops,
    provider: binding.providerSlug,
    model: binding.model,
    usage: { input: usage.inputTokens, output: usage.outputTokens, attempts: billed.length },
    costUsd: cost.costUsd,
    costLogId: cost.id,
    finishReason: outcome.finishReason,
  };
}

type Provider = Awaited<ReturnType<typeof getProvider>>;

/**
 * The provider, with every `chat()` result's usage pushed onto `billed`, and
 * a content-filter finish raised as a refusal (no retry: a filter that
 * declined once declines again, and the retry would be billed).
 */
function meteredProvider(provider: Provider, billed: LlmUsage[], slot: string): Provider {
  const chat: Provider['chat'] = async (messages, options) => {
    try {
      const response = await provider.chat(messages, options);
      billed.push(response.usage);
      if (response.finishReason === 'error') {
        throw new JudgeRunError('refused', `The provider declined to run the ${slot} judge.`);
      }
      return response;
    } catch (err) {
      if (err instanceof ProviderError && err.usage) billed.push(err.usage);
      throw err;
    }
  };
  // The provider's own fields and methods, through the prototype, with only
  // `chat` replaced.
  const metered: Provider = Object.create(provider) as Provider;
  metered.chat = chat;
  return metered;
}

/** The parsed reply, or `undefined` when `raw` is not JSON. */
function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function toJudgeRunError(slot: string, err: unknown): JudgeRunError {
  if (err instanceof JudgeRunError) return err;
  if (err instanceof ProviderError) {
    if (err.code === 'truncated_no_output') {
      return new JudgeRunError('truncated', `The ${slot} judge's reply was cut off at its limit.`, {
        cause: err,
      });
    }
    return new JudgeRunError('provider_error', `The ${slot} judge's provider call failed.`, {
      cause: err,
    });
  }
  return new JudgeRunError('provider_error', `The ${slot} judge's call failed.`, { cause: err });
}

function sumUsage(billed: readonly LlmUsage[]): LlmUsage {
  const total: LlmUsage = { inputTokens: 0, outputTokens: 0 };
  for (const u of billed) {
    total.inputTokens += u.inputTokens;
    total.outputTokens += u.outputTokens;
    if (u.cacheReadTokens) total.cacheReadTokens = (total.cacheReadTokens ?? 0) + u.cacheReadTokens;
    if (u.cacheWriteTokens) {
      total.cacheWriteTokens = (total.cacheWriteTokens ?? 0) + u.cacheWriteTokens;
    }
    if (u.serviceTier) total.serviceTier = u.serviceTier;
  }
  return total;
}

/**
 * Waits for the run's cost row. A failed write is logged, never thrown: the
 * reply was billed either way, and refusing it would bill a rerun too.
 */
async function settleCost(
  write: Promise<AiCostLog | null>,
  about: { agentId: string; judge: string }
): Promise<{ id: string | null; costUsd: number }> {
  try {
    const row = await write;
    return { id: row?.id ?? null, costUsd: row?.totalCostUsd ?? 0 };
  } catch (err) {
    logger.error('Failed to log a judge run cost', err, about);
    return { id: null, costUsd: 0 };
  }
}
