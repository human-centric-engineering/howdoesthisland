/**
 * A workspace choosing the model each judge and the editor runs on (j4, D8).
 *
 * What is offered is the role's approved list (`approved-models.ts`)
 * intersected with what the workspace has available (`availability.ts`), by
 * name, with at most a plain-language trade-off: never a reply ceiling,
 * temperature or reasoning effort, which come with the entry. Anything else is
 * refused, here and, through the agents' `bindingRule`, on Sunrise's agent
 * routes.
 *
 * A choice is a write like the agent PATCH's: the binding becomes the
 * workspace's (`bindingOwner: 'org'`), so the platform stops moving it; a new
 * version is snapshotted; and it is audited. Choosing the default instead
 * hands the binding back to the platform, which puts the agent on its pick
 * now and keeps it there as the default moves.
 *
 * Tenancy posture: every read and write is filtered by the workspace's id as
 * well as running in its tenant context.
 */
import { ConflictError, NotFoundError, ValidationError } from '@/lib/api/errors';
import {
  EDITOR_AGENT_SLUG,
  INTERIM_EDITOR_MODEL,
  INTERIM_JUDGE_MODEL,
  judgeAgentSlug,
} from '@/lib/app/judges/agents';
import {
  APPROVED_MODELS,
  approvedEntry,
  roleOfSlot,
  type JudgeRole,
} from '@/lib/app/judges/approved-models';
import {
  grantedCatalogueAvailability,
  type AvailableModel,
  type ModelAvailability,
} from '@/lib/app/judges/availability';
import { HOWDOESTHISLAND_JUDGE_SLOTS } from '@/lib/app/frameworks/howdoesthisland/judge-slots';
import { prisma } from '@/lib/db/client';
import { buildChangeSummary } from '@/lib/orchestration/agent-version-diff';
import {
  asSnapshotJson,
  buildAgentSnapshot,
  INITIAL_VERSION_SUMMARY,
  isAgentVersionConflict,
  nextAgentVersionNumber,
} from '@/lib/orchestration/agents/agent-versioning';
import { tryReconcilePlatformAgents } from '@/lib/orchestration/agents/reconcile-platform-agents';
import { computeChanges, logAdminAction } from '@/lib/orchestration/audit/admin-audit-logger';

/** One agent a workspace chooses a model for: a judge slot, or the editor. */
interface ChoosableAgent {
  /** The key the API names it by: the judge slot, or `editor`. */
  key: string;
  slug: string;
  role: JudgeRole;
  /** The model the platform runs it on while the workspace has not chosen. */
  defaultModel: string;
}

export const CHOOSABLE_AGENTS: readonly ChoosableAgent[] = [
  ...HOWDOESTHISLAND_JUDGE_SLOTS.map((slot) => ({
    key: slot,
    slug: judgeAgentSlug(slot),
    role: roleOfSlot(slot),
    defaultModel: INTERIM_JUDGE_MODEL,
  })),
  { key: 'editor', slug: EDITOR_AGENT_SLUG, role: 'editor', defaultModel: INTERIM_EDITOR_MODEL },
];

/** A model a workspace may choose, as it sees it. */
export interface ModelOption {
  model: string;
  label: string;
  tradeoff: string;
  /** Whether it is what the platform runs this agent on by default. */
  isDefault: boolean;
}

export interface JudgeModelChoice {
  key: string;
  /** The agent's name, e.g. "Ethos Judge". */
  name: string;
  role: JudgeRole;
  /**
   * What the agent runs on now. `label` is the approved entry's name, or the
   * model id when the model is not on the list (a binding set before the
   * list, or an inherited one); `approved` says which. `null` while it
   * inherits a model at run time.
   */
  current: { model: string; label: string; approved: boolean } | null;
  /** Whether the platform picks the model (the workspace has not chosen). */
  followsDefault: boolean;
  /** The approved models this workspace has available, in the list's order. */
  options: ModelOption[];
}

function offered(
  agent: ChoosableAgent,
  available: readonly AvailableModel[]
): Array<(typeof APPROVED_MODELS)[JudgeRole][number]> {
  return APPROVED_MODELS[agent.role].filter((entry) =>
    available.some((a) => a.provider === entry.provider && a.model === entry.model)
  );
}

