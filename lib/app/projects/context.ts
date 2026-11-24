/**
 * A project's context for the AI reviewers (t-75, D18, D21, app-plan §8.4).
 *
 * {@link buildProjectContext} gathers it once per review: the project's brief,
 * and at most {@link MAX_CONTEXT_PASSAGES} passages from the project's own
 * background documents, retrieved from the workspace's knowledge base with
 * queries drawn from the copy's sections. What it gathered is a
 * {@link ProjectContextRecord}, which the assessment stores; the block every
 * judge and the editor read is rendered from that record
 * ({@link renderProjectContext}), so a re-driven run gives its later judges
 * the block its first judges read.
 *
 * **Only the project's own documents.** The search is restricted to the
 * knowledge rows the project's links point at (`documentIds`), in this
 * workspace and ready, and every passage returned is checked against that
 * set again before it is used. Core's knowledge base is one corpus per
 * workspace, shared with other projects and core's knowledge page; the
 * document filter is what makes it this project's (D18).
 *
 * **Bounded.** At most {@link MAX_CONTEXT_QUERIES} queries, each a section of
 * the copy cut at {@link MAX_QUERY_CHARS}, deduplicated. Passages are
 * deduplicated across queries and taken best match first while they fit:
 * the brief and the passages together stay under {@link CONTEXT_TOKEN_BUDGET}.
 *
 * **Background, not instructions** (D21). The brief sits under a heading that
 * says it is the author's own description; the engine's `projectBlock` fences
 * the whole and frames it as background.
 *
 * **Its spend.** Each query is one embedding call, logged by core with the
 * caller's attribution, so a stored review's charge (`assessmentId`) and a
 * `store: false` run's (`ephemeralRun`) include it. The cost is returned for
 * the caller to add to the review's own total.
 *
 * **Its logs.** The searches log each query's length, not its text: the
 * queries are the copy, which a `store: false` review keeps nowhere.
 *
 * A search that throws throws here, as a {@link ProjectContextError}: the
 * copy is not reviewed as if the project had no documents. The error carries
 * what the searches that did run cost, and whether asking again can work.
 */
import { prisma } from '@/lib/db/client';
import { requireOrgId } from '@/lib/tenancy/context';
import { searchKnowledgeWithEmbedding } from '@/lib/orchestration/knowledge/search';
import type { EmbeddingAttribution } from '@/lib/orchestration/knowledge/embedder';
import { NoProviderConfiguredError } from '@/lib/orchestration/llm/agent-resolver';
import { isLocalOnlyEmbeddingRefusal } from '@/lib/orchestration/llm/privacy-stage';
import type { Brief } from '@/lib/app/projects/validations';
import { contextUsedSchema, storedBriefSchema, type ContextUsed } from '@/lib/app/projects/wire';

/** The most passages one review reads. */
export const MAX_CONTEXT_PASSAGES = 6;

/** The most searches one review makes: one per section of the copy. */
export const MAX_CONTEXT_QUERIES = 4;

/** The longest a query may be, in characters. */
export const MAX_QUERY_CHARS = 2000;

/**
 * The most the block may hold, brief and passages together, in estimated
 * tokens ({@link estimateTokens}). A full brief is at most 10,000 characters
 * (about 2,500 tokens), which leaves room for a few passages.
 */
export const CONTEXT_TOKEN_BUDGET = 4000;

/** Rough tokens for `text`: four characters a token, as English prose runs. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** What the reviewers were given, as the assessment records it: the API's `contextUsed`. */
export type ProjectContextRecord = ContextUsed;

