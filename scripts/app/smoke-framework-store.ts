/**
 * Smoke: the framework store against the real development database at
 * `TENANCY_MODE=multi` (t-10).
 *
 *   npx tsx --env-file=.env.local scripts/app/smoke-framework-store.ts
 *
 * What the unit tests cannot show, because they run on an in-memory fake:
 *
 *   • 0.5.1 imports and publishes through the real Prisma repo, in the system
 *     scope, with every record and link written in one transaction;
 *   • importing it again writes nothing;
 *   • a changed file under the published version number is refused, and the
 *     stored records are untouched;
 *   • from inside a workspace that is not the install org, the shared-config
 *     tables are readable and `materialise()` gives back the committed file.
 *
 * Leaves 0.5.1 imported and published, which is the state the dev database
 * should be in anyway. The workspace it reads from is erased in `finally`.
 *
 * Exit 0 passed, 1 a check failed.
 */
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { howDoesThisLand } from '@/lib/app/frameworks/howdoesthisland/definition';
import { prismaFrameworkRepo as repo } from '@/lib/app/frameworks/repo';
import {
  FrameworkStoreError,
  importVersion,
  materialise,
  publishVersion,
} from '@/lib/app/frameworks/store';
import { prisma } from '@/lib/db/client';
import { eraseOrg } from '@/lib/privacy/erase-org';
import { createOrg } from '@/lib/tenancy/lifecycle';
import { INSTALL_ORG_ID } from '@/lib/tenancy/constants';
import { isMultiTenant, runAsOrg, runAsSystem } from '@/lib/tenancy/context';

const FILE = 'lib/app/frameworks/howdoesthisland/data/model-0.5.1.json';
let failures = 0;

function check(ok: boolean, what: string): void {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures++;
}

const system = <T>(fn: () => Promise<T>) => runAsSystem('smoke: framework store', fn);

async function main(): Promise<number> {
  check(isMultiTenant(), 'TENANCY_MODE is multi');
  const raw = readFileSync(FILE, 'utf8');
  const file: unknown = JSON.parse(raw);

  const first = await system(() => importVersion(repo, howDoesThisLand, raw));
  check(first.nodeCount > 600 && first.linkCount > 1000, `imported 0.5.1 (${first.outcome})`);
  const published = await system(() => publishVersion(repo, 'howdoesthisland', '0.5.1'));
  check(published.version.status === 'PUBLISHED', `published 0.5.1 (${published.outcome})`);

  const versionId = published.version.id;
  const countRecords = () =>
    system(() =>
      Promise.all([
        prisma.frameworkNode.count({ where: { versionId } }),
        prisma.frameworkLink.count({ where: { versionId } }),
      ])
    );
  const [nodes, links] = await countRecords();
  check(
    nodes === first.nodeCount && links === first.linkCount,
    `${nodes} records, ${links} links stored`
  );

  const again = await system(() => importVersion(repo, howDoesThisLand, raw));
  check(again.outcome === 'unchanged', 'importing the same file again writes nothing');

  const changed = JSON.parse(raw) as { appeals: { name: string }[] };
  changed.appeals[0].name = 'Changed';
  const refused = await system(() =>
    importVersion(repo, howDoesThisLand, JSON.stringify(changed))
  ).then(
    () => null,
    (err: unknown) => err
  );
  check(
    refused instanceof FrameworkStoreError && refused.code === 'VERSION_PUBLISHED',
    'a changed file under the published version is refused'
  );
  const [nodesAfter, linksAfter] = await countRecords();
  check(nodesAfter === nodes && linksAfter === links, 'the published records are untouched');

  const stamp = `${Date.now()}`;
  const org = await system(() =>
    createOrg({ slug: `smoke-frameworks-${stamp}`, name: 'Smoke frameworks' })
  );
  try {
    check(org.id !== INSTALL_ORG_ID, 'reading from a workspace that is not the install org');
    const model = await runAsOrg(org.id, () => materialise(repo, howDoesThisLand, versionId));
    check(isDeepStrictEqual(model, file), 'materialise() inside it equals the committed file');
  } finally {
    await system(() => eraseOrg({ orgId: org.id, actorUserId: 'smoke' })).catch(() => undefined);
  }

  console.log(failures === 0 ? 'Framework store smoke passed' : `${failures} check(s) failed`);
  return failures === 0 ? 0 : 1;
}

void main()
  .catch((err: unknown) => {
    console.error(err);
    return 1;
  })
  .then(async (code) => {
    await prisma.$disconnect();
    process.exit(code);
  });
