/**
 * Tests: the documented `context` and `result` (t-44) match the engine.
 *
 * Two holds. The type test fails when the engine's `Assessment`,
 * `EngineContext` or the editor's `EditorRecord` gains, loses or changes a
 * field the schema does not. The run test feeds every baseline case through
 * the real engine, quick and judged, and checks each serialised result
 * parses to itself: Zod drops a key its schema lacks, so a field the engine
 * emits but the document omits comes back missing and fails it.
 *
 * @see lib/app/frameworks/howdoesthisland/engine/wire.ts
 */
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@/lib/env', () => ({ env: { NODE_ENV: 'test' } }));

import {
  createHowDoesThisLandEngine,
  type Assessment,
  type EngineContext,
} from '@/lib/app/frameworks/howdoesthisland/engine';
import {
  editorRecordSchema,
  engineAssessmentSchema,
  engineContextSchema,
  engineResultSchema,
} from '@/lib/app/frameworks/howdoesthisland/engine/wire';
import { withEditor, type EditorOutcome, type EditorRecord } from '@/lib/app/assessments/editor';
import {
  loadCases,
  loadModel,
} from '@/tests/unit/lib/app/frameworks/howdoesthisland/engine/baseline-fixtures';

/**
 * What a value becomes as JSON: a key whose value may be `undefined` may be
 * missing, since `JSON.stringify` drops it.
 */
type JsonWire<T> = T extends readonly (infer U)[]
  ? JsonWire<U>[]
  : T extends object
    ? {
        [K in keyof T as undefined extends T[K] ? never : K]: JsonWire<T[K]>;
      } & {
        [K in keyof T as undefined extends T[K] ? K : never]?: JsonWire<Exclude<T[K], undefined>>;
      }
    : T;

/** Flattens an intersection so two object types compare by their keys. */
type Flat<T> = T extends readonly (infer U)[]
  ? Flat<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: Flat<T[K]> }
    : T;

describe('the documented shapes hold the engine types', () => {
  it('matches Assessment, EngineContext and EditorRecord', () => {
    expectTypeOf<Flat<z.infer<typeof engineAssessmentSchema>>>().toEqualTypeOf<
      Flat<JsonWire<Assessment>>
    >();
    expectTypeOf<Flat<z.infer<typeof engineContextSchema>>>().toEqualTypeOf<
      Flat<JsonWire<EngineContext>>
    >();
    expectTypeOf<Flat<z.infer<typeof editorRecordSchema>>>().toEqualTypeOf<
      Flat<JsonWire<EditorRecord>>
    >();
  });
});

describe('the documented result, against what the engine returns', () => {
  const model = loadModel();
  const cases = loadCases();
  const engine = createHowDoesThisLandEngine(model, { culture: true });

  /** The value as it reaches a caller: JSON, parsed back. */
  const wire = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

  it('has baseline cases to run', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases.map((c) => [c.file, c] as const))(
    '%s: quick and judged results parse to themselves',
    (_file, c) => {
      const { text, ctx } = c.input;
      const quick = engine.quickScan(text, ctx);
      const results = [
        engine.assemble(text, ctx, quick),
        engine.assemble(text, ctx, quick, c.judgeOutputs, 'https://example.test/page'),
      ];
      for (const result of results) {
        const sent = wire(result);
        expect(engineResultSchema.parse(sent)).toEqual(sent);
      }
      expect(engineContextSchema.parse(wire(ctx))).toEqual(wire(ctx));
    }
  );

  it("parses a stored result carrying each kind of editor's record", () => {
    const c = cases[0];
    const quick = engine.quickScan(c.input.text, c.input.ctx);
    const result = engine.assemble(c.input.text, c.input.ctx, quick, c.judgeOutputs);
    const outcomes: EditorOutcome[] = [
      {
        status: 'written',
        summary: { verdict: 'Lands.', changes: [], works: ['The close'] },
        drops: [{ at: 'changes[0]', reason: 'unknown_id' }],
        spend: {
          provider: 'p',
          model: 'm',
          usage: { input: 1, output: 1, attempts: 1 },
          costUsd: 0.01,
        },
        latencyMs: 5,
      },
      { status: 'skipped', reason: 'too_few_judges' },
      { status: 'failed', code: 'over_budget', message: 'Over', latencyMs: 0 },
    ];
    for (const outcome of outcomes) {
      const sent = wire(withEditor(result, outcome));
      expect(engineResultSchema.parse(sent)).toEqual(sent);
    }
  });

  it('fails a result carrying a field it does not document', () => {
    const c = cases[0];
    const quick = engine.quickScan(c.input.text, c.input.ctx);
    const sent = wire({ ...engine.assemble(c.input.text, c.input.ctx, quick), novel: 1 });
    expect(engineResultSchema.parse(sent)).not.toEqual(sent);
  });
});
