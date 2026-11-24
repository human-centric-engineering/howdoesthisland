/**
 * Tests: core's knowledge search leaves a query's text out of its logs when
 * asked (`logQuery: false`, divergence row 28), as a project's context asks
 * for every search of the copy (t-75).
 *
 * Mocked: Prisma (no rows), the embedder, the settings and the logger.
 * Real: `searchKnowledgeWithEmbedding` and both its result paths.
 *
 * @see lib/orchestration/knowledge/search.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  prisma: {
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    aiKnowledgeChunk: { groupBy: vi.fn(), findFirst: vi.fn() },
  },
}));
vi.mock('@/lib/orchestration/knowledge/embedder', () => ({
  embedText: vi.fn().mockResolvedValue({
    embedding: [0, 0, 0],
    model: 'embed',
    provider: 'p',
    dimensions: 3,
    inputTokens: 1,
    costUsd: 0,
  }),
  getActiveEmbeddingModelSummary: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/orchestration/settings', () => ({ getOrchestrationSettings: vi.fn() }));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { searchKnowledgeWithEmbedding } from '@/lib/orchestration/knowledge/search';
import { getOrchestrationSettings } from '@/lib/orchestration/settings';
import { logger } from '@/lib/logging';

const COPY = 'The copy a store: false review keeps nowhere.';

/** Every value the logger was given, as one string. */
const logged = () => JSON.stringify(vi.mocked(logger.info).mock.calls);

beforeEach(() => {
  vi.mocked(logger.info).mockClear();
});

describe('searchKnowledgeWithEmbedding logQuery', () => {
  it.each([
    ['vector-only', false],
    ['hybrid', true],
  ])('logs the query’s length, not its text, on the %s path', async (_label, hybridEnabled) => {
    vi.mocked(getOrchestrationSettings).mockResolvedValue({
      searchConfig: { keywordBoostWeight: -0.02, vectorWeight: 1, hybridEnabled, bm25Weight: 1 },
    } as never);

    await searchKnowledgeWithEmbedding(COPY, undefined, 5, undefined, undefined, {
      logQuery: false,
    });

    expect(logger.info).toHaveBeenCalledWith(
      'Knowledge search results',
      expect.objectContaining({ queryLength: COPY.length })
    );
    expect(logged()).not.toContain(COPY);
  });

  it('logs the query as before by default', async () => {
    vi.mocked(getOrchestrationSettings).mockResolvedValue({ searchConfig: null } as never);

    await searchKnowledgeWithEmbedding(COPY);

    expect(logger.info).toHaveBeenCalledWith(
      'Knowledge search',
      expect.objectContaining({ query: COPY })
    );
  });
});
