/**
 * Tests: engineForVersion (t-22) — a stored version's engine, by id.
 *
 * @see lib/app/assessments/engine.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findVersionById: vi.fn(),
  materialise: vi.fn(),
  getFrameworkDefinition: vi.fn(),
}));

vi.mock('@/lib/app/frameworks/repo', () => ({
  prismaFrameworkRepo: { findVersionById: mocks.findVersionById },
}));
vi.mock('@/lib/app/frameworks/store', () => ({ materialise: mocks.materialise }));
vi.mock('@/lib/app/frameworks/registry', () => ({
  getFrameworkDefinition: mocks.getFrameworkDefinition,
}));

import { engineForVersion } from '@/lib/app/assessments/engine';

const version = {
  id: 'version-1',
  frameworkSlug: 'howdoesthisland',
  version: '0.5.1',
  schemaVersion: '1',
  status: 'PUBLISHED',
  sourceSha256: 'abc',
  publishedAt: null,
};
const engine = { quickScan: vi.fn() };
const def = { slug: 'howdoesthisland', createEngine: vi.fn(() => engine) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findVersionById.mockResolvedValue(version);
  mocks.getFrameworkDefinition.mockReturnValue(def);
  mocks.materialise.mockResolvedValue({ meta: {} });
});

describe('engineForVersion', () => {
  it('builds the engine from the version’s materialised model, and labels it for the cost rows', async () => {
    expect(await engineForVersion('version-1')).toEqual({
      version,
      engine,
      label: 'howdoesthisland@0.5.1',
    });
    expect(mocks.getFrameworkDefinition).toHaveBeenCalledWith('howdoesthisland');
    expect(mocks.materialise).toHaveBeenCalledWith(expect.anything(), def, 'version-1');
    expect(def.createEngine).toHaveBeenCalledWith({ meta: {} });
  });

  it('answers null for an unknown version, reading no records', async () => {
    mocks.findVersionById.mockResolvedValue(null);
    expect(await engineForVersion('nope')).toBeNull();
    expect(mocks.materialise).not.toHaveBeenCalled();
  });

  it('answers null when no code runs the version’s framework', async () => {
    mocks.getFrameworkDefinition.mockReturnValue(null);
    expect(await engineForVersion('version-1')).toBeNull();
    expect(mocks.materialise).not.toHaveBeenCalled();
  });
});
