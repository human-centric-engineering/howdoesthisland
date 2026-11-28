/**
 * What the `batches` routes accept (t-101, `.context/app/batches.md`).
 *
 * The route registry (`lib/app/api/registry.ts`) imports these, so the
 * contract is the schema the handler parses with. The review options are a
 * comparison's, given once for every item; `context` is checked against the
 * version once it is known.
 *
 * An item is pasted text, a page's address, or a file uploaded first
 * (t-102, `POST /api/v1/contents`) and named by its id. A page is not
 * fetched here, or anywhere in the request: its own review fetches it when it
 * starts (`lib/app/assessments/run.ts`), so a batch of addresses answers at
 * once and one slow site holds up only its own item. A file's text was read
 * when it was uploaded (`lib/app/batches/uploads.ts`).
 */
import { z } from 'zod';
import {
  contextField,
  textField,
  urlField,
  versionChoice,
} from '@/lib/app/assessments/api/validations';
import { BATCH_MAX_ITEMS_CEILING, ITEM_LABEL_MAX, batchMaxItems } from '@/lib/app/batches/limits';

const labelField = z.string().trim().min(1).max(ITEM_LABEL_MAX).optional();

const textItemSchema = z.strictObject({
  /** Pasted copy; checked against the length limit with its own message (`assessableText`). */
  text: textField,
  label: labelField,
});

const pageItemSchema = z.strictObject({
  /** A page, fetched when its review starts; one that cannot be read fails that item alone. */
  url: urlField,
  label: labelField,
});

const uploadItemSchema = z.strictObject({
  /** An upload's id, as `POST /api/v1/contents` answered it; one review takes it. */
  contentId: z.string().trim().min(1).max(64),
  label: labelField,
});

/** One item: pasted text, a page by its address, or an upload by its id. */
export const batchItemSchema = z.union([textItemSchema, pageItemSchema, uploadItemSchema], {
  error: 'Give each item as one of { text }, { url } or { contentId }',
});

export type BatchItemInput = z.infer<typeof batchItemSchema>;

/** An item given as text; otherwise a page. */
export const isTextItem = (item: BatchItemInput): item is z.infer<typeof textItemSchema> =>
  'text' in item;

/** An item naming an upload by its id. */
export const isUploadItem = (item: BatchItemInput): item is z.infer<typeof uploadItemSchema> =>
  'contentId' in item;

/**
 * 1 to `APP_BATCH_MAX_ITEMS` items. The ceiling is the schema's own, so the
 * contract states it; the setting is read as each request is parsed.
 */
export const batchItemsField = z
  .array(batchItemSchema)
  .min(1, 'Give at least one item')
  .max(BATCH_MAX_ITEMS_CEILING, `Give at most ${BATCH_MAX_ITEMS_CEILING} items`)
  .superRefine((items, ctx) => {
    const max = batchMaxItems();
    if (items.length > max) {
      ctx.addIssue({
        code: 'too_big',
        origin: 'array',
        maximum: max,
        inclusive: true,
        input: items,
        message: `Give at most ${max} items: a batch here takes up to ${max}`,
      });
    }
    // One review takes an upload, so naming one twice could only be refused later.
    const seen = new Set<string>();
    for (const [position, item] of items.entries()) {
      if (!isUploadItem(item)) continue;
      if (seen.has(item.contentId)) {
        ctx.addIssue({
          code: 'custom',
          path: [position, 'contentId'],
          message: 'Name each upload once: one review takes it',
        });
      }
      seen.add(item.contentId);
    }
  })
  .meta({
    description: `1 to \`APP_BATCH_MAX_ITEMS\` items (at most ${BATCH_MAX_ITEMS_CEILING}; 10 unless the install sets it).`,
  });

/**
 * `POST /api/v1/contents` (t-102): the `options` part beside the file, which
 * takes nothing. The upload has no options of its own: its project and
 * label are the batch's and the item's, given when a batch takes it.
 */
export const contentUploadOptionsSchema = z.strictObject({});

/** POST /api/v1/batches. */
export const createBatchSchema = z
  .strictObject({
    items: batchItemsField,
    ...versionChoice,
    context: contextField,
    /** The workspace's project every item is reviewed in; its defaults fill what is left out. */
    projectId: z.string().min(1).max(64).optional(),
    /** `quick`, `full` (the default) or one of the version's catalogue groups. */
    profile: z.string().trim().min(1).max(64).optional(),
    /** An explicit list of judge slots, in place of a profile. */
    judges: z.array(z.string().trim().min(1).max(64)).min(1).max(32).optional(),
  })
  .refine((body) => !(body.profile !== undefined && body.judges !== undefined), {
    error: 'Give a profile or a list of judges, not both',
    path: ['judges'],
  });

export type CreateBatchBody = z.infer<typeof createBatchSchema>;

/** GET /api/v1/batches. */
export const listBatchesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  /** Only the batches in this project. */
  projectId: z.string().min(1).max(64).optional(),
});

/** `{id}` in `/api/v1/batches/{id}`. */
export const batchIdParamSchema = z.object({ id: z.string().min(1).max(64) });
