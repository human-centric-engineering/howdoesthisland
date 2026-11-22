/**
 * A project's weight adjustment (t-72), between the API's overlay and the
 * weights section's fields. Pure, so it is tested without rendering.
 *
 * The API holds an overlay as shares of the mix (`0.1`); the page shows
 * points (`10`), the unit the report's mix is read in. What may move, and
 * how far, is the version's (`catalogue.request.adjustment`); the API checks
 * it again on save (`lib/app/projects/overlay.ts`), and this page only
 * offers what the version allows.
 */
import { z } from 'zod';
import type { DefaultsCatalogue, ProjectWire } from '@/components/app/projects/schemas';

export const APPEAL_IDS = ['ethos', 'pathos', 'logos', 'kairos'] as const;
export type AppealId = (typeof APPEAL_IDS)[number];

export type Adjustment = NonNullable<DefaultsCatalogue['request']['adjustment']>;

export interface WeightsFormValues {
  /** Points of the mix, signed, per appeal. */
  weights: Record<AppealId, number>;
  /** Core dimension ids to make a priority. */
  add: string[];
  /** Core dimension ids that stop being a priority. */
  remove: string[];
}

/** The overlay as the HowDoesThisLand engine stores it; anything else reads as nothing. */
const storedOverlaySchema = z.object({
  weights: z.partialRecord(z.enum(APPEAL_IDS), z.number()).optional(),
  priorityDimensions: z
    .object({ add: z.array(z.string()).optional(), remove: z.array(z.string()).optional() })
    .optional(),
});

/**
 * Shares ↔ points without losing what the API stored: rounding only clears
 * float noise (`0.07 * 100`), so an untouched value saves back as it was.
 */
const toPoints = (share: number): number => +(share * 100).toFixed(6);
const toShare = (points: number): number => +(points / 100).toFixed(8);
/** A limit as the page states it: a tenth of a point is the finest it shows. */
const shownPoints = (share: number): number => +(share * 100).toFixed(1);
/** The engine's slack (`engine/overlay.ts`), so the form and the API agree at the limit. */
const EPSILON = 1e-9;

/** Whether the project holds an overlay this page can read. */
export function storedOverlayReadable(project: ProjectWire): boolean {
  return project.overlay === null || storedOverlaySchema.safeParse(project.overlay).success;
}

export function weightsValuesOf(project: ProjectWire): WeightsFormValues {
  const parsed = storedOverlaySchema.safeParse(project.overlay ?? {});
  const o = parsed.success ? parsed.data : {};
  return {
    weights: {
      ethos: toPoints(o.weights?.ethos ?? 0),
      pathos: toPoints(o.weights?.pathos ?? 0),
      logos: toPoints(o.weights?.logos ?? 0),
      kairos: toPoints(o.weights?.kairos ?? 0),
    },
    add: o.priorityDimensions?.add ?? [],
    remove: o.priorityDimensions?.remove ?? [],
  };
}

/** What `PATCH` sends for the section's values: the overlay, or null when it changes nothing. */
export function overlayBodyOf(values: WeightsFormValues): {
  overlay: Record<string, unknown> | null;
} {
  const weights: Partial<Record<AppealId, number>> = {};
  for (const a of APPEAL_IDS) if (values.weights[a] !== 0) weights[a] = toShare(values.weights[a]);
  const overlay: Record<string, unknown> = {
    ...(Object.keys(weights).length > 0 ? { weights } : {}),
    ...(values.add.length > 0 || values.remove.length > 0
      ? {
          priorityDimensions: {
            ...(values.add.length > 0 ? { add: values.add } : {}),
            ...(values.remove.length > 0 ? { remove: values.remove } : {}),
          },
        }
      : {}),
  };
  return { overlay: Object.keys(overlay).length > 0 ? overlay : null };
}

