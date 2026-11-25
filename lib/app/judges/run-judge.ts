/**
 * Run one judge on its workspace's agent (app-plan j3, §8.3, D17), and the
 * editor on its (t-25), through one path: {@link callAgent}.
 *
 * The engine builds the call (`buildJudgeRequest`, t-18; `buildEditorRequest`,
 * t-25); this makes it. The
 * call goes to the provider directly with the agent's binding, not through
 * chat, so the reply can be held to a strict schema. Going direct skips what
 * the chat routes check, so this applies the agent's own limits itself:
 *
 * 1. **Binding**: the agent's provider and model, inherited at run time
 *    (`resolveAgentProviderAndModel`) while either is unset. The bound model
 *    must be on the slot's role's approved list (`approved-models.ts`, j4):
 *    one that is not is refused before anything is spent, never sent.
 * 2. **Budget**: `checkBudget` under `withAgentBudgetLock`, as the chat
 *    handler does, refusing before any provider call when the agent, its
 *    workspace or the install is over its monthly cap. As in chat, a reached
 *    cap stops paid calls only: a judge bound to a local model still runs.
 * 3. **Rate limit**: the agent's `rateLimitRpm`, on a limiter of its own keyed
 *    by agent id. Only when the workspace has set one: the monthly caps
 *    already bound spend, and consumer chat's 10 RPM fallback
 *    (`agentChatLimiter`) means something else.
 * 4. **Call**: `runStructuredCompletion` with the slot's schema in strict
 *    mode and the approved entry's settings: `maxTokens` is the slot's, never
 *    above the entry's (which is within the model's output limit) or the
 *    agent's ceiling; the timeout, which bounds each attempt, and the
 *    reasoning effort are the entry's. A reply that does not parse, or that the engine's validator
 *    refuses as malformed, gets the runner's one retry. A refusal (an empty
 *    reply, which is how OpenAI's strict-mode refusal arrives, or a
 *    content-filter finish) gets none.
 * 5. **Cost**: one `AiCostLog` row per run (one per service tier, in the
 *    rare run whose attempts were served at two), with `{ judge, frameworkVersion,
 *    assessmentId? | ephemeral? }` in its metadata (`editor: 'summary'` in
 *    place of `judge` for the editor), counting every attempt the provider
 *    billed: the retry, and an attempt that failed, as well as the one that
 *    answered. The runner sums both attempts only when it succeeds, so the
 *    usage is read off the provider's responses here instead.
 * 6. **Result**: the engine's post-validated output and its drop record.
 *
 * The call runs in the agent's privacy scope (`agentPrivacyScope`), inside
 * the caller's when there is one, so the agent's privacy mode applies to it.
 *
 * **Tenant context is the caller's.** The agent is looked up by the org's
 * slug, and at `TENANCY_MODE=multi` the provider manager's spend gate refuses
 * a call with no org in context, so `runJudge` runs inside `runAsOrg` (a
 * request's guard enters it; a job or script enters it explicitly).
 *
 * Tenancy posture: `judgeLimiter` is keyed by agent id, unique across orgs.
 */
import type { FrameworkEngine, JudgeDrop, JudgeRequest } from '@/lib/app/frameworks/engine';
import { judgeAgentSlug } from '@/lib/app/judges/agents';
import { approvedEntry, roleOfSlot, type JudgeRole } from '@/lib/app/judges/approved-models';
import { prisma } from '@/lib/db/client';
import { resolveAgentProviderAndModel } from '@/lib/orchestration/llm/agent-resolver';
import { withAgentBudgetLock } from '@/lib/orchestration/llm/budget-mutex';
import { calculateCost, checkBudget, logCost } from '@/lib/orchestration/llm/cost-tracker';
import { ProviderError } from '@/lib/orchestration/llm/provider';
import { primaryCallContext } from '@/lib/orchestration/llm/provider-eligibility';
import { tokeniserForModel } from '@/lib/orchestration/llm/tokeniser';
import { agentPrivacyScope, runInPrivacyScope } from '@/lib/orchestration/privacy/scope';
import { getProvider, isLocalProvider } from '@/lib/orchestration/llm/provider-manager';
import { runStructuredCompletion } from '@/lib/orchestration/llm/structured-completion';
import type { LlmFinishReason, LlmUsage, ReasoningEffort } from '@/lib/orchestration/llm/types';
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
  /** The bound model is not on the approved list for this judge's role. */
  | 'model_not_approved'
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
  | 'provider_error'
  /**
   * Not raised here: the stored job's, for a slot the engine no longer runs
   * (its switch turned off after the assessment was queued).
   */
  | 'slot_unavailable';

