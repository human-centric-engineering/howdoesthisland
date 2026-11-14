/**
 * @see lib/app/judges/availability.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  prisma: {
    aiProviderConfig: { findMany: vi.fn() },
    aiProviderModel: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/orchestration/llm/provider-eligibility', () => ({
  resolveEligibleProviders: vi.fn(),
}));
vi.mock('@/lib/orchestration/llm/provider-credentials', () => ({
  classifyProvidersByCredential: vi.fn(),
}));

import { prisma } from '@/lib/db/client';
import { resolveEligibleProviders } from '@/lib/orchestration/llm/provider-eligibility';
import { classifyProvidersByCredential } from '@/lib/orchestration/llm/provider-credentials';
import { grantedCatalogueAvailability } from '@/lib/app/judges/availability';

const provider = (slug: string) => ({
  id: `id-${slug}`,
  slug,
  name: slug,
  providerType: 'openai-compatible',
  isLocal: false,
  apiKeyEnvVar: `${slug.toUpperCase()}_KEY`,
});

/** The classifier result shape: only `reachable` is read by the code under test. */
const classified = (reachable: Array<ReturnType<typeof provider>>) =>
  ({ reachable, unavailable: [] }) as unknown as Awaited<
    ReturnType<typeof classifyProvidersByCredential>
  >;

describe('grantedCatalogueAvailability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('feeds only active, eligible and reachable providers into the model query', async () => {
    const [a, b, c] = [provider('a'), provider('b'), provider('c')];
    vi.mocked(prisma.aiProviderConfig.findMany).mockResolvedValue([a, b, c] as never);
    // b is not granted to the workspace.
    vi.mocked(resolveEligibleProviders).mockResolvedValue(['a', 'c'] as never);
    // c has no usable key.
    vi.mocked(classifyProvidersByCredential).mockResolvedValue(classified([a]));
    vi.mocked(prisma.aiProviderModel.findMany).mockResolvedValue([]);

    await grantedCatalogueAvailability();

    expect(prisma.aiProviderConfig.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } })
    );
    // Only the eligible providers are classified for credentials.
    expect(vi.mocked(classifyProvidersByCredential).mock.calls[0][0].map((p) => p.slug)).toEqual([
      'a',
      'c',
    ]);
    expect(prisma.aiProviderModel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true, providerSlug: { in: ['a'] } } })
    );
  });

  it('returns only chat-capable models as { provider, model }', async () => {
    const a = provider('a');
    vi.mocked(prisma.aiProviderConfig.findMany).mockResolvedValue([a] as never);
    vi.mocked(resolveEligibleProviders).mockResolvedValue(['a'] as never);
    vi.mocked(classifyProvidersByCredential).mockResolvedValue(classified([a]));
    vi.mocked(prisma.aiProviderModel.findMany).mockResolvedValue([
      { providerSlug: 'a', modelId: 'chatty', capabilities: ['chat', 'vision'] },
      { providerSlug: 'a', modelId: 'embedder', capabilities: ['embedding'] },
      { providerSlug: 'a', modelId: 'nothing', capabilities: [] },
    ] as never);

    const result = await grantedCatalogueAvailability();

    expect(result).toEqual([{ provider: 'a', model: 'chatty' }]);
    expect(result[0]).not.toHaveProperty('capabilities');
  });

  it('returns [] without asking eligibility or models when there are no active providers', async () => {
    vi.mocked(prisma.aiProviderConfig.findMany).mockResolvedValue([]);

    await expect(grantedCatalogueAvailability()).resolves.toEqual([]);

    expect(resolveEligibleProviders).not.toHaveBeenCalled();
    expect(prisma.aiProviderModel.findMany).not.toHaveBeenCalled();
  });

  it('returns [] without querying models when no provider is reachable', async () => {
    vi.mocked(prisma.aiProviderConfig.findMany).mockResolvedValue([provider('a')] as never);
    vi.mocked(resolveEligibleProviders).mockResolvedValue(['a'] as never);
    vi.mocked(classifyProvidersByCredential).mockResolvedValue(classified([]));

    await expect(grantedCatalogueAvailability()).resolves.toEqual([]);

    expect(prisma.aiProviderModel.findMany).not.toHaveBeenCalled();
  });

  it('asks eligibility for every active slug with onFailure: throw', async () => {
    vi.mocked(prisma.aiProviderConfig.findMany).mockResolvedValue([
      provider('a'),
      provider('b'),
    ] as never);
    vi.mocked(resolveEligibleProviders).mockResolvedValue([] as never);
    vi.mocked(classifyProvidersByCredential).mockResolvedValue(classified([]));

    await grantedCatalogueAvailability();

    expect(resolveEligibleProviders).toHaveBeenCalledWith(
      ['a', 'b'],
      expect.objectContaining({ task: 'chat' }),
      { onFailure: 'throw' }
    );
    // Nothing eligible: nothing is handed to the credential check.
    expect(classifyProvidersByCredential).toHaveBeenCalledWith([]);
  });

  it('propagates an eligibility failure instead of reading it as "nothing available"', async () => {
    vi.mocked(prisma.aiProviderConfig.findMany).mockResolvedValue([provider('a')] as never);
    vi.mocked(resolveEligibleProviders).mockRejectedValue(new Error('policy unreachable'));

    await expect(grantedCatalogueAvailability()).rejects.toThrow('policy unreachable');

    expect(classifyProvidersByCredential).not.toHaveBeenCalled();
    expect(prisma.aiProviderModel.findMany).not.toHaveBeenCalled();
  });

  it('leaves out a provider whose credential resolver failed (in unavailable)', async () => {
    const [a, b] = [provider('a'), provider('b')];
    vi.mocked(prisma.aiProviderConfig.findMany).mockResolvedValue([a, b] as never);
    vi.mocked(resolveEligibleProviders).mockResolvedValue(['a', 'b'] as never);
    vi.mocked(classifyProvidersByCredential).mockResolvedValue({
      reachable: [a],
      unavailable: [b],
    } as unknown as Awaited<ReturnType<typeof classifyProvidersByCredential>>);
    vi.mocked(prisma.aiProviderModel.findMany).mockResolvedValue([
      { providerSlug: 'a', modelId: 'm1', capabilities: ['chat'] },
    ] as never);

    const result = await grantedCatalogueAvailability();

    expect(prisma.aiProviderModel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true, providerSlug: { in: ['a'] } } })
    );
    expect(result).toEqual([{ provider: 'a', model: 'm1' }]);
  });
});
