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
import type { JsonObject } from '@/lib/app/frameworks/types';
import { engineForVersion } from '@/lib/app/assessments/engine';
import { AssessmentInputError } from '@/lib/app/assessments/errors';
import { MAX_CONTENT_CHARS } from '@/lib/app/assessments/limits';
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
  context: JsonObject;
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

export async function enqueueAssessment(
  input: EnqueueAssessmentInput
): Promise<EnqueuedAssessment> {
  const orgId = requireOrgId();
  const { text } = input.content;
  if (text.trim() === '') {
    throw new AssessmentInputError('content_empty', 'There is no text to assess.');
  }
  if (text.length > MAX_CONTENT_CHARS) {
    throw new AssessmentInputError(
      'content_too_long',
      `The text is ${text.length.toLocaleString('en-GB')} characters long. The most an assessment takes is ${MAX_CONTENT_CHARS.toLocaleString('en-GB')}.`
    );
  }

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
  const assessment = await prisma.assessment.create({
    data: {
      orgId,
      profile: typeof input.profile === 'string' ? input.profile : 'custom',
      judges: [...judges],
      context: input.context,
      requestedVia: input.requestedVia,
      apiKeyId: input.apiKeyId ?? null,
      createdByUserId: userId,
      projectId: input.content.projectId ?? null,
      frameworkVersion: { connect: { id: loaded.version.id } },
      content: {
        create: {
          orgId,
          projectId: input.content.projectId ?? null,
          title: input.content.title ?? null,
          sourceKind: input.content.sourceKind,
          sourceUrl: input.content.sourceUrl ?? null,
          fileName: input.content.fileName ?? null,
          text,
          textSha256: await sha256(text),
          wordCount: text.split(/\s+/).filter(Boolean).length,
          createdByUserId: userId,
        },
      },
    },
    select: { id: true, contentId: true },
  });

  noteMaintenanceWork('app:assessment-queued');
  return { assessmentId: assessment.id, contentId: assessment.contentId, judges };
}

/**
 * Run the assessment after the response is sent, in the caller's tenant
 * context. A run that cannot claim it (the workspace is at its limit) leaves
 * it queued for the recovery job.
 */
export function startAssessmentInBackground(assessmentId: string): void {
  keepRunningAfterResponse(() => runAssessment(assessmentId), 'app: assessment run', {
    assessmentId,
  });
}
