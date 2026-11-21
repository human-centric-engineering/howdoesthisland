/**
 * Tests: the app's route registry (t-23) — it declares exactly the methods the
 * app's route files export, and each response schema matches the type the
 * service behind it returns.
 *
 * FORK NOTE: this is HowDoesThisLand's own test of its own module. Every
 * directory under `app/api/v1/` is either the app's (`APP_ROUTE_DIRS`) or
 * core's (`CORE_ROUTE_DIRS`), and one in neither fails, so a directory the app
 * adds cannot go unscanned. Every route in an app directory then needs a
 * registry entry. An upstream sync that adds a core directory fails here
 * until it is added to `CORE_ROUTE_DIRS`.
 *
 * Route files are read as text, not imported: importing a handler pulls in
 * the auth guards and the database client. An export of a method in a form
 * the scan cannot read (`export { GET }`, `export const { GET } = …`) is
 * refused rather than missed.
 *
 * @see lib/app/api/registry.ts
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import {
  APP_ROUTES,
  HTTP_METHODS,
  acceptedInvitationSchema,
  assessmentDeletedSchema,
  assessmentDetailSchema,
  assessmentEventSchema,
  assessmentSummarySchema,
  createdReportShareSchema,
  createdWorkspaceSchema,
  ephemeralAssessmentSchema,
  frameworkDetailSchema,
  frameworkSummarySchema,
  invitationForInviteeSchema,
  judgeModelChoiceSchema,
  judgeRunViewSchema,
  kindMetaSchema,
  paginationMetaSchema,
  quickScanViewSchema,
  reportPdfSchema,
  reportShareSchema,
  sharedAssessmentSchema,
  sharedReportSchema,
  versionMetaSchema,
  versionSummarySchema,
  workspaceSettingsSchema,
} from '@/lib/app/api/registry';
import type {
  FrameworkDetail,
  FrameworkSummary,
  KindMeta,
  VersionMeta,
  VersionSummary,
} from '@/lib/app/frameworks/api/service';
import type { CreatedWorkspace } from '@/lib/app/workspaces/create';
import type { InvitationForInvitee, acceptInvitation } from '@/lib/app/workspaces/invitations';
import type { JudgeModelChoice } from '@/lib/app/judges/model-choice';
import type { WorkspaceSettings } from '@/lib/app/retention/settings';
import type {
  AssessmentDetail,
  AssessmentSummary,
  EphemeralAssessment,
  JudgeRunView,
  QuickScanView,
} from '@/lib/app/assessments/api/views';
import type { AssessmentEvent } from '@/lib/app/assessments/api/events';
import type { remove } from '@/lib/app/assessments/api/service';
import type {
  CreatedReportShare,
  ReportShareView,
  SharedAssessment,
  SharedReport,
} from '@/lib/app/reports/share/service';
import type { PaginationMeta } from '@/types/api';
import type { FrameworkCalibration, StartedRun } from '@/lib/app/calibration/admin';
import { frameworkCalibrationSchema, startedRunSchema } from '@/lib/app/calibration/wire';

/** The route directories this fork added under `app/api/v1/`. */
const APP_ROUTE_DIRS = [
  // The app's own directories inside core's `admin` (t-38, t-57, t-59).
  'admin/codes',
  'admin/credits',
  'admin/frameworks',
  'assessments',
  // Checking and redeeming free review codes (t-60).
  'codes',
  'frameworks',
  'openapi.json',
  'scan',
  'shared-reports',
  'shares',
  'usage',
  'workspaces',
] as const;

/** Sunrise's route directories under `app/api/v1/`, which are not the app's to declare. */
const CORE_ROUTE_DIRS = [
  'admin',
  'chat',
  'contact',
  'embed',
  'inbound',
  'invitations',
  'mcp',
  'orchestration',
  'orgs',
  'storage',
  'user',
  'users',
  'waitlist',
  'webhooks',
] as const;

/** Directories under `app/api/v1/` that are in neither list. */
function unclassifiedDirs(onDisk: readonly string[]): string[] {
  const known = new Set<string>([...APP_ROUTE_DIRS, ...CORE_ROUTE_DIRS]);
  return onDisk.filter((d) => !known.has(d)).sort();
}

