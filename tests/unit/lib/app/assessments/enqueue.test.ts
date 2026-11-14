/**
 * Tests: enqueueAssessment and startAssessmentInBackground (t-22).
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
