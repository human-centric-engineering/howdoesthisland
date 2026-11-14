/**
 * Run one judge on its workspace's agent (app-plan j3, §8.3, D17).
 *
 * The engine builds the call (`buildJudgeRequest`, t-18); this makes it. The
 * call goes to the provider directly with the agent's binding, not through
 * chat, so the reply can be held to a strict schema. Going direct skips what
 * the chat routes check, so this applies the agent's own limits itself:
 *
 * 1. **Binding**: the agent's provider and model, inherited at run time
 *    (`resolveAgentProviderAndModel`) while either is unset.
 * 2. **Budget**: `checkBudget` under `withAgentBudgetLock`, as the chat
 *    handler does, refusing before any provider call when the agent, its
 *    workspace or the install is over its monthly cap. As in chat, a reached
 *    cap stops paid calls only: a judge bound to a local model still runs.
 * 3. **Rate limit**: the agent's `rateLimitRpm`, on a limiter of its own keyed
 *    by agent id. Only when the workspace has set one: the monthly caps
 *    already bound spend, and consumer chat's 10 RPM fallback
 *    (`agentChatLimiter`) means something else.
 * 4. **Call**: `runStructuredCompletion` with the slot's schema in strict
 *    mode, the slot's `maxTokens` (never above the agent's ceiling) and its
 *    timeout, which bounds each attempt. A reply that does not parse, or that the engine's validator
 *    refuses as malformed, gets the runner's one retry. A refusal (an empty
 *    reply, which is how OpenAI's strict-mode refusal arrives, or a
 *    content-filter finish) gets none.
 * 5. **Cost**: one `AiCostLog` row per run (one per service tier, in the
 *    rare run whose attempts were served at two), with `{ judge, frameworkVersion,
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
import { resolveAgentProviderAndModel } from '@/lib/orchestration/llm/agent-resolver';
import { withAgentBudgetLock } from '@/lib/orchestration/llm/budget-mutex';
import { checkBudget, logCost } from '@/lib/orchestration/llm/cost-tracker';
import { ProviderError } from '@/lib/orchestration/llm/provider';
import { primaryCallContext } from '@/lib/orchestration/llm/provider-eligibility';
import { getProvider, isLocalProvider } from '@/lib/orchestration/llm/provider-manager';
import { runStructuredCompletion } from '@/lib/orchestration/llm/structured-completion';
import type { LlmFinishReason, LlmUsage } from '@/lib/orchestration/llm/types';
import { createDynamicLimiter } from '@/lib/security/rate-limit';
import { requireOrgId } from '@/lib/tenancy/context';
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

/** Whose monthly cap an `over_budget` run reached: the install's, the workspace's or the agent's. */
export type BudgetCap = 'global' | 'org' | 'agent';

const CAP_NAMES: Record<BudgetCap, string> = {
  global: "the install's monthly budget",
  org: "the workspace's monthly budget",
  agent: 'its monthly budget',
};

/** Why a judge did not produce a reply. Its message never carries the reply or the prompt. */
export class JudgeRunError extends Error {
  readonly code: JudgeRunErrorCode;
  /** For `rate_limited`: when the window resets, in Unix seconds. */
  readonly resetAt?: number;
  /** For `over_budget`: whose monthly cap was reached. */
  readonly cap?: BudgetCap;