/** The one agent row a choice reads and writes: live, the workspace's, by slug. */
function agentWhere(orgId: string, agent: ChoosableAgent) {
  return { orgId, slug: agent.slug, isSystem: true, deletedAt: null };
}

function agentByKey(key: string): ChoosableAgent {
  const agent = CHOOSABLE_AGENTS.find((a) => a.key === key);
  if (!agent) throw new NotFoundError(`No judge or editor called "${key}"`);
  return agent;
}

/** The columns a choice is shown from. */
interface ChoiceRow {
  name: string;
  provider: string;
  model: string;
  bindingOwner: string | null;
}

function choiceOf(
  agent: ChoosableAgent,
  row: ChoiceRow,
  available: readonly AvailableModel[]
): JudgeModelChoice {
  const entry =
    row.provider && row.model
      ? approvedEntry(agent.role, { provider: row.provider, model: row.model })
      : undefined;
  return {
    key: agent.key,
    name: row.name,
    role: agent.role,
    current: row.model
      ? { model: row.model, label: entry?.label ?? row.model, approved: entry !== undefined }
      : null,
    followsDefault: row.bindingOwner === 'platform',
    options: offered(agent, available).map((e) => ({
      model: e.model,
      label: e.label,
      tradeoff: e.tradeoff,
      isDefault: e.model === agent.defaultModel,
    })),
  };
}

/** Each judge and the editor in `orgId`, with what it runs on and what it may. */
export async function listJudgeModels(
  orgId: string,
  availability: ModelAvailability = grantedCatalogueAvailability
): Promise<JudgeModelChoice[]> {
  const [rows, available] = await Promise.all([
    prisma.aiAgent.findMany({
      where: {
        orgId,
        isSystem: true,
        deletedAt: null,
        slug: { in: CHOOSABLE_AGENTS.map((a) => a.slug) },
      },
      select: { slug: true, name: true, provider: true, model: true, bindingOwner: true },
    }),
    availability(),
  ]);
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  return CHOOSABLE_AGENTS.flatMap((agent) => {
    const row = bySlug.get(agent.slug);
    return row ? [choiceOf(agent, row, available)] : [];
  });
}

export interface ChooseJudgeModelInput {
  orgId: string;
  key: string;
  /** A model from the agent's options, or `null` to follow the default. */
  model: string | null;
  userId: string;
  clientIp?: string | null;
  availability?: ModelAvailability;
}

/**
 * Bind one agent to a model from its options, or hand it back to the default.
 * Refuses a model off the role's approved list, or one the workspace does not
 * have available, as a validation error on `model`.
 */
