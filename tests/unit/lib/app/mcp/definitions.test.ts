/**
 * The published MCP tool schemas against the Zod schemas the dispatcher
 * validates with (t-92). They are two descriptions of one argument list: a
 * property the JSON Schema advertises and Zod strips is the silent no-op
 * `sunrise.mcp-reseed` warns of, and one Zod takes that the JSON Schema
 * hides is a parameter no client knows to send.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ASSESS_DRAFT,
  GET_ASSESSMENT,
  MCP_TEXT_MAX,
  MCP_TOOL_ROWS,
  MCP_URL_MAX,
  QUICK_SCAN,
} from '@/lib/app/mcp/definitions';
import { MAX_CONTENT_CHARS, MAX_URL_CHARS } from '@/lib/app/assessments/limits';
import { quickScanArgsSchema } from '@/lib/app/mcp/quick-scan';
import { assessDraftArgsSchema } from '@/lib/app/mcp/assess-draft';
import { getAssessmentArgsSchema } from '@/lib/app/mcp/get-assessment';

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
  });

  it('seed one row per tool, under its own handler class', () => {
    expect(MCP_TOOL_ROWS.map((r) => [r.definition.name, r.handler])).toEqual([
      ['quick_scan', 'QuickScanCapability'],
      ['assess_draft', 'AssessDraftCapability'],
      ['get_assessment', 'GetAssessmentCapability'],
    ]);
  });
});
