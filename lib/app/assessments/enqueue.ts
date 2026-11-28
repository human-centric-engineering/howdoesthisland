/**
 * Store a text and queue an assessment of it (t-22, app-plan §8.2).
 *
 * The caller (the API, t-24) has validated the context and resolved the
 * framework version; this refuses what only the store can tell (an unknown
 * version, a profile the version cannot run, a text over the limit), writes
 * the `Content` and the `QUEUED` `Assessment` together, and wakes the
 * maintenance tick so the recovery job is not idle-gated past it.
 *
 * Starting the run is separate ({@link startAssessmentInBackground}), so a
 * caller that waits for the result (`wait=true`) can run it in its own
 * request instead.
 *
 * Runs in the caller's tenant context.
 */
import type { JudgeProfile } from '@/lib/app/frameworks/engine';
import { JudgeProfileError } from '@/lib/app/frameworks/engine';
import { sha256 } from '@/lib/app/frameworks/store';
import type { AssessmentVia, Prisma } from '@prisma/client';
import { engineForVersion } from '@/lib/app/assessments/engine';
import { AssessmentInputError } from '@/lib/app/assessments/errors';
import { assessableText } from '@/lib/app/assessments/text';
import { countWords } from '@/lib/app/intake/extract-text';
import { runAssessment } from '@/lib/app/assessments/run';
import { keepRunningAfterResponse } from '@/lib/api/after-response';
import { prisma } from '@/lib/db/client';
import { noteMaintenanceWork } from '@/lib/orchestration/maintenance/idle-gate';
import { requireOrgId } from '@/lib/tenancy/context';

export interface EnqueueAssessmentInput {
  content: {
    /**
     * `null` for a page a batch names (t-101): stored with its address
     * (`sourceKind: 'URL'`, `sourceUrl`) and no text, which its run fetches
     * when it starts (`run.ts`).
     */
    text: string | null;
    title?: string | null;
    sourceKind: 'TEXT' | 'FILE' | 'URL';
    sourceUrl?: string | null;
    fileName?: string | null;
    projectId?: string | null;
  };
  /** A published version's id. */
  frameworkVersionId: string;
  profile: JudgeProfile;
  /** Who the text is for, already validated against the framework's context schema. */
  context: Prisma.InputJsonObject;
  /**
   * The project's adjustment to the weights (t-72), already checked against
   * this version (`lib/app/projects/overlay.ts`), or none. The run scores
   * with it, and the row records it.
   */
  overlay?: Prisma.InputJsonObject | null;
  requestedVia: AssessmentVia;
  apiKeyId?: string | null;
  /** A real `User.id`, or nothing. */
  userId?: string | null;
}

export interface EnqueuedAssessment {
  assessmentId: string;
  contentId: string;
  /** The judges the profile resolved to, in the version's order. */
  judges: readonly string[];
}

/** A profile as an assessment records it: its name, or `custom` for a list of judges. */
export function storedProfileName(profile: JudgeProfile): string {
  return typeof profile === 'string' ? profile : 'custom';
}

export async function enqueueAssessment(
  input: EnqueueAssessmentInput
): Promise<EnqueuedAssessment> {
  const { enqueued } = await enqueueAssessments([input], () => Promise.resolve(undefined));
  return enqueued[0];
}

/**
 * Sized for a comparison's five drafts of up to 40k characters each, written
 * in one transaction: Prisma's 5s default is for one review's rows, which a
 * single review keeps.
 */
const SEVERAL_TRANSACTION = { maxWait: 10_000, timeout: 15_000 };

/** One input checked as far as the store can, ready to write. */
interface CheckedInput {
  input: EnqueueAssessmentInput;
  /** With its hash and word count, or none of the three for a page its run will fetch. */
  text: { text: string; textSha256: string; wordCount: number } | null;
  versionId: string;
  judges: readonly string[];
}

type LoadedEngine = Awaited<ReturnType<typeof engineForVersion>>;

async function checkInput(
  input: EnqueueAssessmentInput,
  engineOf: (versionId: string) => Promise<LoadedEngine>
): Promise<CheckedInput> {
  const raw = input.content.text;
  if (raw === null && (input.content.sourceKind !== 'URL' || !input.content.sourceUrl)) {
    // Only a page has an address to fetch later; anything else must come with its text.
    throw new AssessmentInputError('content_empty', 'There is no text to assess.');
  }
  const text = raw === null ? null : assessableText(raw);
  const loaded = await engineOf(input.frameworkVersionId);
  if (!loaded || loaded.version.status !== 'PUBLISHED') {
    throw new AssessmentInputError('version_not_found', 'There is no such published version.');
  }
  let judges: readonly string[];
  try {
    judges = loaded.engine.activeJudgeSlots(input.profile);
  } catch (err) {
    if (err instanceof JudgeProfileError) {
      throw new AssessmentInputError('profile_unknown', err.message);
    }
    throw err;
  }
  return {
    input,
    text:
      text === null ? null : { text, textSha256: await sha256(text), wordCount: countWords(text) },
    versionId: loaded.version.id,
    judges,
  };
}