const ROOT = process.cwd();
const API_ROOT = join(ROOT, 'app', 'api', 'v1');

/** `GET /api/v1/frameworks/{slug}` */
type RouteKey = string;

const key = (method: string, path: string): RouteKey => `${method} ${path}`;

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    return /^route\.(?:ts|tsx|js|mjs)$/.test(entry.name) ? [full] : [];
  });
}

/** `app/api/v1/frameworks/[slug]/route.ts` → `/api/v1/frameworks/{slug}` */
function urlPathOf(file: string): string {
  const segments = relative(join(ROOT, 'app'), file).split(sep).slice(0, -1);
  return (
    '/' +
    segments
      .filter((s) => !/^\(.*\)$/.test(s))
      .map((s) => s.replace(/^\[(.+)\]$/, '{$1}'))
      .join('/')
  );
}

const METHODS = HTTP_METHODS.join('|');

const EXPORT_RE = new RegExp(
  `^export\\s+(?:const|let|var|async\\s+function|function)\\s+(${METHODS})\\b`,
  'gm'
);

/** `export { GET }`, `export { x as POST } from …`, `export const { GET } = …`. */
const UNREADABLE_EXPORT_RE = new RegExp(
  `^export\\s+(?:(?:const|let|var)\\s*)?\\{[^}]*\\b(?:${METHODS})\\b`,
  'm'
);

/** The HTTP methods a route file exports. Throws on an export of one it cannot read. */
function exportedMethods(source: string, file: string): string[] {
  if (/^export\s*\*/m.test(source)) {
    throw new Error(`${file}: \`export *\` hides which methods it exports; export each by name`);
  }
  if (UNREADABLE_EXPORT_RE.test(source)) {
    throw new Error(
      `${file}: exports a method in a form the scan cannot read; declare it as \`export const GET = …\``
    );
  }
  return [...source.matchAll(EXPORT_RE)].map((m) => m[1]);
}

/** Both directions of drift between what files export and what the registry declares. */
function compareRoutes(
  exported: ReadonlySet<RouteKey>,
  declared: readonly RouteKey[]
): { undeclared: RouteKey[]; unexported: RouteKey[]; duplicated: RouteKey[] } {
  const declaredSet = new Set(declared);
  return {
    undeclared: [...exported].filter((k) => !declaredSet.has(k)).sort(),
    unexported: [...declaredSet].filter((k) => !exported.has(k)).sort(),
    duplicated: declared.filter((k, i) => declared.indexOf(k) !== i),
  };
}

/** Each app directory's exported routes. */
function exportedRoutesByDir(): Map<string, Set<RouteKey>> {
  const byDir = new Map<string, Set<RouteKey>>();
  for (const dir of APP_ROUTE_DIRS) {
    const found = new Set<RouteKey>();
    for (const file of routeFiles(join(API_ROOT, dir))) {
      for (const method of exportedMethods(readFileSync(file, 'utf8'), file)) {
        found.add(key(method, urlPathOf(file)));
      }
    }
    byDir.set(dir, found);
  }
  return byDir;
}

function exportedRoutes(): Set<RouteKey> {
  return new Set([...exportedRoutesByDir().values()].flatMap((routes) => [...routes]));
}

const declaredRoutes = APP_ROUTES.map((r) => key(r.method, r.path));

