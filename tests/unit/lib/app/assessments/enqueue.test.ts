/**
 * Tests: enqueueAssessment and startAssessmentInBackground (t-22), and an upload claimed (t-102).
 *
 * Mocked: Prisma (the in-memory fake), the engine lookup, the idle gate and
 * `keepRunningAfterResponse`. The assertions are on the rows written, what is
 * refused before anything is written, and the tick being woken.
 *
 * @see lib/app/assessments/enqueue.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, type FakeDb } from '@/tests/unit/lib/app/assessments/fake-db';

const mocks = vi.hoisted(() => ({
  engineForVersion: vi.fn(),
  noteMaintenanceWork: vi.fn(),
  keepRunningAfterResponse: vi.fn(),
  runAssessment: vi.fn(),
}));

let fake: FakeDb;
vi.mock('@/lib/db/client', () => ({
  get prisma() {
    return fake.db;
  },
}));
vi.mock('@/lib/app/assessments/engine', () => ({ engineForVersion: mocks.engineForVersion }));
vi.mock('@/lib/orchestration/maintenance/idle-gate', () => ({
  noteMaintenanceWork: mocks.noteMaintenanceWork,
}));
vi.mock('@/lib/api/after-response', () => ({
  keepRunningAfterResponse: mocks.keepRunningAfterResponse,
}));
vi.mock('@/lib/app/assessments/run', () => ({ runAssessment: mocks.runAssessment }));

import {
  enqueueAssessment,
  enqueueAssessments,
  startAssessmentInBackground,
  type EnqueueAssessmentInput,
} from '@/lib/app/assessments/enqueue';
import { AssessmentInputError } from '@/lib/app/assessments/errors';
import { MAX_CONTENT_CHARS } from '@/lib/app/assessments/limits';
import { JudgeProfileError } from '@/lib/app/frameworks/engine';
import { runAsOrg } from '@/lib/tenancy/context';

const ORG = 'org-a';
const SLOTS = ['judge_ethos', 'judge_logos'];

const engine = {
  activeJudgeSlots: vi.fn((profile: unknown) => {
    if (profile === 'full') return SLOTS;
    if (profile === 'quick') return [];
    if (Array.isArray(profile)) return profile;
    throw new JudgeProfileError(`There is no judge profile '${String(profile)}'`);
  }),
};

const input = (over: Partial<EnqueueAssessmentInput> = {}): EnqueueAssessmentInput => ({
  content: { text: 'Buy our bicycles. They are fast.', sourceKind: 'TEXT', title: 'Landing' },
  frameworkVersionId: 'version-1',
  profile: 'full',
  context: { contentType: 'landing', archetype: 'buyer', audience: {} },
  requestedVia: 'API',
  apiKeyId: 'key-1',
  userId: 'user-1',
  ...over,
});

const enqueue = (over: Partial<EnqueueAssessmentInput> = {}) =>
  runAsOrg(ORG, () => enqueueAssessment(input(over)));

async function refusal(promise: Promise<unknown>): Promise<AssessmentInputError> {
  const err: unknown = await promise.then(
    () => null,
    (e: unknown) => e
  );
  if (!(err instanceof AssessmentInputError))
    throw new Error(`expected a refusal, got ${String(err)}`);
  return err;
}

beforeEach(() => {
  vi.clearAllMocks();
  fake = createFakeDb();
  mocks.engineForVersion.mockResolvedValue({
    version: { id: 'version-1', status: 'PUBLISHED' },
    engine,
    label: 'howdoesthisland@0.5.1',
  });
});

describe('enqueueAssessment', () => {
  it('stores the content and a QUEUED assessment with the judges the profile resolved to', async () => {
    const queued = await enqueue();

    expect(queued).toEqual({
      assessmentId: fake.assessments[0].id,
      contentId: fake.contents[0].id,
      judges: SLOTS,
    });
    expect(fake.contents[0]).toMatchObject({
      orgId: ORG,
      title: 'Landing',
      sourceKind: 'TEXT',
      text: 'Buy our bicycles. They are fast.',
      wordCount: 6,
      createdByUserId: 'user-1',
    });
    expect(fake.contents[0].textSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(fake.assessments[0]).toMatchObject({
      orgId: ORG,
      status: 'QUEUED',
      profile: 'full',
      judges: SLOTS,
      frameworkVersionId: 'version-1',
      context: { contentType: 'landing', archetype: 'buyer', audience: {} },
      requestedVia: 'API',
      apiKeyId: 'key-1',
      createdByUserId: 'user-1',
    });
  });

  it('wakes the maintenance tick, so the recovery job is not idle-gated past it', async () => {
    await enqueue();
    expect(mocks.noteMaintenanceWork).toHaveBeenCalledTimes(1);
  });

  it('records an explicit list of judges as the custom profile', async () => {
    await enqueue({ profile: ['judge_logos'] });
    expect(fake.assessments[0]).toMatchObject({ profile: 'custom', judges: ['judge_logos'] });
  });

  it('records the project it is in on both rows', async () => {
    fake.projects.push({ id: 'project-1', orgId: ORG, archivedAt: null });
    await enqueue({ content: { ...input().content, projectId: 'project-1' } });
    expect(fake.contents[0]).toMatchObject({ projectId: 'project-1' });
    expect(fake.assessments[0]).toMatchObject({ projectId: 'project-1' });
  });

  it('refuses a review whose project was archived after it was checked, storing nothing', async () => {
    // `projectForReview` passed it; a page fetch later, someone archived it.
    fake.projects.push({ id: 'project-1', orgId: ORG, archivedAt: new Date() });
    const err = await refusal(enqueue({ content: { ...input().content, projectId: 'project-1' } }));
    expect(err.code).toBe('project_archived');
    expect(fake.contents).toHaveLength(0);
    expect(fake.assessments).toHaveLength(0);
    expect(mocks.noteMaintenanceWork).not.toHaveBeenCalled();
  });

  it('refuses a project of another workspace the same way', async () => {
    fake.projects.push({ id: 'project-1', orgId: 'org-b', archivedAt: null });
    const err = await refusal(enqueue({ content: { ...input().content, projectId: 'project-1' } }));
    expect(err.code).toBe('project_archived');
    expect(fake.assessments).toHaveLength(0);
  });

  it(`refuses a text longer than ${MAX_CONTENT_CHARS} characters, storing nothing`, async () => {
    const err = await refusal(
      enqueue({ content: { text: 'a'.repeat(MAX_CONTENT_CHARS + 1), sourceKind: 'TEXT' } })
    );
    expect(err.code).toBe('content_too_long');
    expect(err.message).toContain('40,000');
    expect(fake.assessments).toHaveLength(0);
    expect(fake.contents).toHaveLength(0);
    expect(mocks.noteMaintenanceWork).not.toHaveBeenCalled();
  });

  it(`accepts a text of exactly ${MAX_CONTENT_CHARS} characters`, async () => {
    await enqueue({ content: { text: 'a'.repeat(MAX_CONTENT_CHARS), sourceKind: 'TEXT' } });
    expect(fake.assessments).toHaveLength(1);
  });

  it('counts characters as an editor does, not UTF-16 units', async () => {
    // Each emoji is two UTF-16 units: 40,000 characters, 80,000 units.
    await enqueue({ content: { text: '😀'.repeat(MAX_CONTENT_CHARS), sourceKind: 'TEXT' } });
    expect(fake.assessments).toHaveLength(1);
  });

  it('drops NUL characters, which Postgres refuses in a text column', async () => {
    await enqueue({ content: { text: 'Before\u0000after', sourceKind: 'TEXT' } });
    expect(fake.contents[0]).toMatchObject({ text: 'Beforeafter' });
  });

  it('refuses an empty text', async () => {
    expect((await refusal(enqueue({ content: { text: '  \n ', sourceKind: 'TEXT' } }))).code).toBe(
      'content_empty'
    );
  });

  it.each([
    ['no version with that id', null],
    ['a draft version', { version: { id: 'version-1', status: 'DRAFT' }, engine, label: 'x' }],
  ])('refuses %s', async (_case, loaded) => {
    mocks.engineForVersion.mockResolvedValue(loaded);
    expect((await refusal(enqueue())).code).toBe('version_not_found');
    expect(fake.assessments).toHaveLength(0);
  });

  it('refuses a profile the version cannot run', async () => {
    const err = await refusal(enqueue({ profile: 'everything' }));
    expect(err).toMatchObject({
      code: 'profile_unknown',
      message: "There is no judge profile 'everything'",
    });
    expect(fake.assessments).toHaveLength(0);
  });
});

describe('enqueueAssessments (t-87)', () => {
  it('stores each review in order and hands them to alsoWrite in the same transaction', async () => {
    const alsoWrite = vi.fn(async (_tx: unknown, enqueued: { assessmentId: string }[]) =>
      enqueued.map((e) => e.assessmentId).join(',')
    );

    const { enqueued, also } = await runAsOrg(ORG, () =>
      enqueueAssessments(
        [
          input({ content: { text: 'Draft one.', sourceKind: 'TEXT', title: 'A' } }),
          input({ content: { text: 'Draft two.', sourceKind: 'TEXT', title: 'B' } }),
        ],
        alsoWrite
      )
    );

    expect(fake.contents.map((c) => [c.text, c.title])).toEqual([
      ['Draft one.', 'A'],
      ['Draft two.', 'B'],
    ]);
    expect(enqueued.map((e) => e.assessmentId)).toEqual(fake.assessments.map((a) => a.id));
    expect(enqueued.map((e) => e.judges)).toEqual([SLOTS, SLOTS]);
    expect(also).toBe(fake.assessments.map((a) => a.id).join(','));
    expect(fake.db.$transaction).toHaveBeenCalledTimes(1);
    expect(alsoWrite.mock.calls[0][0]).toBe(fake.db);
    expect(mocks.noteMaintenanceWork).toHaveBeenCalledTimes(1);
  });

  it('checks every input before writing any: one refused stores none', async () => {
    const alsoWrite = vi.fn(async () => undefined);

    const err = await refusal(
      runAsOrg(ORG, () =>
        enqueueAssessments(
          [input(), input({ content: { text: '   ', sourceKind: 'TEXT' } })],
          alsoWrite
        )
      )
    );

    expect(err.code).toBe('content_empty');
    expect(fake.contents).toEqual([]);
    expect(fake.assessments).toEqual([]);
    expect(alsoWrite).not.toHaveBeenCalled();
  });

  it('checks a project the inputs share once', async () => {
    fake.projects.push({ id: 'project-1', orgId: ORG, archivedAt: null });
    const inProject = { text: 'Draft.', sourceKind: 'TEXT' as const, projectId: 'project-1' };

    await runAsOrg(ORG, () =>
      enqueueAssessments(
        [input({ content: inProject }), input({ content: inProject })],
        async () => undefined
      )
    );

    expect(fake.db.project.findFirst).toHaveBeenCalledTimes(1);
    expect(fake.assessments.map((a) => a.projectId)).toEqual(['project-1', 'project-1']);
  });

  it('loads the version the inputs share once, and each other version once', async () => {
    await runAsOrg(ORG, () =>
      enqueueAssessments(
        [input(), input(), input({ frameworkVersionId: 'version-2' })],
        async () => undefined
      )
    );

    expect(mocks.engineForVersion.mock.calls.map(([id]) => id)).toEqual([
      input().frameworkVersionId,
      'version-2',
    ]);
    expect(fake.assessments).toHaveLength(3);
  });

  it('gives the write transaction room for a comparison of five long drafts', async () => {
    await runAsOrg(ORG, () => enqueueAssessments([input(), input()], async () => undefined));

    expect(fake.db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 10_000,
      timeout: 15_000,
    });
  });

  it('leaves a single review on the transaction defaults', async () => {
    await runAsOrg(ORG, () => enqueueAssessments([input()], async () => undefined));

    expect(fake.db.$transaction).toHaveBeenCalledWith(expect.any(Function), undefined);
  });
});

describe('an upload a batch item names (t-102)', () => {
  /** An upload as `POST /api/v1/contents` stores one. */
  async function upload(orgId = ORG) {
    return fake.db.content.create({
      data: {
        orgId,
        title: 'launch',
        sourceKind: 'FILE',
        fileName: 'launch.txt',
        text: 'Book a demo.',
        textSha256: 'f'.repeat(64),
        wordCount: 3,
        awaitingBatch: true,
      },
    });
  }
  const claiming = (uploadId: string, over: Partial<EnqueueAssessmentInput['content']> = {}) =>
    input({ content: { text: null, sourceKind: 'FILE', uploadId, ...over } });

  it('takes the upload as the review’s content, filing it in the project, without writing another', async () => {
    fake.projects.push({ id: 'project-1', orgId: ORG, archivedAt: null });
    const { id } = await upload();
    const queued = await runAsOrg(ORG, () =>
      enqueueAssessment(claiming(id, { projectId: 'project-1', title: 'Launch email' }))
    );

    expect(queued.contentId).toBe(id);
    expect(fake.contents).toHaveLength(1);
    expect(fake.contents[0]).toMatchObject({
      awaitingBatch: false,
      projectId: 'project-1',
      title: 'Launch email',
      text: 'Book a demo.',
    });
    expect(fake.assessments[0]).toMatchObject({ contentId: id, projectId: 'project-1' });
  });

  it('keeps the title intake gave it when the item has no label', async () => {
    const { id } = await upload();
    await runAsOrg(ORG, () => enqueueAssessment(claiming(id)));
    expect(fake.contents[0]).toMatchObject({ title: 'launch', projectId: null });
  });

  it('refuses one taken already as upload_in_use, and another workspace’s as upload_not_found', async () => {
    const { id: mine } = await upload();
    await runAsOrg(ORG, () => enqueueAssessment(claiming(mine)));
    const taken = await refusal(runAsOrg(ORG, () => enqueueAssessment(claiming(mine))));
    expect(taken.code).toBe('upload_in_use');
    expect(taken.details).toEqual({ contentId: mine });

    const { id: theirs } = await upload('org-b');
    const elsewhere = await refusal(runAsOrg(ORG, () => enqueueAssessment(claiming(theirs))));
    expect(elsewhere.code).toBe('upload_not_found');
    expect(elsewhere.details).toEqual({ contentId: theirs });
    expect(fake.contents.find((c) => c.id === theirs)).toMatchObject({ awaitingBatch: true });
    expect(fake.assessments).toHaveLength(1);
  });

  it('refuses one past its window as upload_not_found, leaving it for the job to delete', async () => {
    const { id } = await upload();
    const row = fake.contents.find((c) => c.id === id);
    if (row) row.createdAt = new Date(Date.now() - 24 * 60 * 60 * 1000 - 1);
    const err = await refusal(runAsOrg(ORG, () => enqueueAssessment(claiming(id))));
    expect(err.code).toBe('upload_not_found');
    expect(row).toMatchObject({ awaitingBatch: true });
    expect(fake.assessments).toEqual([]);
  });
});

describe('startAssessmentInBackground', () => {
  it('hands the run to keepRunningAfterResponse, not yet started', async () => {
    startAssessmentInBackground('assessment-1');

    expect(mocks.keepRunningAfterResponse).toHaveBeenCalledWith(
      expect.any(Function),
      'app: assessment run',
      { assessmentId: 'assessment-1' }
    );
    expect(mocks.runAssessment).not.toHaveBeenCalled();
    const [task] = mocks.keepRunningAfterResponse.mock.calls[0];
    await task();
    expect(mocks.runAssessment).toHaveBeenCalledWith('assessment-1');
  });
});