/** Whose monthly cap an `over_budget` run reached: the install's, the workspace's or the agent's. */
export type BudgetCap = 'global' | 'org' | 'agent';

const CAP_NAMES: Record<BudgetCap, string> = {
  global: "the install's monthly budget",
  org: "the workspace's monthly budget",
  agent: 'its monthly budget',
};

/** What a judge's attempts were billed, on whatever path the run ended. */
export interface JudgeSpend {
  provider: string;
  model: string;
  usage: { input: number; output: number; attempts: number };
  costUsd: number;
}

/** Why a judge did not produce a reply. Its message never carries the reply or the prompt. */
export class JudgeRunError extends Error {
  readonly code: JudgeRunErrorCode;
  /** For `rate_limited`: when the window resets, in Unix seconds. */
  readonly resetAt?: number;
  /** For `over_budget`: whose monthly cap was reached. */
  readonly cap?: BudgetCap;
  /**
   * What the failed judge was billed, when it reached the provider: a reply
   * that was malformed twice, or a call that failed part-way, still costs.
   */
  spend?: JudgeSpend;

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
   * A run that keeps nothing (`store: false`, §8.2): its cost rows say
   * `ephemeral: true`, and count toward usage and the budget like any other.
   */
  ephemeral?: boolean;
  /**
   * Extra fields for the cost row's metadata, such as a calibration run's id
   * (t-37). They never replace the fields the run itself writes.
   */
  costTags?: Readonly<Record<string, string>>;
  /**
   * Who asked for the run, for the cost row: a real `User.id` from the
   * session, never a synthetic visitor id. Absent for a job.
   */
  userId?: string | null;
}

/** A judge's reply, checked, with what it cost. (Not the `JudgeRun` model, which stores one.) */
export interface JudgeReply<Output> {
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
 * Run the judge for `slot` on the current workspace's agent, through
 * {@link callAgent}.
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
): Promise<JudgeReply<Output>> {
  const reply = await callAgent<Output>({
    agentSlug: judgeAgentSlug(slot),
    role: roleOfSlot(slot),
    name: `${slot} judge`,
    target: slot,
    // A slot this engine cannot run (culture's, with the switch off) is the
    // caller's error, thrown by the engine before anything is counted or spent.
    request: () =>
      input.engine.buildJudgeRequest(slot, input.text, input.ctx, input.projectContext ?? null),
    validate: (reply) => {
      const checked = input.engine.validateJudgeReply(slot, reply, input.text);
      return checked.ok ? { output: checked.output, drops: checked.drops } : null;
    },
    costMetadata: { ...input.costTags, judge: slot },
    phase: 'judge',
    frameworkVersion: input.frameworkVersion,
    ...(input.assessmentId !== undefined ? { assessmentId: input.assessmentId } : {}),
    ...(input.ephemeral ? { ephemeral: true } : {}),
    ...(input.userId !== undefined ? { userId: input.userId } : {}),
  });
  return { slot, ...reply };
}

/**
 * One structured call to one of the app's agents: a judge, or the editor
 * (t-25). The checks in this file's header (binding, approved list, budget,
 * rate limit, privacy scope, cost rows) are made here, once, for both.
 */
export interface AgentCall<Output> {
  /** The agent's slug in the current workspace. */
  agentSlug: string;
  /** Whose approved list the bound model must be on. */
  role: JudgeRole;
  /** How a refusal names the agent: `judge_ethos judge`, `editor`. */
  name: string;
  /** What a missing or switched-off agent is named for: the slot, `the editor`. */
  target: string;
  /**
   * The call, built once the agent is known to exist and be on, and before
   * anything is spent. A throw here is the caller's error and propagates.
   */
  request: () => Omit<JudgeRequest, 'slot'>;
  /** The parsed reply checked, or `null` to refuse it (the one retry follows). */
  validate: (reply: unknown) => { output: Output; drops: JudgeDrop[] } | null;
  /** What the cost row says this call was, beside the run's own fields. */
  costMetadata: Record<string, string | boolean>;
  /** The structured-completion span's phase. */
  phase: string;
  frameworkVersion: string;
  assessmentId?: string;
  ephemeral?: boolean;
  /** Who asked, for the cost row: a real `User.id`, as on {@link RunJudgeInput.userId}. */
  userId?: string | null;
}