/** A stored record, or `null` for none or one that does not parse. */
export function parseProjectContext(value: unknown): ProjectContextRecord | null {
  if (value === null || value === undefined) return null;
  const parsed = contextUsedSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** The brief's parts, in the order the reviewers read them, each with its question. */
const BRIEF_PARTS: ReadonlyArray<readonly [keyof Brief, string]> = [
  ['offer', 'What they offer'],
  ['audience', 'Who it is for'],
  ['voice', 'Tone of voice'],
  ['markets', 'Where it runs'],
  ['goals', 'What the copy must achieve'],
];

/**
 * The brief's parts that say something, or `null` when none does. Read with
 * the stored schema, which holds no limits, so a record kept from before a
 * limit changed still reads as it was given.
 */
function givenBrief(brief: unknown): Brief | null {
  const parsed = storedBriefSchema.safeParse(brief);
  if (!parsed.success) return null;
  const given: Brief = {};
  for (const [key] of BRIEF_PARTS) {
    const value = parsed.data[key]?.trim();
    if (value) given[key] = value;
  }
  return Object.keys(given).length > 0 ? given : null;
}

function briefSection(brief: Brief): string {
  const lines = BRIEF_PARTS.flatMap(([key, label]) =>
    brief[key] ? [`${label}: ${brief[key]}`] : []
  );
  return `## The author's description of the project, in their own words\n${lines.join('\n')}`;
}

const PASSAGES_HEADING = "## Passages from the project's background documents";

function passageSection(title: string, text: string): string {
  return `[From "${title}"]\n${text}`;
}

/**
 * The block the reviewers read, from a record: the brief under its heading,
 * then each passage with the title of its document. `null` when the record
 * holds nothing to read.
 */
export function renderProjectContext(record: ProjectContextRecord | null): string | null {
  if (!record) return null;
  const titles = new Map(record.documents.map((d) => [d.id, d.title]));
  const parts: string[] = [];
  if (record.brief && givenBrief(record.brief)) parts.push(briefSection(record.brief));
  if (record.passages.length > 0) {
    parts.push(
      [
        PASSAGES_HEADING,
        ...record.passages.map((p) => passageSection(titles.get(p.documentId) ?? '', p.text)),
      ].join('\n\n')
    );
  }
  return parts.length > 0 ? parts.join('\n\n') : null;
}

/**
 * The copy's pieces, as {@link contextQueries} gathers them: its paragraphs;
 * when there are fewer than {@link MAX_CONTEXT_QUERIES}, its lines; then its
 * sentences; then, for text with none of these, runs of equal length. So
 * the queries of copy with no blank lines (text from a PDF or a page) are
 * drawn from across its length, not from its opening alone.
 */
function copyPieces(content: string): string[] {
  const pieces = (separator: RegExp) =>
    content
      .split(separator)
      .map((p) => p.replace(/\s+/g, ' ').trim())
      .filter((p) => p !== '');
  // The split with the most pieces, stopping at the first that gives enough.
  let found: string[] = [];
  for (const separator of [/\n\s*\n/, /\n/, /(?<=[.!?])\s+/]) {
    const split = pieces(separator);
    if (split.length > found.length) found = split;
    if (found.length >= MAX_CONTEXT_QUERIES) break;
  }
  if (found.length < MAX_CONTEXT_QUERIES) {
    const whole = found.join(' ');
    if (whole.length <= MAX_QUERY_CHARS) return found;
    found = [whole];
  }
  // A piece longer than a query is cut into query-long runs, so its tail is
  // searched too, not only its opening.
  const size = Math.min(
    MAX_QUERY_CHARS,
    Math.ceil(found.reduce((sum, p) => sum + p.length, 0) / MAX_CONTEXT_QUERIES)
  );
  return found.flatMap((piece) => {
    if (piece.length <= MAX_QUERY_CHARS) return [piece];
    const runs: string[] = [];
    for (let at = 0; at < piece.length; at += size) runs.push(piece.slice(at, at + size));
    return runs;
  });
}

/**
 * The copy's sections, as search queries: its pieces ({@link copyPieces})
 * gathered in order into at most {@link MAX_CONTEXT_QUERIES} runs of about
 * equal length, each cut at {@link MAX_QUERY_CHARS}, with repeats dropped.
 * So the queries sample the copy, the opening of each quarter: copy longer
 * than four queries is not searched in full, which bounds a review's
 * searches whatever its length.
 */
export function contextQueries(content: string): string[] {
  const paragraphs = copyPieces(content);
  if (paragraphs.length === 0) return [];
  const total = paragraphs.reduce((sum, p) => sum + p.length, 0);
  const target = total / MAX_CONTEXT_QUERIES;
  const sections: string[] = [];
  let current: string[] = [];
  let length = 0;
  for (const paragraph of paragraphs) {
    current.push(paragraph);
    length += paragraph.length;
    if (length >= target && sections.length < MAX_CONTEXT_QUERIES - 1) {
      sections.push(current.join(' '));
      current = [];
      length = 0;
    }
  }
  if (current.length > 0) sections.push(current.join(' '));

  const seen = new Set<string>();
  const queries: string[] = [];
  for (const section of sections) {
    const query = section.slice(0, MAX_QUERY_CHARS).trim();
    const key = query.toLowerCase();
    if (query === '' || seen.has(key)) continue;
    seen.add(key);
    queries.push(query);
  }
  return queries;
}

/** The project, as {@link buildProjectContext} reads it. */
export interface ContextProject {
  id: string;
  brief: unknown;
}

export interface BuiltProjectContext {
  /** What the reviewers are given, or `null` when the project gives them nothing. */
  record: ProjectContextRecord | null;
  /** What the searches' embeddings cost. */
  costUsd: number;
}

/**
 * Gather the project's context for a review of `content` (see the module
 * header). `attribution` tags the searches' embedding cost rows: the review's
 * `assessmentId`, or a `store: false` run's `ephemeralRun`, and who asked.
 * Runs in the caller's tenant context.
 */
export async function buildProjectContext(
  project: ContextProject,
  content: string,
  attribution: EmbeddingAttribution = {}
): Promise<BuiltProjectContext> {
  const orgId = requireOrgId();
  const brief = givenBrief(project.brief);
  let budget = CONTEXT_TOKEN_BUDGET - (brief ? estimateTokens(briefSection(brief)) : 0);

  const links = await prisma.projectDocument.findMany({
    where: { projectId: project.id, orgId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, knowledgeDocumentId: true, title: true },
  });
  // Only rows in this workspace that are ready: one still embedding, or
  // waiting on an admin, is not the author's to cite yet.
  const ready =
    links.length === 0
      ? []
      : await prisma.aiKnowledgeDocument.findMany({
          where: { id: { in: links.map((l) => l.knowledgeDocumentId) }, orgId, status: 'ready' },
          select: { id: true },
        });
  const readyIds = new Set(ready.map((row) => row.id));
  // One link per knowledge row: `ProjectDocument` is unique on
  // `(projectId, knowledgeDocumentId)`.
  const linkOf = new Map(
    links.filter((l) => readyIds.has(l.knowledgeDocumentId)).map((l) => [l.knowledgeDocumentId, l])
  );

  const queries = linkOf.size > 0 ? contextQueries(content) : [];
  const documentIds = [...linkOf.keys()];
  // Settled, not raced: when one fails, the others are already billed, and
  // the caller is told what they cost.
  const settled = await Promise.allSettled(
    queries.map((query) =>
      searchKnowledgeWithEmbedding(
        query,
        { documentIds },
        MAX_CONTEXT_PASSAGES,
        undefined,
        withKind(attribution),
        { logQuery: false }
      )
    )
  );
  const answers = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
  const costUsd = answers.reduce((sum, a) => sum + a.embedding.costUsd, 0);
  const failed = settled.find((s) => s.status === 'rejected');
  if (failed) throw new ProjectContextError(failed.reason, costUsd);

  // Each chunk once, at its best match across the queries.
  const best = new Map<string, { similarity: number; documentId: string; text: string }>();
  for (const { results } of answers) {
    for (const hit of results) {
      // The filter is the search's; this is the check that nothing outside it is used.
      if (!linkOf.has(hit.chunk.documentId)) continue;
      const text = hit.chunk.content.trim();
      if (text === '') continue;
      const seen = best.get(hit.chunk.id);
      if (!seen || hit.similarity > seen.similarity) {
        best.set(hit.chunk.id, {
          similarity: hit.similarity,
          documentId: hit.chunk.documentId,
          text,
        });
      }
    }
  }

  const passages: ProjectContextRecord['passages'] = [];
  const used = new Map<string, { id: string; title: string }>();
  const ranked = [...best.entries()].sort((a, b) => b[1].similarity - a[1].similarity);
  for (const [chunkId, hit] of ranked) {
    if (passages.length >= MAX_CONTEXT_PASSAGES) break;
    const link = linkOf.get(hit.documentId);
    if (!link) continue;
    // The heading is counted once, with the first passage.
    const cost =
      estimateTokens(passageSection(link.title, hit.text)) +
      (passages.length === 0 ? estimateTokens(PASSAGES_HEADING) : 0);
    // One that does not fit is passed over for a shorter one further down.
    if (cost > budget) continue;
    budget -= cost;
    passages.push({ documentId: link.id, chunkId, text: hit.text });
    used.set(link.id, { id: link.id, title: link.title });
  }

  if (!brief && passages.length === 0) return { record: null, costUsd };
  return { record: { brief, documents: [...used.values()], passages }, costUsd };
}

/** What a review is told when the workspace's setup stops the search (see {@link ProjectContextError}). */
export const PROJECT_CONTEXT_NOT_SET_UP =
  "The project's background documents cannot be searched until an admin fixes the knowledge base's embedding setup.";

/**
 * The project's documents could not be searched. `permanent` when asking
 * again cannot work until the workspace's setup changes: no embedding model,
 * an embeddings policy of `local_only` with none local, or an active model
 * that no longer matches the stored vectors. Otherwise (the provider down)
 * it may. `costUsd` is what the searches that did run cost, already billed.
 */
export class ProjectContextError extends Error {
  readonly permanent: boolean;
  readonly costUsd: number;
  constructor(cause: unknown, costUsd: number) {
    const permanent = isSetupFailure(cause);
    super(
      permanent
        ? PROJECT_CONTEXT_NOT_SET_UP
        : "The project's background documents could not be searched.",
      { cause }
    );
    this.name = 'ProjectContextError';
    this.permanent = permanent;
    this.costUsd = costUsd;
  }
}

function isSetupFailure(err: unknown): boolean {
  return (
    isLocalOnlyEmbeddingRefusal(err) ||
    // `EmbeddingSetupError` is one of these.
    err instanceof NoProviderConfiguredError ||
    // Core's vector check (`embedding-dimensions.ts`) throws a plain Error
    // with this opening.
    (err instanceof Error && err.message.startsWith('Embedding model mismatch:'))
  );
}

/** The caller's attribution, with the cost rows marked as this search's. */
function withKind(attribution: EmbeddingAttribution): EmbeddingAttribution {
  return { ...attribution, metadata: { ...attribution.metadata, kind: 'project_context' } };
}

/**
 * A stored record as the API answers it: `null` outside a project, and when
 * the project gave the reviewers nothing (stored as an empty record, so a
 * re-drive does not search again).
 */
export function contextUsedView(value: unknown): ContextUsed | null {
  const record = parseProjectContext(value);
  return record && renderProjectContext(record) !== null ? record : null;
}
