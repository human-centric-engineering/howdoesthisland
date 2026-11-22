/**
 * The projects API's service (t-70, f-projects): the routes parse, this does.
 *
 * A project is the workspace's: one client, product or campaign, with the
 * brief its reviews' AI reviewers read (that arrives with t-75) and the
 * defaults a review in it takes. Everything runs in the caller's tenant
 * context (the route's guard), and every read names that org, so another
 * workspace's id is not found, at `single` as at `multi`.
 *
 * **Defaults are checked when written**, against the latest published
 * version of the project's framework, so a mistyped id is refused when it is
 * saved rather than on the first review. They are stored as given, not as the
 * engine fills them in, so what they leave out still takes the version's own
 * defaults, and checked again, under the request's own fields, against the
 * version each review runs with (`reviewDefaults`).
 *
 * **Archived, not deleted.** `DELETE` sets `archivedAt`; the project's
 * reviews keep their link, and `PATCH { archived: false }` restores it. Rows
 * go only with their workspace (org erasure, cascade).
 */
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { APIError, NotFoundError } from '@/lib/api/errors';
import { prisma } from '@/lib/db/client';
import { requireOrgId } from '@/lib/tenancy/context';
import { JudgeProfileError } from '@/lib/app/frameworks/engine';
import { DEFAULT_FRAMEWORK, versionToScore } from '@/lib/app/assessments/api/version';
import {
  briefSchema,
  projectDefaultsSchema,
  type CreateProjectBody,
  type ProjectDefaults,
  type UpdateProjectBody,
} from '@/lib/app/projects/validations';
import type { ProjectView } from '@/lib/app/projects/wire';

const projectSelect = {
  id: true,
  name: true,
  brief: true,
  defaults: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  framework: { select: { slug: true } },
  _count: { select: { assessments: true } },
} satisfies Prisma.ProjectSelect;

type ProjectRow = Prisma.ProjectGetPayload<{ select: typeof projectSelect }>;

/** The stored JSON as plain JSON for the row, by construction of the schemas above. */
const jsonObject = z.record(z.string(), z.json());
function asJson(value: unknown): z.infer<typeof jsonObject> {
  return jsonObject.parse(JSON.parse(JSON.stringify(value ?? {})));
}

function projectView(row: ProjectRow): ProjectView {
  return {
    id: row.id,
    name: row.name,
    // Only this service writes them, through the same schemas.
    brief: briefSchema.parse(row.brief),
    defaults: projectDefaultsSchema.parse(row.defaults),
    framework: row.framework.slug,
    archived: row.archivedAt !== null,
    archivedAt: row.archivedAt,
    reviewCount: row._count.assessments,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** One problem with a project's defaults, by its path in the request body. */
interface DefaultsIssue {
  path: string;
  message: string;
}

function defaultsInvalid(issues: DefaultsIssue[]): APIError {
  return new APIError(
    "The project's defaults do not fit its framework's latest version.",
    'DEFAULTS_INVALID',
    400,
    { issues }
  );
}

/**
 * Check `defaults` against `framework`'s latest published version: every id
 * in the context, and the profile. Throws 400 `DEFAULTS_INVALID` naming each
 * problem's path, or 404 when the framework has no published version.
 */
async function checkDefaults(framework: string, defaults: ProjectDefaults): Promise<void> {
  const resolved = await versionToScore({ framework });
  const issues: DefaultsIssue[] = [];
  if (defaults.context !== undefined) {
    const parsed = resolved.engine.parseContext(defaults.context);
    if (!parsed.ok) {
      issues.push(
        ...parsed.issues.map((issue) => ({
          path: ['defaults', 'context', issue.path].filter(Boolean).join('.'),
          message: issue.message,
        }))
      );
    }
  }
  if (defaults.profile !== undefined) {
    try {
      resolved.engine.activeJudgeSlots(defaults.profile);
    } catch (err) {
      if (!(err instanceof JudgeProfileError)) throw err;
      issues.push({ path: 'defaults.profile', message: err.message });
    }
  }
  if (issues.length > 0) throw defaultsInvalid(issues);
}

export async function listProjects(query: {
  page: number;
  limit: number;
  archived: boolean;
}): Promise<{ items: ProjectView[]; total: number }> {
  const where: Prisma.ProjectWhereInput = {
    orgId: requireOrgId(),
    ...(query.archived ? {} : { archivedAt: null }),
  };
  const [rows, total] = await Promise.all([
    prisma.project.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: projectSelect,
    }),
    prisma.project.count({ where }),
  ]);
  return { items: rows.map(projectView), total };
}