/** An agent's checked reply, with what it cost. */
export type AgentReply<Output> = Omit<JudgeReply<Output>, 'slot'>;

/** What every agent call has passed before anything is spent: see this file's header, 1 to 3. */
interface PreparedCall {
  agent: {
    id: string;
    temperature: number;
    maxTokens: number;
    systemInstructions: string;
  };
  binding: Awaited<ReturnType<typeof resolveAgentProviderAndModel>>;
  isLocal: boolean;
  approved: NonNullable<ReturnType<typeof approvedEntry>>;
}

/** What {@link prepareCall} needs to know of a call: who it goes to, and how it is named. */
type CallTarget = Pick<AgentCall<unknown>, 'agentSlug' | 'role' | 'name' | 'target'>;

/**
 * The agent, its binding, the approved entry and the budget and rate-limit
 * checks, in that order, for a structured call ({@link callAgent}) and a
 * streamed one ({@link streamAgent}) alike. `build` makes the request once the
 * agent is known to exist and be on, before the binding is resolved: a throw
 * there is the caller's error and propagates, before anything is spent.
 */
async function prepareCall<Request>(
  call: CallTarget,
  build: () => Request
): Promise<{ prepared: PreparedCall; request: Request }> {
  const { name } = call;
  const agent = await loadAgent(call);
  const request = build();
  const { binding, isLocal, approved } = await bindAgent(call, agent);

  // A reached cap stops paid calls, not free ones, as in the chat handler: an
  // agent bound to a local model still runs. (The org and install caps are
  // also enforced at the provider gate, which exempts local providers too.)
  const budget = await withAgentBudgetLock(agent.id, () => checkBudget(agent.id));
  if (!budget.withinBudget && !isLocal) {
    // Which cap, in the chat handler's order: the install's, then the
    // workspace's, then the agent's own.
    const cap = budget.globalCapExceeded ? 'global' : budget.orgCapExceeded ? 'org' : 'agent';
    throw new JudgeRunError('over_budget', `The ${name} is over ${CAP_NAMES[cap]}.`, {
      cap,
    });
  }

  if (agent.rateLimitRpm !== null) {
    const limit = judgeLimiter.check(agent.id, agent.rateLimitRpm);
    if (!limit.success) {
      throw new JudgeRunError('rate_limited', `The ${name} is over its rate limit.`, {
        resetAt: limit.reset,
      });
    }
  }

  return { prepared: { agent, binding, isLocal, approved }, request };
}

