/**
 * The app's Claude 5.5 model rows (t-39): written with the API's dashed ids
 * the judges' approved list matches on, priced, and never over a row an admin
 * has edited.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import unit from '@/prisma/seeds/app-howdoesthisland/001-claude-models';
import { APPROVED_MODELS } from '@/lib/app/judges/approved-models';

const prisma = {
  user: { findFirst: vi.fn() },
  aiProviderModel: { findUnique: vi.fn(), upsert: vi.fn() },
};
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

async function run(): Promise<void> {
  // The unit reads only these two delegates.
  await unit.run({ prisma, logger } as unknown as Parameters<typeof unit.run>[0]);
}

beforeEach(() => {
  vi.clearAllMocks();
  prisma.user.findFirst.mockResolvedValue({ id: 'system' });
  prisma.aiProviderModel.findUnique.mockResolvedValue(null);
});

describe('app-howdoesthisland/001-claude-models', () => {
  it('writes the three current Claude models with their API ids and prices', async () => {
    await run();
    const rows = prisma.aiProviderModel.upsert.mock.calls.map(([arg]) => arg.create);
    expect(
      rows.map((r) => [r.modelId, r.inputCostPerMillionTokens, r.outputCostPerMillionTokens])
    ).toEqual([
      ['claude-opus-5-5', 4, 20],
      ['claude-sonnet-5-5', 2, 10],
      ['claude-haiku-5-5', 0.1, 0.5],
    ]);
    for (const row of rows) {
      expect(row).toMatchObject({
        providerSlug: 'anthropic',
        capabilities: expect.arrayContaining(['chat']),
        isDefault: true,
        isActive: true,
        createdBy: 'system',
      });
    }
  });

  it('writes a row for every Anthropic model on the judges’ approved lists', async () => {
    await run();
    const seeded = new Set(
      prisma.aiProviderModel.upsert.mock.calls.map(([arg]) => arg.create.modelId)
    );
    const approved = Object.values(APPROVED_MODELS)
      .flat()
      .filter((e) => e.provider === 'anthropic' && e.model.endsWith('-5-5'))
      .map((e) => e.model);
    expect(approved.length).toBeGreaterThan(0);
    for (const model of approved) expect(seeded).toContain(model);
  });

  it('leaves a row an admin has edited alone', async () => {
    prisma.aiProviderModel.findUnique.mockImplementation(
      async ({ where }: { where: { slug: string } }) =>
        where.slug === 'anthropic-claude-opus-5-5' ? { isDefault: false } : null
    );
    await run();
    const slugs = prisma.aiProviderModel.upsert.mock.calls.map(([arg]) => arg.where.slug);
    expect(slugs).not.toContain('anthropic-claude-opus-5-5');
    expect(slugs).toHaveLength(2);
  });

  it('refuses to run before the system owner exists', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(run()).rejects.toThrow('No admin user found');
    expect(prisma.aiProviderModel.upsert).not.toHaveBeenCalled();
  });
});
