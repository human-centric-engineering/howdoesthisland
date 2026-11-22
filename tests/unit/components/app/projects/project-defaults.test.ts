/**
 * A project's stored defaults to the form's pickers and back (t-71).
 *
 * @see components/app/projects/project-defaults.ts
 */
import { describe, expect, it } from 'vitest';

import {
  NO_DEFAULT,
  audienceSettings,
  formValuesOf,
  patchBodyOf,
  profileOptions,
  withStored,
} from '@/components/app/projects/project-defaults';
import { aCatalogue, aProject } from '@/tests/unit/components/app/projects/fixtures';

describe('formValuesOf → patchBodyOf', () => {
  it('sends back exactly the defaults it was given', () => {
    const defaults = {
      context: {
        contentType: 'landing_page',
        role: 'cfo',
        audience: { relationship: 'cold' },
        culture: { writer: 'gb' },
      },
      profile: 'core',
    };
    const project = aProject({ defaults });

    const values = formValuesOf(project, aCatalogue({ culture: true }));

    expect(patchBodyOf(values, true).defaults).toEqual(defaults);
  });

  it('starts every picker on No default when the stored context is not one it can read', () => {
    const project = aProject({ defaults: { context: { contentType: 7 } } });

    const values = formValuesOf(project, aCatalogue());

    expect(values.contentType).toBe(NO_DEFAULT);
    expect(values.modifiers).toEqual({ relationship: NO_DEFAULT });
    expect(patchBodyOf(values, false).defaults).toEqual({});
  });

  it('drops culture when the switch is off, whatever the form held', () => {
    const values = {
      ...formValuesOf(aProject(), aCatalogue()),
      cultureReader: 'gb',
      cultureWriter: 'gb',
    };

    expect(patchBodyOf(values, false).defaults).toEqual({});
    expect(patchBodyOf(values, true).defaults).toEqual({
      context: { culture: { reader: 'gb', writer: 'gb' } },
    });
  });

  it('trims the name and the brief, and leaves blank parts out', () => {
    const values = {
      ...formValuesOf(aProject(), aCatalogue()),
      name: '  Spring  ',
      offer: '   ',
      goals: ' Book a call ',
    };

    const body = patchBodyOf(values, false);

    expect(body.name).toBe('Spring');
    expect(body.brief).toEqual({ voice: 'Plain and warm', goals: 'Book a call' });
  });
});

describe('the pickers', () => {
  it('leave out the audience setting the engine refuses', () => {
    expect(audienceSettings(aCatalogue()).map((m) => m.id)).toEqual(['relationship']);
  });

  it('offer the culture reviewers only with countries served', () => {
    expect(profileOptions(aCatalogue()).map((o) => o.value)).toEqual([
      'quick',
      'core',
      'craft',
      'full',
    ]);
    expect(profileOptions(aCatalogue({ culture: true })).map((o) => o.value)).toContain('culture');
  });

  it('keep a stored value the version lacks, and add nothing for No default or a known one', () => {
    const options = [{ value: 'general', label: 'General content' }];

    expect(withStored(options, 'haiku')).toEqual([
      ...options,
      { value: 'haiku', label: 'haiku (not in this version)' },
    ]);
    expect(withStored(options, NO_DEFAULT)).toBe(options);
    expect(withStored(options, 'general')).toBe(options);
  });
});