/** The workspace's agent for `call`, refused when it is missing or switched off. */
async function loadAgent(call: CallTarget) {
  const orgId = requireOrgId();
  const agent = await prisma.aiAgent.findUnique({
    where: { orgId_slug: { orgId, slug: call.agentSlug } },
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
    throw new JudgeRunError('agent_not_found', `This workspace has no agent for ${call.target}.`);
  }
  if (!agent.isActive) {
    throw new JudgeRunError('agent_inactive', `The agent for ${call.target} is switched off.`);
  }
  return agent;
}

/**
 * The agent's binding and the approved entry it must be on, refused when the
 * binding cannot be resolved or the model is not approved for the role.
 */
async function bindAgent(
  call: CallTarget,
  agent: { provider: string; model: string }
): Promise<Omit<PreparedCall, 'agent'>> {
  const { name } = call;
  let binding: Awaited<ReturnType<typeof resolveAgentProviderAndModel>>;
  let isLocal: boolean;
  try {
    binding = await resolveAgentProviderAndModel(
      { provider: agent.provider, model: agent.model, fallbackProviders: [] },
      'chat'
    );
    isLocal = await isLocalProvider(binding.providerSlug);
  } catch (err) {
    throw toJudgeRunError(name, err);
  }

  // Only a model on the role's list is sent, with that entry's settings, so
  // no call asks a model for more than it can produce.
  const approved = approvedEntry(call.role, {
    provider: binding.providerSlug,
    model: binding.model,
  });
  if (!approved) {
    throw new JudgeRunError(
      'model_not_approved',
      `The ${name} is bound to "${binding.model}", which is not approved for it.`
    );
  }
  return { binding, isLocal, approved };
}

/** Make one {@link AgentCall}. Fails as {@link runJudge} does. */
export async function callAgent<Output>(call: AgentCall<Output>): Promise<AgentReply<Output>> {
  const { name } = call;
  const { prepared, request } = await prepareCall(call, call.request);
  const { agent, binding, approved } = prepared;

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
      name
    );
    // In the agent's privacy scope (Sunrise 0.19.0), so the privacy stage
    // applies this agent's mode, and the workspace's minimum, to the call and
    // records its counts in the caller's scope (an assessment's). Outside any
    // scope the stage would apply neither. Under `pseudonymise` the reply's
    // quotes come back restored before `parse` sees them, so the engine's
    // check that each quote is in the text still holds.
    const result = await runInPrivacyScope(agentPrivacyScope(agent.id), () =>
      runStructuredCompletion({
        provider,
        model: binding.model,
        messages: [
          { role: 'system', content: agent.systemInstructions },
          { role: 'user', content: request.prompt },
        ],
        parse: (raw) => {
          const reply = parseJson(raw);
          return reply === undefined ? null : call.validate(reply);
        },
        retryUserMessage: RETRY_MESSAGE,
        onFinalFailure: () =>
          new JudgeRunError('malformed', `The ${name}'s reply was not usable, twice.`),
        responseSchema: request.schema,
        responseSchemaName: request.schemaName,
        responseSchemaStrict: true,
        temperature: agent.temperature,
        maxTokens: Math.min(request.maxTokens, approved.settings.maxTokens, agent.maxTokens),
        timeoutMs: approved.settings.timeoutMs,
        ...(approved.settings.reasoningEffort
          ? { reasoningEffort: approved.settings.reasoningEffort }
          : {}),
        phase: call.phase,
      })
    );
    outcome = { value: result.value, finishReason: result.finishReason };
  } catch (err) {
    outcome = { error: toJudgeRunError(name, err) };
  }

  const { rows, spend } = await recordSpend(
    pricingOf(prepared),
    call,
    billed,
    'error' in outcome ? outcome.error.code : undefined
  );

  if ('error' in outcome) {
    // Only a call that reached the provider was billed; one refused before it
    // (the spend gate, a provider that could not be built) carries nothing.
    if (billed.length > 0) outcome.error.spend = spend;
    throw outcome.error;
  }
  return {
    output: outcome.value.output,
    drops: outcome.value.drops,
    ...spend,
    costLogIds: rows.flatMap((row) => (row ? [row.id] : [])),
    finishReason: outcome.finishReason,
  };
}

/**
 * One streamed call to one of the app's agents (t-81): the editor's rewrite.
 * The reply is plain text, so there is no schema to hold it to.
 */
export interface AgentStreamCall extends CallTarget, CostTags {
  /**
   * The call, built once the agent is known to exist and be on, and before
   * anything is spent. A throw here is the caller's error and propagates.
   */
  request: () => {
    prompt: string;
    maxTokens: number;
    /**
     * In place of the approved entry's: a rewrite asks for little thinking,
     * so a long text's reply fits the ceiling with it.
     */
    reasoningEffort?: ReasoningEffort;
  };
  /**
   * Each piece of the reply as it arrives, in order. Awaited before the next
   * is read, so a caller that saves as it goes never falls behind. A throw
   * here stops the call, and what it spent is recorded as a stopped one's is
   * (see {@link streamAgent}).
   */
  onText: (text: string) => void | Promise<void>;
  /**
   * What the call will be priced at, once its checks have passed and before
   * the provider is asked: for a caller that keeps it, so a call whose
   * process dies part-way can still be priced ({@link recordStoppedStream}).
   * Awaited; a throw here is the caller's error and propagates, before
   * anything is spent.
   */
  onStart?: (start: StreamStart) => Promise<void>;
  /** Stops the call, and what it spent is recorded as for `onText`'s throw. */
  signal?: AbortSignal;
}