export async function chooseJudgeModel(input: ChooseJudgeModelInput): Promise<JudgeModelChoice> {
  const agent = agentByKey(input.key);
  const [current, available] = await Promise.all([
    prisma.aiAgent.findFirst({
      where: agentWhere(input.orgId, agent),
      include: {
        grantedTags: { select: { tagId: true } },
        grantedDocuments: { select: { documentId: true } },
      },
    }),
    (input.availability ?? grantedCatalogueAvailability)(),
  ]);
  if (!current) throw new NotFoundError(`This workspace has no agent for "${input.key}"`);

  if (input.model === null) {
    if (current.bindingOwner !== 'platform') {
      await prisma.aiAgent.update({
        where: { id: current.id },
        data: { bindingOwner: 'platform' },
      });
      logAdminAction({
        userId: input.userId,
        action: 'agent.update',
        entityType: 'agent',
        entityId: current.id,
        entityName: current.name,
        changes: { bindingOwner: { from: current.bindingOwner, to: 'platform' } },
        clientIp: input.clientIp ?? null,
      });
      // Onto the platform's pick now rather than at the next maintenance
      // pass, which remains the guarantee. Never throws.
      await tryReconcilePlatformAgents(input.orgId, 'agent.bindingOwner');
    }
    return choiceFor(input.orgId, agent, available);
  }

  // The request names a model, not a provider: it is matched against what
  // this workspace is offered, on the agent's current provider first, so a
  // re-save never moves it to another provider offering the same model.
  const matches = offered(agent, available).filter((e) => e.model === input.model);
  const entry = matches.find((e) => e.provider === current.provider) ?? matches[0];
  if (!entry) {
    const listed = APPROVED_MODELS[agent.role].find((e) => e.model === input.model);
    const message = listed
      ? `${listed.label} is not available in this workspace.`
      : `"${input.model}" is not one of the models approved for this job.`;
    throw new ValidationError(message, { model: [message] });
  }

  const sameBinding = current.provider === entry.provider && current.model === entry.model;
  if (sameBinding && current.bindingOwner === 'org') {
    return choiceOf(agent, current, available);
  }

  // A new primary provider is not also its own fallback, as on a restore.
  // `providerConfig` stays, as it does when the agent PATCH or the platform's
  // reconcile moves the provider: it is the workspace's to set.
  const providerChanged = current.provider !== entry.provider;
  const fallbacks = providerChanged
    ? current.fallbackProviders.filter((slug) => slug !== entry.provider)
    : current.fallbackProviders;
  const fallbacksChanged = fallbacks.length !== current.fallbackProviders.length;
  const data = {
    provider: entry.provider,
    model: entry.model,
    bindingOwner: 'org',
    ...(fallbacksChanged ? { fallbackProviders: fallbacks } : {}),
  };
  const grants = {
    grantedTagIds: current.grantedTags.map((g) => g.tagId),
    grantedDocumentIds: current.grantedDocuments.map((g) => g.documentId),
  };
  const changedFields = sameBinding
    ? []
    : [
        ...(providerChanged ? ['provider'] : []),
        ...(current.model !== entry.model ? ['model'] : []),
        ...(fallbacksChanged ? ['fallbackProviders'] : []),
      ];

  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      if (changedFields.length > 0) {
        // An agent created before create-time versioning gets its original
        // version first, as the agent PATCH does.
        const first = await nextAgentVersionNumber(tx, current.id);
        if (first === 1) {
          await tx.aiAgentVersion.create({
            data: {
              agentId: current.id,
              version: 1,
              snapshot: asSnapshotJson(buildAgentSnapshot(current, grants)),
              changeSummary: INITIAL_VERSION_SUMMARY,
              createdBy: input.userId,
            },
          });
        }
        const row = await tx.aiAgent.update({ where: { id: current.id }, data });
        await tx.aiAgentVersion.create({
          data: {
            agentId: current.id,
            version: first === 1 ? 2 : first,
            snapshot: asSnapshotJson(buildAgentSnapshot(row, grants)),
            changeSummary: buildChangeSummary(changedFields),
            createdBy: input.userId,
          },
        });
        return row;
      }
      return tx.aiAgent.update({ where: { id: current.id }, data });
    });
  } catch (err) {
    if (isAgentVersionConflict(err)) {
      throw new ConflictError('The model was changed at the same time elsewhere. Please retry.');
    }
    throw err;
  }

  logAdminAction({
    userId: input.userId,
    action: 'agent.update',
    entityType: 'agent',
    entityId: current.id,
    entityName: current.name,
    changes: computeChanges(
      {
        provider: current.provider,
        model: current.model,
        bindingOwner: current.bindingOwner,
        fallbackProviders: current.fallbackProviders,
      },
      {
        provider: updated.provider,
        model: updated.model,
        bindingOwner: updated.bindingOwner,
        fallbackProviders: updated.fallbackProviders,
      }
    ),
    clientIp: input.clientIp ?? null,
  });

  return choiceOf(agent, updated, available);
}

/** One agent's choice, re-read after the reconcile may have moved it. */
async function choiceFor(
  orgId: string,
  agent: ChoosableAgent,
  available: readonly AvailableModel[]
): Promise<JudgeModelChoice> {
  const row = await prisma.aiAgent.findFirst({
    where: agentWhere(orgId, agent),
    select: { name: true, provider: true, model: true, bindingOwner: true },
  });
  if (!row) throw new NotFoundError(`This workspace has no agent for "${agent.key}"`);
  return choiceOf(agent, row, available);
}