/** The form's own check, from the version's bounds: the same limits the API holds it to. */
export function weightsFormSchema(
  adjustment: Adjustment
): z.ZodType<WeightsFormValues, WeightsFormValues> {
  const appeal = (a: AppealId) => {
    // Checked in shares against the exact bound, as the API checks it; only
    // the message rounds.
    const bound = adjustment.weights[a];
    const most = shownPoints(bound);
    return z
      .number({ error: 'Enter a number of points' })
      .refine((p) => Math.abs(toShare(p)) <= bound + EPSILON, {
        error:
          bound === 0 ? 'This model version does not let it move' : `At most ${most} either way`,
      });
  };
  const ids = (most: number, verb: string) =>
    z.array(z.string()).max(most, { error: `${verb} at most ${most}` });
  return z
    .object({
      weights: z.object({
        ethos: appeal('ethos'),
        pathos: appeal('pathos'),
        logos: appeal('logos'),
        kairos: appeal('kairos'),
      }),
      add: ids(adjustment.priorityDimensions.add, 'Choose'),
      remove: ids(adjustment.priorityDimensions.remove, 'Choose'),
    })
    .superRefine((v, ctx) => {
      if (v.remove.some((id) => v.add.includes(id))) {
        ctx.addIssue({
          code: 'custom',
          path: ['remove'],
          message: 'A dimension cannot be both added and removed',
        });
      }
    });
}

/** Server path → the section's field: `overlay.weights.ethos`, `overlay.priorityDimensions.add.0`. */
export function weightsIssues(details: unknown): {
  fields: Array<{ field: `weights.${AppealId}` | 'add' | 'remove'; message: string }>;
  other: string[];
} | null {
  const parsed = z
    .object({ issues: z.array(z.object({ path: z.string(), message: z.string() })) })
    .safeParse(details);
  if (!parsed.success) return null;
  const fields: Array<{ field: `weights.${AppealId}` | 'add' | 'remove'; message: string }> = [];
  const other: string[] = [];
  for (const { path, message } of parsed.data.issues) {
    const appeal = /^overlay\.weights\.([a-z]+)$/.exec(path)?.[1];
    const list = /^overlay\.priorityDimensions\.(add|remove)(\.\d+)?$/.exec(path)?.[1];
    const a = APPEAL_IDS.find((id) => id === appeal);
    if (a) fields.push({ field: `weights.${a}`, message });
    else if (list === 'add' || list === 'remove') fields.push({ field: list, message });
    else other.push(message);
  }
  return { fields, other };
}

/** The core dimensions (no group), which are the only ones an overlay may name. */
export function coreDimensions(catalogue: DefaultsCatalogue): Array<{ id: string; name: string }> {
  return catalogue.result.dimensions
    .filter((d) => d.group === null)
    .map(({ id, name }) => ({ id, name }));
}

/** The appeals a version lets a project move, with how far, in points. */
export function movableAppeals(
  catalogue: DefaultsCatalogue,
  adjustment: Adjustment
): Array<{ id: AppealId; name: string; most: number }> {
  return APPEAL_IDS.filter((a) => adjustment.weights[a] > 0).map((a) => ({
    id: a,
    name: catalogue.result.appeals.find((x) => x.id === a)?.name ?? a,
    most: shownPoints(adjustment.weights[a]),
  }));
}

/** The stored adjustment in words, one phrase per change ("Ethos +10 points"). */
export function describeOverlay(values: WeightsFormValues, catalogue: DefaultsCatalogue): string[] {
  const name = (id: string) => catalogue.result.dimensions.find((d) => d.id === id)?.name ?? id;
  const out: string[] = [];
  for (const a of APPEAL_IDS) {
    const p = values.weights[a];
    if (p === 0) continue;
    const appeal = catalogue.result.appeals.find((x) => x.id === a)?.name ?? a;
    out.push(`${appeal} ${p > 0 ? '+' : '−'}${Math.abs(p)} point${Math.abs(p) === 1 ? '' : 's'}`);
  }
  for (const id of values.add) out.push(`${name(id)} made a priority`);
  for (const id of values.remove) out.push(`${name(id)} no longer a priority`);
  return out;
}