/** Who a call's cost row says answered it, and at what binding. */
export interface CallPricing {
  agentId: string;
  provider: string;
  model: string;
  isLocal: boolean;
}

/** What a streamed call is priced from: its binding, and the prompt it was sent. */
export interface StreamStart extends CallPricing {
  /** The system instructions and the request, counted by the model's tokeniser. */
  promptTokens: number;
}

/** A streamed call's whole reply, with what it cost. */
export interface AgentStreamReply {
  text: string;
  provider: string;
  model: string;
  usage: { input: number; output: number; attempts: number };
  costUsd: number;
  costLogIds: string[];
  finishReason: LlmFinishReason;
}

/**
 * Make one {@link AgentStreamCall}: the same checks as {@link callAgent}
 * (binding, approved list, budget, rate limit, privacy scope) and the same
 * cost rows, with the reply handed to `onText` as it streams.
 *
 * **One attempt.** A structured call is retried once when its reply does not
 * parse; a streamed one is not, because what it streamed has already been
 * shown and kept, and a second attempt would be billed and shown again.
 *
 * Fails with a {@link JudgeRunError}, carrying what it was billed:
 * `refused` for a content-filter finish or an empty reply, `truncated` for a
 * reply cut off at its ceiling, `provider_error` for anything the provider
 * raised. Under `pseudonymise`, the provider manager restores the reply's
 * placeholders chunk by chunk before `onText` sees them.
 *
 * **A call stopped part-way.** A provider reports a stream's usage in its
 * last event, so one stopped before it (the caller's signal, a throw from
 * `onText`, a dropped connection) reports none, though it was billed. One
 * that had answered at all is recorded at an estimate
 * ({@link estimatedUsage}), its row tagged `estimated`, so the cap and the
 * caller's charge still see it. One stopped before any reply is recorded at
 * nothing: whether the provider read the prompt is not known.
 */
export async function streamAgent(call: AgentStreamCall): Promise<AgentStreamReply> {
  const { name } = call;
  const { prepared, request } = await prepareCall(call, call.request);
  const { agent, binding, approved } = prepared;
  const promptTokens = countTokens(binding.model, [agent.systemInstructions, request.prompt]);
  await call.onStart?.({ ...pricingOf(prepared), promptTokens });

  const billed: LlmUsage[] = [];
  let text = '';
  // Whether the provider answered at all: then it read the prompt, and billed it.
  let answered = false;
  let outcome: { finishReason: LlmFinishReason } | { error: JudgeRunError };
  try {
    const provider = await getProvider(
      binding.providerSlug,
      primaryCallContext(binding.provenance)
    );
    const reasoningEffort = request.reasoningEffort ?? approved.settings.reasoningEffort;
    // In the agent's privacy scope, as a structured call is: the stream is
    // read inside it, which is where the privacy stage runs.
    const finishReason = await runInPrivacyScope(agentPrivacyScope(agent.id), async () => {
      let finish: LlmFinishReason | null = null;
      try {
        for await (const chunk of provider.chatStream(
          [
            { role: 'system', content: agent.systemInstructions },
            { role: 'user', content: request.prompt },
          ],
          {
            model: binding.model,
            temperature: agent.temperature,
            maxTokens: ceilingOf(request.maxTokens, prepared),
            timeoutMs: approved.settings.timeoutMs,
            ...(reasoningEffort ? { reasoningEffort } : {}),
            ...(call.signal ? { signal: call.signal } : {}),
          }
        )) {
          answered = true;
          if (chunk.type === 'text') {
            text += chunk.content;
            await call.onText(chunk.content);
          } else if (chunk.type === 'done') {
            billed.push(chunk.usage);
            finish = chunk.finishReason;
          }
        }
      } catch (err) {
        if (err instanceof ProviderError && err.usage) billed.push(err.usage);
        throw err;
      }
      return finish;
    });
    // A ceiling reached first: a reasoning model can think up to it and write
    // nothing, which is a cut-off reply, not a refusal.
    if (finishReason === 'length') {
      outcome = {
        error: new JudgeRunError('truncated', `The ${name}'s reply was cut off at its limit.`),
      };
    } else if (finishReason === null) {
      // A stream that ended with no terminal chunk, with or without text:
      // what it said may be cut short, and it is no refusal.
      outcome = {
        error: new JudgeRunError('provider_error', `The ${name}'s reply stopped part-way.`),
      };
    } else if (finishReason === 'error' || text.trim() === '') {
      outcome = {
        error: new JudgeRunError('refused', `The provider declined to run the ${name}.`),
      };
    } else {
      outcome = { finishReason };
    }
  } catch (err) {
    outcome = { error: toJudgeRunError(name, err) };
  }

  const estimated = billed.length === 0 && answered;
  if (estimated) billed.push(estimatedUsage(binding.model, promptTokens, text));
  const { rows, spend } = await recordSpend(
    pricingOf(prepared),
    call,
    billed,
    'error' in outcome ? outcome.error.code : undefined,
    estimated
  );
  if ('error' in outcome) {
    if (billed.length > 0) outcome.error.spend = spend;
    throw outcome.error;
  }
  return {
    text,
    ...spend,
    costLogIds: rows.flatMap((row) => (row ? [row.id] : [])),
    finishReason: outcome.finishReason,
  };
}

