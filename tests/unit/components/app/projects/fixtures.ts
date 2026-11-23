/**
 * A project and a catalogue as the API answers them, for the projects pages'
 * tests (t-71). The catalogue's ids are a few of HowDoesThisLand 0.5.1's,
 * including the `archetype` audience setting the engine leaves out.
 */
import type { DefaultsCatalogue, ProjectWire } from '@/components/app/projects/schemas';

export function aProject(overrides: Partial<ProjectWire> = {}): ProjectWire {
  return {
    id: 'proj-1',
    name: 'Spring launch',
    brief: { offer: 'Bookkeeping for sole traders', voice: 'Plain and warm' },
    defaults: {},
    framework: 'howdoesthisland',
    overlay: null,
    archived: false,
    archivedAt: null,
    reviewCount: 3,
    createdAt: '2026-11-20T10:00:00.000Z',
    updatedAt: '2026-11-21T10:00:00.000Z',
    ...overrides,
  };
}

/** Bounds like the next version's (t-72): ethos and pathos may move, one priority each way. */
export const BOUNDS: NonNullable<DefaultsCatalogue['request']['adjustment']> = {
  weights: { ethos: 0.1, pathos: 0.05, logos: 0, kairos: 0 },
  priorityDimensions: { add: 1, remove: 1 },
};

export function aCatalogue({
  culture = false,
  adjustment = null,
}: {
  culture?: boolean;
  adjustment?: DefaultsCatalogue['request']['adjustment'];
} = {}): DefaultsCatalogue {
  return {
    request: {
      contentTypes: [
        { id: 'general', name: 'General content' },
        { id: 'landing_page', name: 'Landing page / website' },
      ],
      archetypes: [
        { id: 'general', name: 'General audience' },
        { id: 'sceptic', name: 'The Sceptic' },
      ],
      roles: [{ id: 'cfo', name: 'Finance Director / CFO' }],
      audience: [
        {
          id: 'relationship',
          name: 'Relationship with the reader',
          options: [
            { id: 'cold', label: 'Cold' },
            { id: 'warm', label: 'Warm' },
          ],
        },
        {
          id: 'archetype',
          name: 'Audience archetype',
          options: [{ id: 'general', label: 'General' }],
        },
      ],
      ...(culture
        ? {
            countries: [
              { id: 'gb', name: 'United Kingdom', region: 'Europe' },
              { id: 'fr', name: 'France', region: 'Europe' },
            ],
          }
        : {}),
      adjustment,
    },
    result: {
      appeals: [
        { id: 'ethos', name: 'Ethos' },
        { id: 'pathos', name: 'Pathos' },
        { id: 'logos', name: 'Logos' },
        { id: 'kairos', name: 'Kairos' },
      ],
      dimensions: [
        { id: 'eth_integrity', name: 'Integrity', appeal: 'ethos', group: null },
        { id: 'eth_goodwill', name: 'Goodwill', appeal: 'ethos', group: null },
        { id: 'kai_call', name: 'Call to action', appeal: 'kairos', group: null },
        { id: 'craft_rhythm', name: 'Rhythm', appeal: 'craft', group: 'craft' },
      ],
      profiles: [
        { id: 'core', name: 'The four appeals' },
        { id: 'craft', name: 'Craft editor' },
        { id: 'culture', name: 'Culture' },
      ],
    },
  };
}