describe('the route registry and the route files', () => {
  it("classes every directory under app/api/v1 as the app's or core's", () => {
    const onDisk = readdirSync(API_ROOT, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    expect(unclassifiedDirs(onDisk)).toEqual([]);
  });

  it('fails for a directory in neither list', () => {
    expect(unclassifiedDirs(['frameworks', 'admin', 'not-a-dir'])).toEqual(['not-a-dir']);
  });

  it('declares exactly the methods the app route files export', () => {
    // Guards against a directory that scans to nothing and so passes vacuously.
    for (const [dir, routes] of exportedRoutesByDir()) {
      expect(routes.size, `${dir} has no routes`).toBeGreaterThan(0);
    }
    expect(compareRoutes(exportedRoutes(), declaredRoutes)).toEqual({
      undeclared: [],
      unexported: [],
      duplicated: [],
    });
  });

  it('fails for a method a route file exports that the registry does not declare', () => {
    const exported = exportedRoutes();
    exported.add('DELETE /api/v1/workspaces/{id}');
    expect(compareRoutes(exported, declaredRoutes).undeclared).toEqual([
      'DELETE /api/v1/workspaces/{id}',
    ]);
  });

  it('fails for a route the registry declares that no file exports', () => {
    const declared = [...declaredRoutes, 'PUT /api/v1/assessments'];
    expect(compareRoutes(exportedRoutes(), declared).unexported).toEqual([
      'PUT /api/v1/assessments',
    ]);
  });

  it('fails for a route declared twice', () => {
    const declared = [...declaredRoutes, declaredRoutes[0]];
    expect(compareRoutes(exportedRoutes(), declared).duplicated).toEqual([declaredRoutes[0]]);
  });

  it('reads the export forms the route files use, and refuses one it cannot read', () => {
    expect(exportedMethods('export const POST = withAuth(…);', 'a')).toEqual(['POST']);
    expect(exportedMethods('export async function GET(request) {}', 'b')).toEqual(['GET']);
    expect(exportedMethods('export const dynamic = "force-dynamic";', 'c')).toEqual([]);
    expect(exportedMethods('export function OPTIONS() {}\nexport const HEAD = h;', 'd')).toEqual([
      'OPTIONS',
      'HEAD',
    ]);
    // An export naming no method is not the scan's business.
    expect(exportedMethods("export { revalidate } from '@/lib/x';\nexport {};", 'e')).toEqual([]);
    expect(() => exportedMethods('export { GET } from "./x";', 'f')).toThrow(/cannot read/);
    expect(() => exportedMethods('export { handler as POST };', 'g')).toThrow(/cannot read/);
    expect(() => exportedMethods("export * from '@/lib/app/handlers';", 'i')).toThrow(/export \*/);
    expect(() => exportedMethods('export const { GET, POST } = make();', 'h')).toThrow(
      /cannot read/
    );
  });

  it('maps a route file to its URL path', () => {
    expect(
      urlPathOf(join(API_ROOT, 'frameworks', '[slug]', 'versions', '[version]', 'route.ts'))
    ).toBe('/api/v1/frameworks/{slug}/versions/{version}');
  });
});

describe('each entry', () => {
  it.each(APP_ROUTES.map((r) => [key(r.method, r.path), r] as const))(
    '%s has a summary and declares a params schema for each path segment it names',
    (_name, route) => {
      expect(route.summary.trim().length).toBeGreaterThan(0);
      const named = [...route.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      if (named.length === 0) {
        expect(route.request.params).toBeUndefined();
        return;
      }
      const params = route.request.params;
      expect(params).toBeDefined();
      // A params object schema's keys are the segments the handler reads.
      const shape: unknown = params && 'shape' in params ? params.shape : undefined;
      expect(Object.keys(shape ?? {}).sort()).toEqual([...named].sort());
    }
  );
});

/** What a value becomes on the wire: JSON.stringify writes a Date as an ISO string. */
type Wire<T> = T extends Date
  ? string
  : T extends readonly (infer U)[]
    ? Wire<U>[]
    : T extends object
      ? { [K in keyof T]: Wire<T[K]> }
      : T;

describe('the report PDF route', () => {
  it('describes its body as binary, in a form OpenAPI can carry', () => {
    const route = APP_ROUTES.find((r) => r.path === '/api/v1/assessments/{id}/report.pdf');
    expect(route?.response.file).toBe('application/pdf');
    expect(z.toJSONSchema(reportPdfSchema)).toMatchObject({ type: 'string', format: 'binary' });
  });
});

describe('response schemas match what the services return', () => {
  it('holds each schema to its service type', () => {
    expectTypeOf<z.infer<typeof versionSummarySchema>>().toEqualTypeOf<Wire<VersionSummary>>();
    expectTypeOf<z.infer<typeof frameworkSummarySchema>>().toEqualTypeOf<Wire<FrameworkSummary>>();
    expectTypeOf<z.infer<typeof frameworkDetailSchema>>().toEqualTypeOf<Wire<FrameworkDetail>>();
    expectTypeOf<z.infer<typeof versionMetaSchema>>().toEqualTypeOf<Wire<VersionMeta>>();
    expectTypeOf<z.infer<typeof kindMetaSchema>>().toEqualTypeOf<Wire<KindMeta>>();
    expectTypeOf<z.infer<typeof createdWorkspaceSchema>>().toEqualTypeOf<Wire<CreatedWorkspace>>();
    expectTypeOf<z.infer<typeof invitationForInviteeSchema>>().toEqualTypeOf<
      Wire<InvitationForInvitee>
    >();
    expectTypeOf<z.infer<typeof acceptedInvitationSchema>>().toEqualTypeOf<
      Wire<Awaited<ReturnType<typeof acceptInvitation>>>
    >();
    expectTypeOf<z.infer<typeof judgeModelChoiceSchema>>().toEqualTypeOf<Wire<JudgeModelChoice>>();
    expectTypeOf<z.infer<typeof workspaceSettingsSchema>>().toEqualTypeOf<
      Wire<WorkspaceSettings>
    >();
    expectTypeOf<z.infer<typeof judgeRunViewSchema>>().toEqualTypeOf<Wire<JudgeRunView>>();
    expectTypeOf<z.infer<typeof assessmentSummarySchema>>().toEqualTypeOf<
      Wire<AssessmentSummary>
    >();
    expectTypeOf<z.infer<typeof assessmentDetailSchema>>().toEqualTypeOf<Wire<AssessmentDetail>>();
    expectTypeOf<z.infer<typeof ephemeralAssessmentSchema>>().toEqualTypeOf<
      Wire<EphemeralAssessment>
    >();
    expectTypeOf<z.infer<typeof quickScanViewSchema>>().toEqualTypeOf<Wire<QuickScanView>>();
    expectTypeOf<z.infer<typeof assessmentEventSchema>>().toEqualTypeOf<Wire<AssessmentEvent>>();
    expectTypeOf<z.infer<typeof assessmentDeletedSchema>>().toEqualTypeOf<
      Wire<Awaited<ReturnType<typeof remove>>>
    >();
    expectTypeOf<z.infer<typeof paginationMetaSchema>>().toEqualTypeOf<Wire<PaginationMeta>>();
    expectTypeOf<z.infer<typeof reportShareSchema>>().toEqualTypeOf<Wire<ReportShareView>>();
    expectTypeOf<z.infer<typeof createdReportShareSchema>>().toEqualTypeOf<
      Wire<CreatedReportShare>
    >();
    expectTypeOf<z.infer<typeof sharedAssessmentSchema>>().toEqualTypeOf<Wire<SharedAssessment>>();
    expectTypeOf<z.infer<typeof frameworkCalibrationSchema>>().toEqualTypeOf<
      Wire<FrameworkCalibration>
    >();
    expectTypeOf<z.infer<typeof startedRunSchema>>().toEqualTypeOf<Wire<StartedRun>>();
    // The route answers 422 rather than send a `null` model.
    expectTypeOf<z.infer<typeof sharedReportSchema>>().toEqualTypeOf<
      Wire<Omit<SharedReport, 'model'> & { model: NonNullable<SharedReport['model']> }>
    >();
  });

  it('accepts a service value once serialised', () => {
    const invitation: InvitationForInvitee = {
      id: 'inv_1',
      workspace: { id: 'org_1', name: 'Team' },
      role: 'MEMBER',
      invitedBy: 'Ada',
      expiresAt: new Date('2026-12-01T00:00:00Z'),
      createdAt: new Date('2026-11-17T00:00:00Z'),
    };
    const wire: unknown = JSON.parse(JSON.stringify(invitation));
    expect(invitationForInviteeSchema.parse(wire)).toEqual(wire);
  });
});