export async function getProject(id: string): Promise<ProjectView> {
  const row = await prisma.project.findFirst({
    where: { id, orgId: requireOrgId() },
    select: projectSelect,
  });
  if (!row) throw new NotFoundError('Project not found');
  return projectView(row);
}

export async function createProject(body: CreateProjectBody, userId: string): Promise<ProjectView> {
  const framework = body.framework ?? DEFAULT_FRAMEWORK;
  const defaults = body.defaults ?? {};
  // First, so a framework with no published version is refused as such.
  await checkDefaults(framework, defaults);
  const row = await prisma.framework.findUnique({
    where: { slug: framework },
    select: { id: true },
  });
  // versionToScore found it a moment ago; only a delete in between misses.
  if (!row) throw new APIError(`There is no framework '${framework}'.`, 'FRAMEWORK_NOT_FOUND', 404);
  const created = await prisma.project.create({
    data: {
      orgId: requireOrgId(),
      name: body.name,
      brief: asJson(body.brief),
      defaults: asJson(defaults),
      frameworkId: row.id,
      createdByUserId: userId,
    },
    select: projectSelect,
  });
  return projectView(created);
}

export async function updateProject(id: string, body: UpdateProjectBody): Promise<ProjectView> {
  const orgId = requireOrgId();
  const existing = await prisma.project.findFirst({
    where: { id, orgId },
    select: { archivedAt: true, framework: { select: { slug: true } } },
  });
  if (!existing) throw new NotFoundError('Project not found');
  if (body.defaults !== undefined) await checkDefaults(existing.framework.slug, body.defaults);

  const data: Prisma.ProjectUpdateManyMutationInput = {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.brief !== undefined ? { brief: asJson(body.brief) } : {}),
    ...(body.defaults !== undefined ? { defaults: asJson(body.defaults) } : {}),
    // An archived one keeps when it was archived until it is restored.
    ...(body.archived === true && existing.archivedAt === null ? { archivedAt: new Date() } : {}),
    ...(body.archived === false ? { archivedAt: null } : {}),
  };
  // `updateMany` so the org is in the write's own filter, not only the read's.
  const { count } = await prisma.project.updateMany({ where: { id, orgId }, data });
  if (count === 0) throw new NotFoundError('Project not found');
  return getProject(id);
}

/** DELETE: archive it. Archiving an archived project changes nothing. */
export async function archiveProject(id: string): Promise<ProjectView> {
  return updateProject(id, { archived: true });
}

/** What a review in a project takes from it (`reviewDefaults`). */
export interface ReviewProject {
  id: string;
  /** The framework its reviews are scored with. */
  framework: string;
  defaults: ProjectDefaults;
}

/**
 * The project a review names, for `POST /api/v1/assessments`: in this
 * workspace and not archived. Another workspace's id, or none, is 404
 * `PROJECT_NOT_FOUND`; an archived one is 409 `PROJECT_ARCHIVED`, since
 * restoring it is the remedy.
 */
export async function projectForReview(id: string): Promise<ReviewProject> {
  const row = await prisma.project.findFirst({
    where: { id, orgId: requireOrgId() },
    select: { id: true, defaults: true, archivedAt: true, framework: { select: { slug: true } } },
  });
  if (!row)
    throw new APIError('There is no such project in this workspace.', 'PROJECT_NOT_FOUND', 404);
  if (row.archivedAt !== null) {
    throw new APIError(
      'This project is archived. Restore it to review copy in it.',
      'PROJECT_ARCHIVED',
      409
    );
  }
  return {
    id: row.id,
    framework: row.framework.slug,
    defaults: projectDefaultsSchema.parse(row.defaults),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A request's context over a project's: the request wins field by field, and
 * where both give an object (`audience`, `culture`), key by key within it, so
 * a request naming one audience option keeps the project's others. Neither is
 * changed. The result is checked against the version as any context is.
 */
export function mergeContext(
  project: Record<string, unknown> | undefined,
  request: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (project === undefined) return request;
  if (request === undefined) return { ...project };
  const merged: Record<string, unknown> = { ...project };
  for (const [key, value] of Object.entries(request)) {
    const base = merged[key];
    merged[key] = isPlainObject(base) && isPlainObject(value) ? { ...base, ...value } : value;
  }
  return merged;
}