/**
 * Record a streamed call whose process died part-way (t-85): the cost row
 * {@link streamAgent} would have written had it been stopped there, from
 * what its caller kept of it ({@link AgentStreamCall.onStart}) and the reply
 * saved by then. Tagged `estimated` and with `errorCode`, as a stopped
 * call's row is. Nothing is written for a reply that is empty: as for a
 * stopped call, whether the provider read the prompt is not known.
 *
 * Answers the row, or `null` when there was nothing to write or the write
 * failed (`logCost` logs it).
 */
export async function recordStoppedStream(
  start: StreamStart,
  reply: string,
  call: CostTags,
  errorCode: string
): Promise<{ id: string; totalCostUsd: number } | null> {
  if (reply === '') return null;
  const usage = estimatedUsage(start.model, start.promptTokens, reply);
  const { rows } = await recordSpend(start, call, [usage], errorCode, true);
  return rows[0] ?? null;
}

/**
 * The most one streamed call to `call`'s agent with `request` can cost
 * (t-86): its prompt and its whole output ceiling, at the agent's binding.
 * `0` for a local or unpriced model, which is billed nothing. `null` when
 * the call would be refused before anything is spent (no agent, switched
 * off, a binding that cannot be resolved or is not approved): it costs
 * nothing then. Nothing is checked against a budget or a rate limit, and
 * nothing is spent.
 */
export async function streamCeilingUsd(
  call: CallTarget,
  request: { prompt: string; maxTokens: number }
): Promise<number | null> {
  let prepared: PreparedCall;
  try {
    const agent = await loadAgent(call);
    prepared = { agent, ...(await bindAgent(call, agent)) };
  } catch (err) {
    if (err instanceof JudgeRunError) return null;
    throw err;
  }
  if (prepared.isLocal) return 0;
  const { agent, binding } = prepared;
  const promptTokens = countTokens(binding.model, [agent.systemInstructions, request.prompt]);
  return calculateCost(binding.model, promptTokens, ceilingOf(request.maxTokens, prepared))
    .totalCostUsd;
}

/** The output ceiling a call asks for: the request's, never above the approved entry's or the agent's. */
function ceilingOf(maxTokens: number, prepared: PreparedCall): number {
  return Math.min(maxTokens, prepared.approved.settings.maxTokens, prepared.agent.maxTokens);
}

function pricingOf({ agent, binding, isLocal }: PreparedCall): CallPricing {
  return { agentId: agent.id, provider: binding.providerSlug, model: binding.model, isLocal };
}

/** `parts` counted by `model`'s tokeniser. */
function countTokens(model: string, parts: readonly string[]): number {
  const tokeniser = tokeniserForModel(model);
  return parts.reduce((sum, part) => sum + tokeniser.count(part), 0);
}

/**
 * What a streamed call that stopped before its usage arrived was billed, as
 * near as can be counted: the prompt it was sent, and the reply it had
 * streamed. Thinking it did is not counted, so this is low, never high.
 */
function estimatedUsage(model: string, promptTokens: number, reply: string): LlmUsage {
  return { inputTokens: promptTokens, outputTokens: countTokens(model, [reply]) };
}

