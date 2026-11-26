/**
 * The published MCP tool schemas against the Zod schemas the dispatcher
 * validates with (t-92). They are two descriptions of one argument list: a
 * property the JSON Schema advertises and Zod strips is the silent no-op
 * `sunrise.mcp-reseed` warns of, and one Zod takes that the JSON Schema
 * hides is a parameter no client knows to send. t-93 adds the comparison tools.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ASSESS_DRAFT,
  COMPARE_DRAFTS,
  GET_ASSESSMENT,
  GET_COMPARISON,
  MCP_LABEL_MAX,
  MCP_MAX_DRAFTS,
  MCP_MIN_DRAFTS,
  MCP_TEXT_MAX,
  MCP_TOOL_ROWS,
  MCP_URL_MAX,
  QUICK_SCAN,
} from '@/lib/app/mcp/definitions';
import { MAX_CONTENT_CHARS, MAX_URL_CHARS } from '@/lib/app/assessments/limits';
import { DRAFT_LABEL_MAX, MAX_DRAFTS, MIN_DRAFTS } from '@/lib/app/comparisons/limits';
import { quickScanArgsSchema } from '@/lib/app/mcp/quick-scan';
import { assessDraftArgsSchema } from '@/lib/app/mcp/assess-draft';
import { getAssessmentArgsSchema } from '@/lib/app/mcp/get-assessment';
import { compareDraftsArgsSchema } from '@/lib/app/mcp/compare-drafts';
import { getComparisonArgsSchema } from '@/lib/app/mcp/get-comparison';

const parameters = z.object({
  type: z.literal('object'),
  properties: z.record(z.string(), z.object({ type: z.string() }).loose()),
  required: z.array(z.string()).optional(),
  additionalProperties: z.literal(false),
});

/** The JSON Schema Zod itself derives, for its property names and required list. */
function derived(schema: z.ZodType) {
  return parameters
    .omit({ additionalProperties: true })
    .parse(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }));
}

describe.each([
  ['quick_scan', QUICK_SCAN, quickScanArgsSchema],
  ['assess_draft', ASSESS_DRAFT, assessDraftArgsSchema],
  ['get_assessment', GET_ASSESSMENT, getAssessmentArgsSchema],
  ['compare_drafts', COMPARE_DRAFTS, compareDraftsArgsSchema],
  ['get_comparison', GET_COMPARISON, getComparisonArgsSchema],
] as const)('%s', (name, definition, schema) => {
  const published = parameters.parse(definition.parameters);

  it('is named for its slug', () => {
    expect(definition.name).toBe(name);
  });

  it('advertises exactly the arguments its Zod schema takes', () => {
    expect(Object.keys(published.properties).sort()).toEqual(
      Object.keys(derived(schema).properties).sort()
    );
  });

  it('requires exactly what its Zod schema requires', () => {
    expect([...(published.required ?? [])].sort()).toEqual(
      [...(derived(schema).required ?? [])].sort()
    );
  });

  it('gives each argument the type Zod checks', () => {
    const zod = derived(schema).properties;
    for (const [key, property] of Object.entries(published.properties)) {
      expect(property.type, key).toBe(zod[key]?.type);
    }
  });
});

describe('the bounds the definitions restate', () => {
  it('match the API limits they copy', () => {
    expect(MCP_TEXT_MAX).toBe(MAX_CONTENT_CHARS * 2);
    expect(MCP_URL_MAX).toBe(MAX_URL_CHARS);
    expect([MCP_MIN_DRAFTS, MCP_MAX_DRAFTS, MCP_LABEL_MAX]).toEqual([
      MIN_DRAFTS,
      MAX_DRAFTS,
      DRAFT_LABEL_MAX,
    ]);
  });

  it('seed one row per tool, under its own handler class', () => {
    expect(MCP_TOOL_ROWS.map((r) => [r.definition.name, r.handler])).toEqual([
      ['quick_scan', 'QuickScanCapability'],
      ['assess_draft', 'AssessDraftCapability'],
      ['get_assessment', 'GetAssessmentCapability'],
      ['compare_drafts', 'CompareDraftsCapability'],
      ['get_comparison', 'GetComparisonCapability'],
    ]);
  });
});

describe('a draft of compare_drafts', () => {
  const items = z
    .object({
      properties: z.object({
        drafts: z.object({
          minItems: z.number(),
          maxItems: z.number(),
          items: z.object({
            properties: z.record(z.string(), z.unknown()),
            additionalProperties: z.literal(false),
          }),
        }),
      }),
    })
    .parse(COMPARE_DRAFTS.parameters).properties.drafts;
  const args = (drafts: unknown[]) => compareDraftsArgsSchema.safeParse({ drafts });

  it('advertises the fields either kind of draft takes, and the count', () => {
    expect(Object.keys(items.items.properties).sort()).toEqual(['assessmentId', 'label', 'text']);
    expect([items.minItems, items.maxItems]).toEqual([MIN_DRAFTS, MAX_DRAFTS]);
  });

  it('is text or a review, never both, as Zod checks', () => {
    expect(args([{ text: 'A' }, { assessmentId: 'a-1', label: 'Old' }]).success).toBe(true);
    expect(args([{ text: 'A', assessmentId: 'a-1' }, { text: 'B' }]).success).toBe(false);
  });

  it('refuses a set of reviews alone, and a review named twice', () => {
    expect(args([{ assessmentId: 'a-1' }, { assessmentId: 'a-2' }]).success).toBe(false);
    expect(args([{ text: 'A' }, { assessmentId: 'a-1' }, { assessmentId: 'a-1' }]).success).toBe(
      false
    );
  });
});
