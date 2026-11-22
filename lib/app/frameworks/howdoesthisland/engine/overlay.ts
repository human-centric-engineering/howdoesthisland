/**
 * A project's adjustment to a version's weights (D5, t-72): the overlay, and
 * its check against the bounds the version declares.
 *
 * A team writing for one client often knows the reader better than the
 * framework's averages, so a project may shift the appeal mix and the
 * priority dimensions, within the version's `scoring.adjustment_bounds`
 * (`model.ts`). Rubrics, prompts and ids are never adjustable: an overlay
 * holds only numbers to add to the weights and core dimension ids to add to
 * or take off the priority list.
 *
 * **A version without bounds allows no adjustment**, so any overlay on one is
 * refused, as are an unknown id and a move past a bound. Every refusal names
 * the overlay's own path (`weights.ethos`, `priorityDimensions.add.0`).
 *
 * The engine trusts what {@link parseOverlay} returns, as it trusts
 * `parseContext()`.
 */
import { z } from 'zod';
import {
  APPEALS,
  type Appeal,
  type EngineModel,
} from '@/lib/app/frameworks/howdoesthisland/engine/model';

/**
 * A project's adjustment: `weights` are added to the content type's appeal
 * weights before the mix is floored and normalised; `priorityDimensions` are
 * core dimensions added to, or taken off, the content type's priority list.
 */
export interface WeightOverlay {
  weights?: Partial<Record<Appeal, number>>;
  priorityDimensions?: { add?: string[]; remove?: string[] };
}

/** The most dimension ids one list may carry: far above any bound, so a typo is not a bulk refusal. */
const MAX_IDS = 64;

const delta = z.number().finite();
const ids = z.array(z.string().min(1).max(128)).max(MAX_IDS);

/** The overlay's shape alone; the version's ids and bounds are checked after. */
export const overlayShapeSchema = z.strictObject({
  weights: z
    .strictObject({
      ethos: delta.optional(),
      pathos: delta.optional(),
      logos: delta.optional(),
      kairos: delta.optional(),
    })
    .optional(),
  priorityDimensions: z.strictObject({ add: ids.optional(), remove: ids.optional() }).optional(),
});

export interface OverlayIssue {
  path: string;
  message: string;
}

export type OverlayParse =
  { ok: true; overlay: WeightOverlay | null } | { ok: false; issues: OverlayIssue[] };

/** Float slack, so a bound of `0.1` admits a delta of `0.1` however it was written. */
const EPSILON = 1e-9;

const points = (share: number): string => `${+(share * 100).toFixed(1)} points`;

/**
 * The overlay as given, without what changes nothing: zero deltas and empty
 * lists. Null when nothing is left, which is how "no overlay" is recorded.
 */
function trimmed(shape: z.infer<typeof overlayShapeSchema>): WeightOverlay | null {
  const weights: Partial<Record<Appeal, number>> = {};
  for (const a of APPEALS) {
    const d = shape.weights?.[a];
    if (d !== undefined && d !== 0) weights[a] = d;
  }
  const add = shape.priorityDimensions?.add ?? [];
  const remove = shape.priorityDimensions?.remove ?? [];
  const overlay: WeightOverlay = {
    ...(Object.keys(weights).length > 0 ? { weights } : {}),
    ...(add.length > 0 || remove.length > 0
      ? {
          priorityDimensions: {
            ...(add.length > 0 ? { add } : {}),
            ...(remove.length > 0 ? { remove } : {}),
          },
        }
      : {}),
  };
  return Object.keys(overlay).length > 0 ? overlay : null;
}

/** One priority list's ids: core dimensions of this version, each once, and no more than `allowed`. */
function checkIds(
  m: EngineModel,
  list: readonly string[],
  which: 'add' | 'remove',
  allowed: number,
  issues: OverlayIssue[]
): void {
  const at = `priorityDimensions.${which}`;
  const core = new Set(m.DIMS.map((d) => d.id));
  const seen = new Set<string>();
  list.forEach((id, i) => {
    if (!core.has(id)) {
      issues.push({ path: `${at}.${i}`, message: 'Not a core dimension in this version' });
    } else if (seen.has(id)) {
      issues.push({ path: `${at}.${i}`, message: 'Listed twice' });
    }
    seen.add(id);
  });
  if (list.length > allowed) {
    issues.push({
      path: at,
      message:
        allowed === 0
          ? `This version does not let a project ${which} priority dimensions`
          : `This version lets a project ${which} at most ${allowed} priority dimension${allowed === 1 ? '' : 's'}`,
    });
  }
}

/** Check a project's overlay (untrusted; absent is none) against this version's bounds. */
export function parseOverlay(m: EngineModel, input: unknown): OverlayParse {
  if (input === undefined || input === null) return { ok: true, overlay: null };
  const shape = overlayShapeSchema.safeParse(input);
  if (!shape.success) {
    return {
      ok: false,
      issues: shape.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    };
  }
  const overlay = trimmed(shape.data);
  if (overlay === null) return { ok: true, overlay: null };

  const bounds = m.BOUNDS;
  if (bounds === null) {
    return {
      ok: false,
      issues: Object.keys(overlay).map((field) => ({
        path: field,
        message: 'This version declares no bounds, so it allows no adjustment',
      })),
    };
  }

  const issues: OverlayIssue[] = [];
  for (const a of APPEALS) {
    const d = overlay.weights?.[a];
    if (d === undefined) continue;
    const bound = bounds.weights?.[a] ?? 0;
    if (Math.abs(d) > bound + EPSILON) {
      issues.push({
        path: `weights.${a}`,
        message:
          bound === 0
            ? `This version does not let a project move ${a}`
            : `This version lets a project move ${a} by at most ${points(bound)} either way`,
      });
    }
  }
  const add = overlay.priorityDimensions?.add ?? [];
  const remove = overlay.priorityDimensions?.remove ?? [];
  checkIds(m, add, 'add', bounds.priority_dimensions?.add ?? 0, issues);
  checkIds(m, remove, 'remove', bounds.priority_dimensions?.remove ?? 0, issues);
  remove.forEach((id, i) => {
    if (add.includes(id)) {
      issues.push({ path: `priorityDimensions.remove.${i}`, message: 'Both added and removed' });
    }
  });
  return issues.length > 0 ? { ok: false, issues } : { ok: true, overlay };
}

/**
 * A content type's priority dimensions, as `overlay` adjusts them: its own
 * list without the removed ones, then the added ones it lacks, in the
 * overlay's order. Without an overlay, the content type's list itself.
 */
export function priorityWith(
  own: readonly string[],
  overlay: WeightOverlay | null | undefined
): readonly string[] {
  const pd = overlay?.priorityDimensions;
  if (!pd) return own;
  const removed = new Set(pd.remove ?? []);
  const kept = own.filter((id) => !removed.has(id));
  return [...kept, ...(pd.add ?? []).filter((id) => !kept.includes(id))];
}
