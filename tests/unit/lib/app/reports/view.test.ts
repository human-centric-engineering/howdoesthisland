/**
 * Tests: the report's input schemas and view builder (t-29), on results the
 * real 0.5.1 engine assembled from a recorded baseline case.
 *
 * @see lib/app/reports/input.ts
 * @see lib/app/reports/view.ts
 */
import { describe, expect, it } from 'vitest';
import {
  reportModelSchema,
  reportResultSchema,
  type ReportAssessment,
} from '@/lib/app/reports/input';
import {
  buildReportView,
  recommendationNumber,
  segmentCopy,
  type ReportView,
} from '@/lib/app/reports/view';
import {
  apiAssessment,
  engineResult,
  modelDocument,
  TEXT,
  WRITTEN_EDITOR,
} from '@/tests/unit/lib/app/reports/fixtures';

function view(assessment: ReportAssessment = apiAssessment(), culture = true): ReportView {
  return buildReportView({
    assessment,
    result: reportResultSchema.parse(assessment.result),
    model: reportModelSchema.parse(modelDocument(culture)),
  });
}

describe('reportResultSchema', () => {
  it('reads what the engine assembles, full and quick', () => {
    expect(reportResultSchema.safeParse(engineResult({})).success).toBe(true);
    expect(reportResultSchema.safeParse(engineResult({ judges: [] })).success).toBe(true);
    expect(reportResultSchema.safeParse(engineResult({ culture: false })).success).toBe(true);
  });

  it('rejects a result without scores', () => {
    const { scores: _gone, ...broken } = engineResult({});
    expect(reportResultSchema.safeParse(broken).success).toBe(false);
  });

  it('rejects an editor record of an unknown status', () => {
    const broken = engineResult({ editor: { status: 'pending' } });
    expect(reportResultSchema.safeParse(broken).success).toBe(false);
  });
});

describe('reportModelSchema', () => {
  it('reads the 0.5.1 model document, with and without culture', () => {
    expect(reportModelSchema.parse(modelDocument(true)).culture?.scales.length).toBeGreaterThan(0);
    expect(reportModelSchema.parse(modelDocument(false)).culture).toBeUndefined();
  });
});

describe('buildReportView — a full review', () => {
  const v = view();

  it('names the cover from the model, not by id', () => {
    expect(v.cover.typeOfCopy).toBe('Cover letter');
    expect(v.cover.audience.length).toBeGreaterThan(0);
    expect(v.cover.audience.every((a) => !/^[a-z_]+$/.test(a))).toBe(true);
    expect(v.cover.framework).toBe('HowDoesThisLand persuasion model 0.5.1');
    expect(v.cover.date).toBe('2026-11-15T09:01:00.000Z');
  });

  it("carries the editor's verdict and links each change to its recommendation", () => {
    expect(v.verdict.editor?.verdict).toBe(WRITTEN_EDITOR.summary.verdict);
    expect(v.verdict.editor?.changes.map((c) => c.recommendation)).toEqual([2, null]);
    expect(v.verdict.editor?.works).toEqual(['The numbers are specific.']);
  });

  it('marks every note in the copy without losing or changing a character', () => {
    const { highlights } = reportResultSchema.parse(apiAssessment().result);
    const placed = v.copy.notes.filter((n) => n.placed);
    expect(placed.length).toBeGreaterThan(0);
    expect(v.copy.segments.map((s) => s.text).join('')).toBe(TEXT);
    for (const note of placed) {
      const covered = v.copy.segments
        .filter((s) => s.notes.includes(note.number))
        .map((s) => s.text)
        .join('');
      // The engine's offsets are the truth: it marks the words it found,
      // which can be less than a judge's quote when the quote runs on.
      const h = highlights[note.number - 1];
      expect(covered).toBe(TEXT.slice(h.start, h.end));
    }
  });

  it('links a note to the recommendation on its dimension', () => {
    const linked = v.copy.notes.filter((n) => n.recommendation !== null);
    expect(linked.length).toBeGreaterThan(0);
    for (const n of linked) {
      const rec = v.recommendations.find((r) => r.number === n.recommendation);
      expect(rec?.dimensionId).toBe(n.dimensionId);
    }
  });

  it('orders recommendations high impact first, keeping their result numbers', () => {
    const ranks = v.recommendations.map((r) => ({ high: 0, medium: 1, low: 2 })[r.impact] ?? 3);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(v.recommendations.map((r) => r.number)).size).toBe(v.recommendations.length);
  });

  it('groups dimensions by appeal, then by group, each with its judge summary', () => {
    const ids = v.dimensions.map((g) => g.id);
    expect(ids.slice(0, 4)).toEqual(['ethos', 'pathos', 'logos', 'kairos']);
    expect(ids).toEqual(expect.arrayContaining(['craft', 'audience', 'culture']));
    expect(v.dimensions[0].name).toBe('Ethos');
    expect(v.dimensions[0].summary).toEqual(expect.any(String));
  });

  it('has culture, perspectives, duties and lenses', () => {
    expect(v.culture?.reader).toBeTruthy();
    expect(v.culture?.scales.length).toBeGreaterThan(0);
    expect(v.perspectives.length).toBeGreaterThan(0);
    expect(v.duties.rows.length).toBe(5);
    expect(v.lenses.length).toBe(4);
  });

  it('lists every AI reviewer that ran, and none as fallen back', () => {
    expect(v.method.reviewers.map((r) => r.name)).toContain('Ethos');
    expect(v.method.reviewers.find((r) => r.slot === 'influence')?.name).toBe('Influence panel');
    expect(v.method.fellBack).toEqual([]);
    expect(v.method.editor).toEqual({ status: 'written', model: 'gpt-editor' });
    expect(v.method.limitations.length).toBeGreaterThan(0);
  });
});

