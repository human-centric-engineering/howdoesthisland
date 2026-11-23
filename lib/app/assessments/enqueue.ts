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
import type { Prisma } from '@prisma/client';
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
    text: string;
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
  requestedVia: 'APP' | 'API';
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
  const orgId = requireOrgId();
  const text = assessableText(input.content.text);

  const loaded = await engineForVersion(input.frameworkVersionId);
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

  const userId = input.userId ?? null;
  const projectId = input.content.projectId ?? null;
  const textSha256 = await sha256(text);
  // One transaction, so a content row never exists without its assessment.
  const assessment = await prisma.$transaction(async (tx) => {
    // Checked again here: a page fetch or file read can take long enough for
    // the project to be archived since `projectForReview` passed it (t-70).
    // Not a lock: an archive committing between this read and the inserts
    // still lands, as if the review had come just before it.
    if (projectId !== null) {
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
    const content = await tx.content.create({
      data: {
        orgId,
        projectId,
        title: input.content.title ?? null,
        sourceKind: input.content.sourceKind,
        sourceUrl: input.content.sourceUrl ?? null,
        fileName: input.content.fileName ?? null,
        text,
        textSha256,
        wordCount: countWords(text),
        createdByUserId: userId,
      },
      select: { id: true },
    });
    return tx.assessment.create({
      data: {
        orgId,
        contentId: content.id,
        projectId,
        frameworkVersionId: loaded.version.id,
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
  });

  noteMaintenanceWork('app:assessment-queued');
  return { assessmentId: assessment.id, contentId: assessment.contentId, judges };
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
