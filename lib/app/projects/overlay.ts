/**
 * A project's adjustment to its framework's weights (D5, t-72), as the
 * projects API and a review in the project use it.
 *
 * What an overlay may hold, and the bounds it is checked against, are the
 * framework version's (`engine.parseOverlay()`; HowDoesThisLand's is
 * `engine/overlay.ts`): the bounds are versioned data in the model, and a
 * version that declares none allows no adjustment. So, as with the defaults:
 *
 * - **Checked when written**, against the latest published version of the
 *   project's framework. A refusal is 400 `OVERLAY_INVALID`, each problem by
 *   its path in the request body (`overlay.weights.ethos`).
 * - **Checked again for each review**, against the version it runs with
 *   ({@link overlayForReview}), so a review pinned to a version without bounds
 *   is refused rather than scored with an adjustment that version never
 *   allowed.
 * - **Stored as the engine checked it**: what changes nothing (a zero, an
 *   empty list) is dropped, and an overlay that is then empty is stored as
 *   null, which is how "none" is recorded on the project and the assessment.
 */
import { z } from 'zod';
import { APIError } from '@/lib/api/errors';
import type { FrameworkEngine } from '@/lib/app/frameworks/engine';

/** An overlay as a JSON column holds it. */
export type StoredOverlay = Record<string, z.infer<ReturnType<typeof z.json>>>;

const jsonObject = z.record(z.string(), z.json());

/** The engine's checked overlay as plain JSON, or null for none. */
function stored(overlay: unknown): StoredOverlay | null {
  if (overlay === null || overlay === undefined) return null;
  return jsonObject.parse(JSON.parse(JSON.stringify(overlay)));
}

function overlayInvalid(
  message: string,
  issues: { path: string; message: string }[],
  details: Record<string, unknown> = {}
): APIError {
  return new APIError(message, 'OVERLAY_INVALID', 400, {
    issues: issues.map((issue) => ({
      path: ['overlay', issue.path].filter(Boolean).join('.'),
      message: issue.message,
    })),
    ...details,
  });
}

/**
 * Check `input` against `engine`'s version, for a project being written: the
 * overlay to store (null for none), or 400 `OVERLAY_INVALID`.
 */
export function overlayToStore(engine: FrameworkEngine, input: unknown): StoredOverlay | null {
  const parsed = engine.parseOverlay(input);
  if (!parsed.ok) {
    throw overlayInvalid(
      "The project's weight adjustment does not fit its framework's latest version.",
      parsed.issues
    );
  }
  return stored(parsed.overlay);
}

/**
 * A review in a project: `engine`, scoring with the project's overlay, and
 * the overlay to record on the assessment (null for none). The project's
 * overlay is checked against this version; refused, it is 400
 * `OVERLAY_INVALID` marked `fromProjectOverlay`, since the caller never sent
 * it.
 */
export function overlayForReview(
  engine: FrameworkEngine,
  projectOverlay: unknown
): { engine: FrameworkEngine; overlay: StoredOverlay | null } {
  if (projectOverlay === null || projectOverlay === undefined) return { engine, overlay: null };
  const parsed = engine.parseOverlay(projectOverlay);
  if (!parsed.ok) {
    throw overlayInvalid(
      "The project's weight adjustment does not fit this framework version. Change the project's weights, or review with a version whose bounds allow them.",
      parsed.issues,
      { fromProjectOverlay: true }
    );
  }
  if (parsed.overlay === null) return { engine, overlay: null };
  return { engine: engine.withOverlay(parsed.overlay), overlay: stored(parsed.overlay) };
}
