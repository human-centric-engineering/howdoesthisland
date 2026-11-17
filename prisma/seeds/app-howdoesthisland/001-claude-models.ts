import type { SeedUnit } from '@/prisma/runner';
import { serviceAccountWhere } from '@/lib/auth/account';

/**
 * The current generation of Claude models in the provider-model matrix
 * (t-39, D8 as ruled 2026-11-17: the judges and editor default to them).
 *
 * Sunrise's own matrix (`009-provider-models`) stops at Claude Sonnet 4 and
 * Haiku 4.5, and is Sunrise's to update, so the app adds the models it
 * defaults to here, in its own seed directory, rather than editing 009.
 *
 * Ids are the API's own, dashed (`claude-sonnet-5-5`): the judges' approved
 * list (`lib/app/judges/approved-models.ts`) and `runJudge` match a binding
 * to an entry on the exact id, and the provider refuses any other spelling.
 * Prices are Anthropic's first-party rates per million tokens; Haiku 5.5's
 * are for prompts up to 100K tokens, which every judge call is well under.
 *
 * Update strategy, as 009's: a row this seed wrote (`isDefault: true`) is
 * updated on re-seed; one an admin has edited (`isDefault: false`) is left.
 *
 * Runs after `021-platform-agents`, since app directories sort after the
 * numbered core seeds. On a fresh database that reconcile therefore binds the
 * judges before these rows exist; the platform-agent maintenance job, or the
 * next reconcile, moves them on.
 */
const MODELS = [
  {
    slug: 'anthropic-claude-opus-5-5',
    modelId: 'claude-opus-5-5',
    name: 'Claude Opus 5.5',
    description:
      'Anthropic’s most capable generally available Opus. Deepest reasoning; thinks on every call.',
    tierRole: 'thinking',
    reasoningDepth: 'very_high',
    latency: 'medium',
    costEfficiency: 'medium',
    bestRole: 'Planner / careful judge',
    inputCostPerMillionTokens: 4,
    outputCostPerMillionTokens: 20,
  },
  {
    slug: 'anthropic-claude-sonnet-5-5',
    modelId: 'claude-sonnet-5-5',
    name: 'Claude Sonnet 5.5',
    description: 'Balanced reasoning and speed, at a fraction of Opus’s price.',
    tierRole: 'worker',
    reasoningDepth: 'high',
    latency: 'fast',
    costEfficiency: 'high',
    bestRole: 'Versatile worker agent',
    inputCostPerMillionTokens: 2,
    outputCostPerMillionTokens: 10,
  },
  {
    slug: 'anthropic-claude-haiku-5-5',
    modelId: 'claude-haiku-5-5',
    name: 'Claude Haiku 5.5',
    description: 'Fast and very cheap. For high-volume, latency-sensitive calls.',
    tierRole: 'infrastructure',
    reasoningDepth: 'medium',
    latency: 'very_fast',
    costEfficiency: 'very_high',
    bestRole: 'High-volume worker',
    inputCostPerMillionTokens: 0.1,
    outputCostPerMillionTokens: 0.5,
  },
] as const;

const unit: SeedUnit = {
  name: 'app-howdoesthisland/001-claude-models',
  async run({ prisma, logger }) {
    const admin = await prisma.user.findFirst({
      where: serviceAccountWhere,
      select: { id: true },
    });
    if (!admin) throw new Error('No admin user found — ensure 001-system-owner runs first.');

    let written = 0;
    let skipped = 0;
    for (const model of MODELS) {
      const existing = await prisma.aiProviderModel.findUnique({
        where: { slug: model.slug },
        select: { isDefault: true },
      });
      if (existing && !existing.isDefault) {
        skipped++;
        continue;
      }
      const data = {
        providerSlug: 'anthropic',
        modelId: model.modelId,
        name: model.name,
        description: model.description,
        capabilities: ['chat', 'vision', 'documents'],
        tierRole: model.tierRole,
        deploymentProfiles: ['hosted'],
        reasoningDepth: model.reasoningDepth,
        latency: model.latency,
        costEfficiency: model.costEfficiency,
        contextLength: 'very_high',
        toolUse: 'strong',
        bestRole: model.bestRole,
        costPerMillionTokens:
          (model.inputCostPerMillionTokens + model.outputCostPerMillionTokens) / 2,
        inputCostPerMillionTokens: model.inputCostPerMillionTokens,
        outputCostPerMillionTokens: model.outputCostPerMillionTokens,
      };
      await prisma.aiProviderModel.upsert({
        where: { slug: model.slug },
        update: { ...data, isDefault: true },
        create: { slug: model.slug, ...data, isDefault: true, isActive: true, createdBy: admin.id },
      });
      written++;
    }
    logger.info(`✅ Claude models: ${written} written, ${skipped} skipped (admin-customised)`);
  },
};

export default unit;
