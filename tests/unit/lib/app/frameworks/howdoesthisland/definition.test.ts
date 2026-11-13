/**
 * The HowDoesThisLand definition's defensive readers (t-13 brought this file
 * into the coverage gate by adding `createEngine`): each tolerates a shape
 * the import's schemas refuse first, rather than throwing on it.
 */
import { describe, expect, it } from 'vitest';
import { howDoesThisLand } from '@/lib/app/frameworks/howdoesthisland/definition';

describe('howDoesThisLand', () => {
  it('reads the version from meta, and stringifies what is missing', () => {
    expect(howDoesThisLand.versionOf({ meta: { version: '1.2.3', schema_version: '4' } })).toEqual({
      version: '1.2.3',
      schemaVersion: '4',
    });
    expect(howDoesThisLand.versionOf({ meta: 'nope' })).toEqual({
      version: 'undefined',
      schemaVersion: 'undefined',
    });
  });

  it('picks integrity caps’ dimensions, passing a non-object cap through and a non-list as nothing', () => {
    const cap = howDoesThisLand.references.find((r) => r.relation === 'integrity_cap');
    expect(cap).toBeDefined();
    expect(cap?.pick({ integrity_caps: [{ dimension: 'eth_integrity' }, 'raw'] })).toEqual([
      'eth_integrity',
      'raw',
    ]);
    expect(cap?.pick({ integrity_caps: 'nope' })).toBeUndefined();
  });
});
