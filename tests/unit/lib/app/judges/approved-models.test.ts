/**
 * Tests: the approved judge and editor models (j4, D8).
 *
 * The list's own invariants, which hold whatever k3 later puts on it, and the
 * agents' `bindingRule`, which is how Sunrise's agent routes refuse a model
 * off it.
 *
 * @see lib/app/judges/approved-models.ts
 */
import { describe, expect, it } from 'vitest';

import {
  EDITOR_AGENT_SLUG,
  DEFAULT_EDITOR_MODEL,
  DEFAULT_JUDGE_MODEL,
  JUDGE_PROVIDER_SLUG,
  judgeAgentDefinitions,
  judgeAgentSlug,
} from '@/lib/app/judges/agents';
import {
  APPROVED_MODELS,
  JUDGE_ROLES,
  approvedEntry,
  refuseUnapproved,
  roleOfSlot,
} from '@/lib/app/judges/approved-models';
import { HOWDOESTHISLAND_JUDGE_SLOTS } from '@/lib/app/frameworks/howdoesthisland/judge-slots';

const definition = (slug: string) => {
  const found = judgeAgentDefinitions().find((d) => d.slug === slug);
  if (!found) throw new Error(`no definition for ${slug}`);
  return found;
};

const ceilingOf = (role: (typeof JUDGE_ROLES)[number]) =>
  definition(
    role === 'editor'
      ? EDITOR_AGENT_SLUG
      : judgeAgentSlug(role === 'influence' ? 'judge_influence' : 'judge_ethos')
  ).agent.maxTokens;

describe('every approved entry', () => {
  for (const role of JUDGE_ROLES) {
    it(`on the ${role} list asks no more than its model can produce`, () => {
      for (const entry of APPROVED_MODELS[role]) {
        expect(entry.settings.maxTokens, entry.model).toBeLessThanOrEqual(entry.outputLimit);
      }
    });

    it(`on the ${role} list stays under the agent's code-owned ceiling`, () => {
      for (const entry of APPROVED_MODELS[role]) {
        expect(entry.settings.maxTokens, entry.model).toBeLessThanOrEqual(ceilingOf(role));
      }
    });

    it(`on the ${role} list has a model id of its own, so a workspace can name it`, () => {
      const ids = APPROVED_MODELS[role].map((e) => e.model);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it(`on the ${role} list gives a trade-off of one plain sentence`, () => {
      for (const entry of APPROVED_MODELS[role]) {
        expect(entry.tradeoff, entry.model).toMatch(/^[^.]+\.$/);
        expect(entry.tradeoff, entry.model).not.toMatch(/token|temperature|effort/i);
      }
    });
  }

  it('includes at least one model whose limit is below 32,768, held to it', () => {
    const below = APPROVED_MODELS.influence.find((e) => e.outputLimit < 32_768);
    expect(below).toMatchObject({ model: 'gpt-4o', settings: { maxTokens: 16_384 } });
  });
});

describe('the defaults are approved for their roles', () => {
  it('the judges’ and the editor’s defaults are on their lists', () => {
    const on = (role: (typeof JUDGE_ROLES)[number], model: string) =>
      approvedEntry(role, { provider: JUDGE_PROVIDER_SLUG, model });
    expect(on('judge', DEFAULT_JUDGE_MODEL)).toBeDefined();
    expect(on('influence', DEFAULT_JUDGE_MODEL)).toBeDefined();
    expect(on('editor', DEFAULT_EDITOR_MODEL)).toBeDefined();
  });

  it('lists each role’s default first, so a workspace sees it at the top', () => {
    expect(APPROVED_MODELS.judge[0].model).toBe(DEFAULT_JUDGE_MODEL);
    expect(APPROVED_MODELS.influence[0].model).toBe(DEFAULT_JUDGE_MODEL);
    expect(APPROVED_MODELS.editor[0].model).toBe(DEFAULT_EDITOR_MODEL);
  });
});

describe('the Claude entries (t-39)', () => {
  const claude = JUDGE_ROLES.flatMap((role) =>
    APPROVED_MODELS[role].filter((e) => e.provider === 'anthropic').map((e) => ({ role, e }))
  );

  it('are the current generation only, by the API’s dashed ids', () => {
    expect(new Set(claude.map(({ e }) => e.model))).toEqual(
      new Set(['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5'])
    );
  });

  it('run at medium effort, with a reasoning model’s timeout', () => {
    for (const { role, e } of claude) {
      expect(e.settings.reasoningEffort, `${role} ${e.model}`).toBe('medium');
      expect(e.settings.timeoutMs, `${role} ${e.model}`).toBeGreaterThanOrEqual(180_000);
    }
  });

  it('offer Haiku to the judges and not to the editor', () => {
    const on = (role: (typeof JUDGE_ROLES)[number]) =>
      APPROVED_MODELS[role].some((e) => e.model === 'claude-haiku-5-5');
    expect(on('judge') && on('influence')).toBe(true);
    expect(on('editor')).toBe(false);
  });
});

describe('roleOfSlot', () => {
  it('runs the influence judge in its own role and every other slot as a judge', () => {
    for (const slot of HOWDOESTHISLAND_JUDGE_SLOTS) {
      expect(roleOfSlot(slot)).toBe(slot === 'judge_influence' ? 'influence' : 'judge');
    }
  });
});

describe('refuseUnapproved', () => {
  it('allows a listed pair and names the choices for one that is not', () => {
    expect(refuseUnapproved('judge', { provider: 'openai', model: 'gpt-4.1' })).toBeNull();
    const refused = refuseUnapproved('editor', { provider: 'openai', model: 'gpt-4o' });
    expect(refused).toContain('"gpt-4o" is not approved for the editor');
    expect(refused).toContain('GPT-5');
  });

  it('matches on provider as well as model', () => {
    expect(refuseUnapproved('judge', { provider: 'other', model: 'gpt-4.1' })).not.toBeNull();
  });
});

describe('each agent’s bindingRule', () => {
  it('refuses a model off its role’s list and allows one on it', () => {
    const ethos = definition(judgeAgentSlug('judge_ethos'));
    const influence = definition(judgeAgentSlug('judge_influence'));
    const editor = definition(EDITOR_AGENT_SLUG);
    const haiku = { provider: 'anthropic', model: 'claude-haiku-5-5' };
    const oldHaiku = { provider: 'anthropic', model: 'claude-haiku-4.5' };

    expect(ethos.bindingRule?.(haiku)).toBeNull();
    expect(influence.bindingRule?.(haiku)).toBeNull();
    expect(ethos.bindingRule?.(oldHaiku)).toContain('not approved for this judge');
    expect(editor.bindingRule?.({ provider: 'openai', model: 'gpt-5' })).toBeNull();
    expect(editor.bindingRule?.(haiku)).toContain('not approved for the editor');
  });

  it('is set on every judge and the editor', () => {
    for (const d of judgeAgentDefinitions()) expect(d.bindingRule, d.slug).toBeTypeOf('function');
  });
});