/**
 * {@link enqueueAssessment} for several reviews at once (a comparison's
 * drafts, t-87): every input is checked before anything is written, then
 * every `Content` and `Assessment` is written in one transaction, with
 * whatever `alsoWrite` writes in it given the reviews it wrote, in order. So
 * either all of them and the caller's rows are stored, or none is.
 */
export async function enqueueAssessments<T>(
  inputs: readonly EnqueueAssessmentInput[],
  alsoWrite: (tx: Prisma.TransactionClient, enqueued: EnqueuedAssessment[]) => Promise<T>,
  /**
   * The transaction is sized for several reviews' rows; the default is
   * `inputs.length > 1`. A caller whose `alsoWrite` does more than one review's
   * share (a comparison that reuses reviews and locks them, t-84) says so.
   */
  { several = inputs.length > 1 }: { several?: boolean } = {}
): Promise<{ enqueued: EnqueuedAssessment[]; also: T }> {
  const orgId = requireOrgId();
  // A comparison's drafts share one version: its engine is loaded once.
  const engines = new Map<string, Promise<LoadedEngine>>();
  const engineOf = (versionId: string): Promise<LoadedEngine> => {
    let loaded = engines.get(versionId);
    if (!loaded) {
      loaded = engineForVersion(versionId);
      engines.set(versionId, loaded);
    }
    return loaded;
  };
  const checked: CheckedInput[] = [];
  for (const input of inputs) checked.push(await checkInput(input, engineOf));

  // One transaction, so a content row never exists without its assessment.
  const written = await prisma.$transaction(
    async (tx) => {
      // Checked again here: a page fetch or file read can take long enough for
      // the project to be archived since `projectForReview` passed it (t-70).
      // Not a lock: an archive committing between this read and the inserts
      // still lands, as if the review had come just before it.
      const projectIds = new Set(inputs.flatMap((i) => i.content.projectId ?? []));
      for (const projectId of projectIds) {
        const live = await tx.project.findFirst({
          where: { id: projectId, orgId, archivedAt: null },
          select: { id: true },
        });
        if (!live) {
          throw new AssessmentInputError(
            'project_archived',
            'This project was archived while the review was being prepared. Restore it to review copy in it.'
          );
        }
      }
      const enqueued: EnqueuedAssessment[] = [];
      for (const { input, text, versionId, judges } of checked) {
        const userId = input.userId ?? null;
        const projectId = input.content.projectId ?? null;
        const content = await tx.content.create({
          data: {
            orgId,
            projectId,
            title: input.content.title ?? null,
            sourceKind: input.content.sourceKind,
            sourceUrl: input.content.sourceUrl ?? null,
            fileName: input.content.fileName ?? null,
            text: text?.text ?? null,
            textSha256: text?.textSha256 ?? null,
            wordCount: text?.wordCount ?? null,
            createdByUserId: userId,
          },
          select: { id: true },
        });
        const assessment = await tx.assessment.create({
          data: {
            orgId,
            contentId: content.id,
            projectId,
            frameworkVersionId: versionId,
            profile: storedProfileName(input.profile),
            judges: [...judges],
            context: input.context,
            ...(input.overlay ? { overlay: input.overlay } : {}),
            requestedVia: input.requestedVia,
            apiKeyId: input.apiKeyId ?? null,
            createdByUserId: userId,
          },
          select: { id: true, contentId: true },
        });
        enqueued.push({ assessmentId: assessment.id, contentId: assessment.contentId, judges });
      }
      return { enqueued, also: await alsoWrite(tx, enqueued) };
    },
    several ? SEVERAL_TRANSACTION : undefined
  );

  noteMaintenanceWork('app:assessment-queued');
  return written;
}

/**
 * Run the assessment after the response is sent, in the caller's tenant
 * context. A run that cannot claim it (the workspace is at its limit) leaves
 * it queued, and the next run in the workspace to end starts it.
 */
export function startAssessmentInBackground(assessmentId: string): void {
  keepRunningAfterResponse(() => runAssessment(assessmentId), 'app: assessment run', {
    assessmentId,
  });
}