describe('buildReportView — what a result does not have is absent', () => {
  it('a quick scan has no editor and no AI reviewers', () => {
    const v = view(
      apiAssessment({
        judges: [],
        judgeRuns: [],
        profile: 'quick',
        result: engineResult({ judges: [] }),
      })
    );
    expect(v.mode).toBe('quick');
    expect(v.verdict.editor).toBeNull();
    expect(v.method.reviewers).toEqual([]);
    expect(v.method.editor).toBeNull();
  });

  it('a single judge has no verdict paragraph when the editor skipped it', () => {
    const v = view(
      apiAssessment({
        judges: ['ethos'],
        result: engineResult({
          judges: ['ethos'],
          editor: { status: 'skipped', reason: 'too_few_judges' },
        }),
      })
    );
    expect(v.verdict.editor).toBeNull();
    expect(v.method.editor).toEqual({ status: 'skipped', model: null });
    expect(v.method.reviewers.map((r) => r.slot)).toEqual(['ethos']);
  });

  it('culture is absent with the switch off', () => {
    const a = apiAssessment({ result: engineResult({ culture: false, editor: WRITTEN_EDITOR }) });
    expect(view(a, false).culture).toBeNull();
  });

  it('a partial review names the reviewers that fell back', () => {
    const base = apiAssessment();
    const v = view({
      ...base,
      status: 'partial',
      judgeRuns: base.judgeRuns.map((r) =>
        r.judge === 'logos' ? { ...r, status: 'failed', model: null, errorCode: 'malformed' } : r
      ),
    });
    expect(v.method.fellBack).toEqual(['Logos']);
    expect(v.method.reviewers.find((r) => r.slot === 'logos')?.status).toBe('failed');
  });
});

describe('buildReportView — notes and caps', () => {
  it('lists a note whose offsets do not fit the copy, but does not mark it', () => {
    const result = engineResult({ editor: WRITTEN_EDITOR });
    const parsed = reportResultSchema.parse(result);
    parsed.highlights = [
      { ...parsed.highlights[0], start: TEXT.length + 10, end: TEXT.length + 20 },
    ];
    const v = buildReportView({
      assessment: apiAssessment(),
      result: parsed,
      model: reportModelSchema.parse(modelDocument(true)),
    });
    expect(v.copy.notes).toHaveLength(1);
    expect(v.copy.notes[0].placed).toBe(false);
    expect(v.copy.segments).toEqual([{ text: TEXT, notes: [] }]);
  });

  it('shows an integrity cap when its dimension is at or below the line', () => {
    const parsed = reportResultSchema.parse(engineResult({ editor: WRITTEN_EDITOR }));
    const model = reportModelSchema.parse(modelDocument(true));
    const capped = {
      ...parsed,
      dimensions: parsed.dimensions.map((d) =>
        d.id === 'kai_integrity' ? { ...d, score: 0 } : { ...d, score: 4 }
      ),
    };
    const uncapped = { ...parsed, dimensions: parsed.dimensions.map((d) => ({ ...d, score: 4 })) };
    const a = apiAssessment();
    expect(buildReportView({ assessment: a, result: capped, model }).lands.caps).toEqual([
      { appealName: 'Kairos', cap: 40, why: expect.any(String) },
    ]);
    expect(buildReportView({ assessment: a, result: uncapped, model }).lands.caps).toEqual([]);
  });
});

describe('segmentCopy', () => {
  it('splits overlapping notes into runs that carry both', () => {
    expect(
      segmentCopy('abcdefgh', [
        { number: 1, start: 1, end: 5 },
        { number: 2, start: 3, end: 7 },
      ])
    ).toEqual([
      { text: 'a', notes: [] },
      { text: 'bc', notes: [1] },
      { text: 'de', notes: [1, 2] },
      { text: 'fg', notes: [2] },
      { text: 'h', notes: [] },
    ]);
  });

  it('returns the whole copy as one run with no notes', () => {
    expect(segmentCopy('abc', [])).toEqual([{ text: 'abc', notes: [] }]);
  });
});

describe('recommendationNumber', () => {
  it('reads rec_N within the count, and nothing else', () => {
    expect(recommendationNumber('rec_1', 3)).toBe(1);
    expect(recommendationNumber('rec_3', 3)).toBe(3);
    expect(recommendationNumber('rec_4', 3)).toBeNull();
    expect(recommendationNumber('rec_0', 3)).toBeNull();
    expect(recommendationNumber('dimension', 3)).toBeNull();
  });
});
