/**
 * Tests: the app's route registry (t-23) — it declares exactly the methods the
 * app's route files export, and each response schema matches the type the
 * service behind it returns.
 *
 * FORK NOTE: this is HowDoesThisLand's own test of its own module. A route
 * directory the app adds under `app/api/v1/` goes in `APP_ROUTE_DIRS`, and
 * every route in it then needs a registry entry before this passes.
 *
 * Route files are read as text, not imported: importing a handler pulls in
 * the auth guards and the database client, and an export the regex cannot
 * read (`export { GET }`) is refused rather than missed.
 *
 * @see lib/app/api/registry.ts
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import {
  APP_ROUTES,
  HTTP_METHODS,
  acceptedInvitationSchema,
  createdWorkspaceSchema,
  frameworkDetailSchema,
  frameworkSummarySchema,
  invitationForInviteeSchema,
  judgeModelChoiceSchema,
  versionSummarySchema,
} from '@/lib/app/api/registry';
import type {
  FrameworkDetail,
  FrameworkSummary,
  VersionSummary,
} from '@/lib/app/frameworks/api/service';
import type { CreatedWorkspace } from '@/lib/app/workspaces/create';
import type { InvitationForInvitee, acceptInvitation } from '@/lib/app/workspaces/invitations';
import type { JudgeModelChoice } from '@/lib/app/judges/model-choice';

/** The route directories this fork added under `app/api/v1/`. Core's are not the app's. */
const APP_ROUTE_DIRS = ['frameworks', 'workspaces'] as const;

const ROOT = process.cwd();
const API_ROOT = join(ROOT, 'app', 'api', 'v1');

/** `GET /api/v1/frameworks/{slug}` */
type RouteKey = string;

const key = (method: string, path: string): RouteKey => `${method} ${path}`;

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    return entry.name === 'route.ts' ? [full] : [];
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

const EXPORT_RE = new RegExp(
  `^export\\s+(?:const|async\\s+function|function)\\s+(${HTTP_METHODS.join('|')})\\b`,
  'gm'
);

/** The HTTP methods a route file exports. Throws on an export form it cannot read. */
function exportedMethods(source: string, file: string): string[] {
  if (/^export\s*\{/m.test(source)) {
    throw new Error(`${file}: re-exports a method; declare it as \`export const GET = …\``);
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

function exportedRoutes(): Set<RouteKey> {
  const found = new Set<RouteKey>();
  for (const dir of APP_ROUTE_DIRS) {
    for (const file of routeFiles(join(API_ROOT, dir))) {
      for (const method of exportedMethods(readFileSync(file, 'utf8'), file)) {
        found.add(key(method, urlPathOf(file)));
      }
    }
  }
  return found;
}

const declaredRoutes = APP_ROUTES.map((r) => key(r.method, r.path));

describe('the route registry and the route files', () => {
  it('declares exactly the methods the app route files export', () => {
    const exported = exportedRoutes();
    // Guards against a scan that finds nothing and so passes vacuously.
    expect(exported.size).toBeGreaterThanOrEqual(11);
    expect(compareRoutes(exported, declaredRoutes)).toEqual({
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
    const declared = [...declaredRoutes, 'GET /api/v1/assessments'];
    expect(compareRoutes(exportedRoutes(), declared).unexported).toEqual([
      'GET /api/v1/assessments',
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
    expect(() => exportedMethods('export { GET } from "./x";', 'd')).toThrow(/re-exports/);
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

describe('response schemas match what the services return', () => {
  it('holds each schema to its service type', () => {
    expectTypeOf<z.infer<typeof versionSummarySchema>>().toEqualTypeOf<Wire<VersionSummary>>();
    expectTypeOf<z.infer<typeof frameworkSummarySchema>>().toEqualTypeOf<Wire<FrameworkSummary>>();
    expectTypeOf<z.infer<typeof frameworkDetailSchema>>().toEqualTypeOf<Wire<FrameworkDetail>>();
    expectTypeOf<z.infer<typeof createdWorkspaceSchema>>().toEqualTypeOf<Wire<CreatedWorkspace>>();
    expectTypeOf<z.infer<typeof invitationForInviteeSchema>>().toEqualTypeOf<
      Wire<InvitationForInvitee>
    >();
    expectTypeOf<z.infer<typeof acceptedInvitationSchema>>().toEqualTypeOf<
      Wire<Awaited<ReturnType<typeof acceptInvitation>>>
    >();
    expectTypeOf<z.infer<typeof judgeModelChoiceSchema>>().toEqualTypeOf<Wire<JudgeModelChoice>>();
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