/** What a call's cost rows say: who it was for, and what kind of call. */
type CostTags = Pick<
  AgentCall<unknown>,
  'costMetadata' | 'frameworkVersion' | 'assessmentId' | 'ephemeral' | 'userId'
>;

/**
 * Write the cost rows for what a call's attempts were billed, and answer
 * them with the spend they record. One row per service tier the attempts
 * were served at: a row is priced at one tier, and under `auto` one attempt
 * can be priority and the retry standard. Almost always a single row.
 *
 * `logCost` is called with its FK columns written out, so the platform's
 * attribution guard (`cost-log-fk-attribution.test.ts`) can read them:
 * `agent.id` is the row the call loaded (for {@link recordStoppedStream},
 * the one it loaded before its process died), and `userId` is a real `User.id` or
 * nothing (see `AgentCall.userId`). It never rejects: a failed write is
 * logged there and answers `null`.
 */
async function recordSpend(
  pricing: CallPricing,
  call: CostTags,
  billed: readonly LlmUsage[],
  /** The call's failure, when it failed. */
  errorCode: string | undefined,
  /** The usage is {@link estimatedUsage}'s, not the provider's. */
  estimated = false
): Promise<{ rows: Array<{ id: string; totalCostUsd: number } | null>; spend: JudgeSpend }> {
  const { provider, model, isLocal } = pricing;
  const agent = { id: pricing.agentId };
  const rows = await Promise.all(
    [...byTier(billed)].map(([tier, attempts]) => {
      const usage = sumUsage(attempts);
      return logCost({
        agentId: agent.id,
        userId: call.userId ?? null,
        provider,
        model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        ...(usage.cacheReadTokens ? { cacheReadTokens: usage.cacheReadTokens } : {}),
        ...(usage.cacheWriteTokens ? { cacheWriteTokens: usage.cacheWriteTokens } : {}),
        ...(tier ? { serviceTier: tier } : {}),
        operation: CostOperation.CHAT,
        isLocal,
        metadata: {
          ...call.costMetadata,
          frameworkVersion: call.frameworkVersion,
          ...(call.assessmentId ? { assessmentId: call.assessmentId } : {}),
          ...(call.ephemeral ? { ephemeral: true } : {}),
          attempts: attempts.length,
          ...(errorCode ? { error: errorCode } : {}),
          ...(estimated ? { estimated: true } : {}),
        },
      });
    })
  );
  const usage = sumUsage(billed);
  const spend: JudgeSpend = {
    provider,
    model,
    usage: { input: usage.inputTokens, output: usage.outputTokens, attempts: billed.length },
    costUsd: rows.reduce((sum, row) => sum + (row?.totalCostUsd ?? 0), 0),
  };
  return { rows, spend };
}

type Provider = Awaited<ReturnType<typeof getProvider>>;

/**
 * The provider, with every `chat()` result's usage pushed onto `billed`, and
 * a refusal raised as one (no retry: a model or filter that declined once
 * declines again, and the retry would be billed).
 */
function meteredProvider(provider: Provider, billed: LlmUsage[], name: string): Provider {
  const chat: Provider['chat'] = async (messages, options) => {
    try {
      const response = await provider.chat(messages, options);
      billed.push(response.usage);
      // OpenAI's strict-mode refusal arrives as empty content (the adapter
      // drops `message.refusal`), and a content filter as an `error` finish.
      // Neither is a reply of any shape, and a retry would be billed too.
      if (response.finishReason === 'error' || response.content.trim() === '') {
        throw new JudgeRunError('refused', `The provider declined to run the ${name}.`);
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

/** `name` as {@link AgentCall.name} gives it: `judge_ethos judge`, `editor`. */
function toJudgeRunError(name: string, err: unknown): JudgeRunError {
  if (err instanceof JudgeRunError) return err;
  if (err instanceof ProviderError) {
    if (err.code === 'truncated_no_output') {
      return new JudgeRunError('truncated', `The ${name}'s reply was cut off at its limit.`, {
        cause: err,
      });
    }
    return new JudgeRunError('provider_error', `The ${name}'s provider call failed.`, {
      cause: err,
    });
  }
  return new JudgeRunError('provider_error', `The ${name}'s call failed.`, { cause: err });
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