  constructor(
    code: JudgeRunErrorCode,
    message: string,
    options: { cause?: unknown; resetAt?: number; cap?: BudgetCap } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'JudgeRunError';
    this.code = code;
    if (options.resetAt !== undefined) this.resetAt = options.resetAt;
    if (options.cap !== undefined) this.cap = options.cap;
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
  /** What the rows written record; a row that could not be written counts nothing. */
  costUsd: number;
  /**
   * The cost rows written: one, or one per service tier when the attempts
   * were served at two. Empty when none could be written.
   */
  costLogIds: string[];
  finishReason: LlmFinishReason;
}

const RETRY_MESSAGE =
  'Your previous reply was not a valid JSON object in the shape the brief gives. Reply again with exactly one JSON object in that shape: no prose around it and no code fences.';

/**
 * Run the judge for `slot` on the current workspace's agent.
 *
 * Every outcome the run decides is a {@link JudgeRunError} with a `code`, and
 * the cost of every billed attempt is logged first, whatever the outcome. Two
 * failures are not the run's to decide and propagate as they are: the
 * database failing (the agent or budget read), and a slot the engine cannot
 * run, which is the caller's error.
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

  // A slot this engine cannot run (culture's, with the switch off) is the
  // caller's error, thrown by the engine before anything is counted or spent.
  const request = input.engine.buildJudgeRequest(
    slot,
    input.text,
    input.ctx,
    input.projectContext ?? null
  );

  let binding: Awaited<ReturnType<typeof resolveAgentProviderAndModel>>;
  let isLocal: boolean;
  try {
    binding = await resolveAgentProviderAndModel(
      { provider: agent.provider, model: agent.model, fallbackProviders: [] },
      'chat'
    );
    isLocal = await isLocalProvider(binding.providerSlug);
  } catch (err) {
    throw toJudgeRunError(slot, err);
  }

  // A reached cap stops paid calls, not free ones, as in the chat handler: a
  // judge bound to a local model still runs. (The org and install caps are
  // also enforced at the provider gate, which exempts local providers too.)
  const budget = await withAgentBudgetLock(agent.id, () => checkBudget(agent.id));
  if (!budget.withinBudget && !isLocal) {
    // Which cap, in the chat handler's order: the install's, then the
    // workspace's, then the agent's own.
    const cap = budget.globalCapExceeded ? 'global' : budget.orgCapExceeded ? 'org' : 'agent';
    throw new JudgeRunError('over_budget', `The ${slot} judge is over ${CAP_NAMES[cap]}.`, {
      cap,
    });
  }

  if (agent.rateLimitRpm !== null) {
    const limit = judgeLimiter.check(agent.id, agent.rateLimitRpm);
    if (!limit.success) {
      throw new JudgeRunError('rate_limited', `The ${slot} judge is over its rate limit.`, {
        resetAt: limit.reset,
      });
    }
  }

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

  // One row per service tier the attempts were served at: a row is priced at
  // one tier, and under `auto` one attempt can be priority and the retry
  // standard. Almost always a single row.
  //
  // `logCost` is called with its FK columns written out, so the platform's
  // attribution guard (`cost-log-fk-attribution.test.ts`) can read them:
  // `agent.id` is the row just loaded, and `userId` is a real `User.id` or
  // nothing (see `RunJudgeInput.userId`). It never rejects: a failed write is
  // logged there and answers `null`.
  const rows = await Promise.all(
    [...byTier(billed)].map(([tier, attempts]) => {
      const usage = sumUsage(attempts);
      return logCost({
        agentId: agent.id,
        userId: input.userId ?? null,
        provider: binding.providerSlug,
        model: binding.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        ...(usage.cacheReadTokens ? { cacheReadTokens: usage.cacheReadTokens } : {}),
        ...(usage.cacheWriteTokens ? { cacheWriteTokens: usage.cacheWriteTokens } : {}),
        ...(tier ? { serviceTier: tier } : {}),
        operation: CostOperation.CHAT,
        isLocal,
        metadata: {
          judge: slot,
          frameworkVersion: input.frameworkVersion,
          ...(input.assessmentId ? { assessmentId: input.assessmentId } : {}),
          attempts: attempts.length,
          ...('error' in outcome ? { error: outcome.error.code } : {}),
        },
      });
    })
  );
  const usage = sumUsage(billed);

  if ('error' in outcome) throw outcome.error;
  return {
    slot,
    output: outcome.value.output,
    drops: outcome.value.drops,
    provider: binding.providerSlug,
    model: binding.model,
    usage: { input: usage.inputTokens, output: usage.outputTokens, attempts: billed.length },
    costUsd: rows.reduce((sum, row) => sum + (row?.totalCostUsd ?? 0), 0),
    costLogIds: rows.flatMap((row) => (row ? [row.id] : [])),
    finishReason: outcome.finishReason,
  };
}

type Provider = Awaited<ReturnType<typeof getProvider>>;

/**
 * The provider, with every `chat()` result's usage pushed onto `billed`, and
 * a refusal raised as one (no retry: a model or filter that declined once
 * declines again, and the retry would be billed).
 */
function meteredProvider(provider: Provider, billed: LlmUsage[], slot: string): Provider {
  const chat: Provider['chat'] = async (messages, options) => {
    try {
      const response = await provider.chat(messages, options);
      billed.push(response.usage);
      // OpenAI's strict-mode refusal arrives as empty content (the adapter
      // drops `message.refusal`), and a content filter as an `error` finish.
      // Neither is a reply of any shape, and a retry would be billed too.
      if (response.finishReason === 'error' || response.content.trim() === '') {
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

/** The attempts' token counts added together. */
function sumUsage(attempts: readonly LlmUsage[]): LlmUsage {
  const total: LlmUsage = { inputTokens: 0, outputTokens: 0 };
  for (const u of attempts) {
    total.inputTokens += u.inputTokens;
    total.outputTokens += u.outputTokens;
    if (u.cacheReadTokens) total.cacheReadTokens = (total.cacheReadTokens ?? 0) + u.cacheReadTokens;
    if (u.cacheWriteTokens) {
      total.cacheWriteTokens = (total.cacheWriteTokens ?? 0) + u.cacheWriteTokens;
    }
  }
  return total;
}

/** The attempts grouped by the service tier that served them, in order. */
function byTier(attempts: readonly LlmUsage[]): Map<LlmUsage['serviceTier'], LlmUsage[]> {
  const groups = new Map<LlmUsage['serviceTier'], LlmUsage[]>();
  for (const u of attempts) groups.set(u.serviceTier, [...(groups.get(u.serviceTier) ?? []), u]);
  return groups;
}
