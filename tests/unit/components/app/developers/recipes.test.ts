/**
 * Tests: the developer docs' recipes (t-45).
 *
 * A recipe is copied and run by someone deciding whether to build on the API,
 * so each one has to be a request the route accepts. Its body is parsed with
 * the route's own request schema from the registry (the schema the handler
 * parses with), and its `context` with the shipped framework model's own
 * check, which a body schema cannot do: those ids are the version's.
 *
 * @see components/app/developers/recipes.ts
 */
import { describe, expect, it, vi } from 'vitest';
import { APP_ROUTES } from '@/lib/app/api/registry';
import { createHowDoesThisLandEngine } from '@/lib/app/frameworks/howdoesthisland/engine';
import {
  CFO_ALTERNATE_ROLES,
  FIRST_REVIEW,
  RECIPES,
  curlFor,
} from '@/components/app/developers/recipes';
import { loadModel } from '@/tests/unit/lib/app/frameworks/howdoesthisland/engine/baseline-fixtures';

const engine = createHowDoesThisLandEngine(loadModel(), { culture: true });

describe.each([
  ...RECIPES.map((r) => [r.title, r] as const),
  ['Getting started', FIRST_REVIEW] as const,
])('%s', (_title, recipe) => {
  const route = APP_ROUTES.find((r) => r.method === recipe.method && r.path === recipe.path);

  it('calls a route the registry declares, needing the scope the recipe names', () => {
    expect(route).toBeDefined();
    expect(route?.auth).toMatchObject({ apiKeyScope: recipe.scope });
  });

  it("sends a body the route's own request schema accepts", () => {
    const schema = route?.request.body;
    if (!schema) throw new Error(`${recipe.method} ${recipe.path} takes no body`);
    const parsed = schema.safeParse(recipe.body);
    expect(parsed.error?.issues).toBeUndefined();
    expect(parsed.success).toBe(true);
  });

  it('names only ids the shipped framework version has in its context', () => {
    const parsed = engine.parseContext(recipe.body.context ?? {});
    expect(parsed.ok ? [] : parsed.issues).toEqual([]);
  });

  it('prints its body in the curl command as valid JSON, unchanged', () => {
    const curl = curlFor(recipe);
    const json = curl.slice(curl.indexOf("<<'JSON'\n") + 8, curl.lastIndexOf('\nJSON'));
    expect(JSON.parse(json)).toEqual(recipe.body);
  });
});

describe('the other readers the CFO recipe suggests', () => {
  it.each(CFO_ALTERNATE_ROLES)('%s is an exec role in the shipped model', (role) => {
    const parsed = engine.parseContext({ contentType: 'exec_briefing', role });
    expect(parsed.ok ? [] : parsed.issues).toEqual([]);
  });

  it('are the ones the recipe names', () => {
    const cfo = RECIPES.find((r) => r.id === 'recipe-cfo-briefing');
    for (const role of CFO_ALTERNATE_ROLES) expect(cfo?.then.join(' ')).toContain(`\`${role}\``);
  });
});

describe('a body the route refuses', () => {
  it('fails the same check: both a profile and judges', () => {
    const route = APP_ROUTES.find((r) => r.method === 'POST' && r.path === '/api/v1/assessments');
    const parsed = route?.request.body?.safeParse({
      source: { text: 'Copy.' },
      profile: 'quick',
      judges: ['ethos'],
    });
    expect(parsed?.success).toBe(false);
  });
});

describe('the wait bound, in words', () => {
  async function waitSentence(ms: number): Promise<string> {
    vi.resetModules();
    vi.doMock('@/lib/app/assessments/limits', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/lib/app/assessments/limits')>()),
      WAIT_BOUND_MS: ms,
    }));
    const { RECIPES: fresh } = await import('@/components/app/developers/recipes');
    vi.doUnmock('@/lib/app/assessments/limits');
    return fresh.flatMap((r) => r.then ?? []).find((t) => t.includes('take longer than')) ?? '';
  }

  it('says one minute, several minutes, or seconds, by what the bound is', async () => {
    expect(await waitSentence(60_000)).toContain('take longer than 1 minute.');
    expect(await waitSentence(120_000)).toContain('take longer than 2 minutes.');
    expect(await waitSentence(90_000)).toContain('take longer than 90 seconds.');
  });
});
