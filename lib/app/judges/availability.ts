/**
 * What models a workspace has available: the input the judge-model choice
 * intersects with the approved list (j4, D8).
 *
 * **An input, deliberately.** Today a workspace's models are the providers it
 * is granted and can reach, times the active model catalogue. When Sunrise's
 * tenancy layer manages providers per tenancy (bring-your-own AI, model
 * ranges, admin settings), that answer becomes its; the choice takes any
 * {@link ModelAvailability}, so it is swapped here without a redesign.
 */
import { prisma } from '@/lib/db/client';
import { classifyProvidersByCredential } from '@/lib/orchestration/llm/provider-credentials';
import { resolveEligibleProviders } from '@/lib/orchestration/llm/provider-eligibility';

export interface AvailableModel {
  provider: string;
  model: string;
}

/**
 * The provider/model pairs the current workspace may run a chat call on.
 * Runs in the workspace's tenant context, whose provider policy it asks.
 */
export type ModelAvailability = () => Promise<readonly AvailableModel[]>;

/**
 * Today's availability: every active chat model on a provider that is active,
 * that the workspace's policy (its provider grants) lets it use, and that has
 * a key. Throws when the policy, a fork's eligibility rule or the database
 * cannot be asked, so a failure reads as a failure rather than "nothing
 * available". A provider whose credential resolver failed is left out.
 */
export const grantedCatalogueAvailability: ModelAvailability = async () => {
  const providers = await prisma.aiProviderConfig.findMany({
    where: { isActive: true },
    select: {
      id: true,
      slug: true,
      name: true,
      providerType: true,
      isLocal: true,
      apiKeyEnvVar: true,
    },
  });
  if (providers.length === 0) return [];
  const eligible = new Set(
    await resolveEligibleProviders(
      providers.map((p) => p.slug),
      { task: 'chat', source: 'explicit', primarySlug: null },
      { onFailure: 'throw' }
    )
  );
  const { reachable } = await classifyProvidersByCredential(
    providers.filter((p) => eligible.has(p.slug))
  );
  if (reachable.length === 0) return [];
  const models = await prisma.aiProviderModel.findMany({
    where: { isActive: true, providerSlug: { in: reachable.map((p) => p.slug) } },
    select: { providerSlug: true, modelId: true, capabilities: true },
  });
  return models
    .filter((m) => m.capabilities.includes('chat'))
    .map((m) => ({ provider: m.providerSlug, model: m.modelId }));
};
