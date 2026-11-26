/**
 * What each HowDoesThisLand MCP tool publishes (t-92, t-93, t-94): its name, what an
 * assistant reads about it, and the JSON Schema of its arguments.
 *
 * One copy, read by two things: the capability classes in `lib/app/mcp/`
 * and the seed that writes their `AiCapability` rows
 * (`prisma/seeds/app-howdoesthisland/003-mcp-tools.ts`). A definition the
 * row and the class disagree on is a tool that strips the argument it does
 * not know, silently (`sunrise.mcp-reseed`); importing the same object
 * leaves nothing to disagree on, and the parity test
 * (`capability-class-seed-parity.test.ts`) still checks it.
 *
 * Deliberately dependency-free: the seed runner imports it, so it must not
 * pull in the database client, the logger or the environment.
 *
 * Each schema here mirrors a Zod schema in its class, which is what the
 * dispatcher validates with. `tests/unit/lib/app/mcp/definitions.test.ts`
 * holds the two together.
 */
import type { CapabilityFunctionDefinition } from '@/lib/orchestration/capabilities/types';

/** As `MAX_CONTENT_CHARS * 2` in `lib/app/assessments/limits.ts`: the API's bound on pasted text. */
export const MCP_TEXT_MAX = 80_000;
/** As `MAX_URL_CHARS`. */
export const MCP_URL_MAX = 2048;
/** As `MIN_DRAFTS` and `MAX_DRAFTS` in `lib/app/comparisons/limits.ts`. */
export const MCP_MIN_DRAFTS = 2;
export const MCP_MAX_DRAFTS = 5;
/** As `DRAFT_LABEL_MAX`. */
export const MCP_LABEL_MAX = 80;
/** As `MAX_ANSWER_CHARS` and `MAX_PLACEHOLDERS` in `lib/app/rewrites/validations.ts` and `lib/app/frameworks/placeholders.ts`. */
export const MCP_ANSWER_MAX = 500;
/** As the key bound in `answersSchema`: a placeholder id (`p1`, …). */
export const MCP_ANSWER_KEY_MAX = 16;
export const MCP_MAX_ANSWERS = 30;

const textProperty = {
  type: 'string',
  description:
    'The draft itself, pasted as plain text. Up to about 40,000 characters are assessed; anything beyond is refused.',
  maxLength: MCP_TEXT_MAX,
};

const contextProperty = {
  type: 'object',
  description:
    'Optional: what kind of copy the draft is and who it is for, as the framework reads it, for example {"contentType": "landing_page"} (others include "sales_email", "pitch_deck", "cover_letter" and "general", the default). Leave it out to use the defaults; a value the framework does not know is refused, saying which field.',
};

export const QUICK_SCAN: CapabilityFunctionDefinition = {
  name: 'quick_scan',
  description:
    'Score a draft at once, without AI: a surface check of word patterns (hype words, vague claims, missing numbers, long sentences) giving an overall score, a band and a score for each of the four appeals. It costs nothing and stores nothing. It cannot tell whether the argument holds up or how a reader will take it; for that, use assess_draft.',
  parameters: {
    type: 'object',
    properties: { text: textProperty, context: contextProperty },
    required: ['text'],
    additionalProperties: false,
  },
};

export const ASSESS_DRAFT: CapabilityFunctionDefinition = {
  name: 'assess_draft',
  description:
    "Have a panel of AI reviewers assess a draft and say what to change: an overall score and band, the editor's verdict, the changes that matter most, and recommendations quoting the draft. Spends one of the workspace's review credits. Give the draft as text, or as a public web page's url. A review usually takes a minute or two: if it is not finished within about 45 seconds this answers with the assessment's id and status, and get_assessment reads it once it has finished.",
  parameters: {
    type: 'object',
    properties: {
      text: textProperty,
      url: {
        type: 'string',
        description: 'Instead of text: a public http(s) page to read the draft from.',
        maxLength: MCP_URL_MAX,
      },
      title: {
        type: 'string',
        description: 'Optional: a name for the review, shown in the workspace. Not blank.',
        minLength: 1,
        pattern: '\\S',
        maxLength: 200,
      },
      projectId: {
        type: 'string',
        description:
          "Optional: the workspace project to review it in. The reviewers then read the project's brief and context documents.",
        minLength: 1,
        maxLength: 64,
      },
      context: contextProperty,
    },
    additionalProperties: false,
  },
};

export const GET_ASSESSMENT: CapabilityFunctionDefinition = {
  name: 'get_assessment',
  description:
    "Read one of the workspace's assessments by its id: its status and, once finished, the overall score and band, the editor's verdict, the changes that matter most, what already works, the score for each appeal, the recommendations and any red flags. A recommendation marked example: true shows the move on the model's own illustration, not on a line of this draft. While it is still running, it says so and gives the quick scan's early read.",
  parameters: {
    type: 'object',
    properties: {
      assessmentId: {
        type: 'string',
        description: 'The id assess_draft answered with.',
        minLength: 1,
        maxLength: 64,
      },
    },
    required: ['assessmentId'],
    additionalProperties: false,
  },
};

export const COMPARE_DRAFTS: CapabilityFunctionDefinition = {
  name: 'compare_drafts',
  description:
    "Have the panel of AI reviewers review two to five drafts the same way and say which lands better: each draft's overall score and band, which draft leads on each appeal, and the editor's verdict on which draft lands better and why. Spends a review credit for each draft given as text, and the cost of the editor's verdict. A draft may instead be the assessmentId of an earlier review (from assess_draft) that has finished and was reviewed the same way: it joins as it is and is not charged again. At least one draft is text. A comparison usually takes a few minutes: if it is not finished within about 45 seconds this answers with the comparison's id and status, and get_comparison reads it once it has finished.",
  parameters: {
    type: 'object',
    properties: {
      drafts: {
        type: 'array',
        description:
          'The drafts, in the order to show them; answers name each by its position, counting from 0. Each is {"text": ..., "label": ...} or {"assessmentId": ..., "label": ...}; the label (optional) is what the verdict and the scores call it, for example "Opening A".',
        minItems: MCP_MIN_DRAFTS,
        maxItems: MCP_MAX_DRAFTS,
        items: {
          type: 'object',
          properties: {
            text: textProperty,
            assessmentId: {
              type: 'string',
              description: 'Instead of text: the id of a finished review in this workspace.',
              minLength: 1,
              maxLength: 64,
            },
            label: {
              type: 'string',
              description: 'Optional: a short name for the draft. Not blank.',
              minLength: 1,
              pattern: '\\S',
              maxLength: MCP_LABEL_MAX,
            },
          },
          additionalProperties: false,
        },
      },
      projectId: {
        type: 'string',
        description:
          "Optional: the workspace project to review every draft in. The reviewers then read the project's brief and context documents.",
        minLength: 1,
        maxLength: 64,
      },
      context: contextProperty,
    },
    required: ['drafts'],
    additionalProperties: false,
  },
};

export const GET_COMPARISON: CapabilityFunctionDefinition = {
  name: 'get_comparison',
  description:
    "Read one of the workspace's comparisons by its id: its status, each draft's overall score and band, which draft leads on each appeal and by how much, and, once every draft's review has ended, the editor's verdict on which draft lands better, why, and the appeals that decide it. Drafts are named by position, counting from 0 in the order they were sent, and the verdict's draft is one of those positions. Each draft carries its review's assessmentId, which get_assessment reads for that draft's own recommendations.",
  parameters: {
    type: 'object',
    properties: {
      comparisonId: {
        type: 'string',
        description: 'The id compare_drafts answered with.',
        minLength: 1,
        maxLength: 64,
      },
    },
    required: ['comparisonId'],
    additionalProperties: false,
  },
};

export const REWRITE_DRAFT: CapabilityFunctionDefinition = {
  name: 'rewrite_draft',
  description:
    "Have the editor rewrite a reviewed draft, making the changes its review asked for: answers the new draft and its placeholders. Give the assessmentId of a finished review (from assess_draft). Where the draft needs a fact only the writer knows (a figure, a name, a date), the editor leaves a placeholder such as [ADD: the number of customers], listed with an id (p1, p2, ...). To fill them, ask the writer, then call this again with fromRewriteId (this rewrite's id) and answers keyed by placeholder id: the editor fills those into the same draft and changes nothing else. Spends the workspace's credits for the editor's call. A rewrite usually takes a minute or two: if it is not finished within about 45 seconds this answers with the rewrite's id and status, and get_rewrite reads it once it has finished.",
  parameters: {
    type: 'object',
    properties: {
      assessmentId: {
        type: 'string',
        description: 'The id of the finished review to rewrite from (assess_draft answers it).',
        minLength: 1,
        maxLength: 64,
      },
      focus: {
        type: 'string',
        description:
          'Optional: "balanced" (the default) to make the changes that matter most, or one appeal to raise ("ethos", "pathos", "logos" or "kairos"). With fromRewriteId, leave it out: a fill keeps its rewrite\'s focus.',
        minLength: 1,
        maxLength: 32,
      },
      fromRewriteId: {
        type: 'string',
        description:
          'To fill placeholders: the id of a finished rewrite of the same review. Send answers with it.',
        minLength: 1,
        maxLength: 64,
      },
      answers: {
        type: 'object',
        description:
          'With fromRewriteId: the writer\'s answers, keyed by placeholder id, for example {"p1": "1,200 customers"}. Placeholders left out stay in the draft. Never invent an answer: ask the writer.',
        propertyNames: { type: 'string', minLength: 1, maxLength: MCP_ANSWER_KEY_MAX },
        additionalProperties: { type: 'string', minLength: 1, maxLength: MCP_ANSWER_MAX },
        minProperties: 1,
        maxProperties: MCP_MAX_ANSWERS,
      },
    },
    required: ['assessmentId'],
    additionalProperties: false,
  },
};

export const GET_REWRITE: CapabilityFunctionDefinition = {
  name: 'get_rewrite',
  description:
    "Read one of the workspace's rewrites by its id: its status and, once completed, the new draft and its placeholders (each with the id an answer is keyed to and what the writer is asked for). A failed rewrite says why. While it is still running, it says so.",
  parameters: {
    type: 'object',
    properties: {
      rewriteId: {
        type: 'string',
        description: 'The id rewrite_draft answered with.',
        minLength: 1,
        maxLength: 64,
      },
    },
    required: ['rewriteId'],
    additionalProperties: false,
  },
};

/**
 * Each tool's row, as the seed writes it. `name` and `description` are the
 * admin's presentation, seeded once; `rateLimit` is per minute, per agent
 * (`mcp-system` for every unscoped key), so every unscoped key shares one
 * bucket per tool. Only the spending tools add a per-person cap of their own,
 * as the API does: `assess_draft` and `compare_drafts` the reviews'
 * (`aiAssessmentLimiter`, each draft reviewed counting as one), and
 * `rewrite_draft` the rewrites' (`rewriteLimiter`). The proxy's `mcp` tier
 * still caps each key.
 */
export const MCP_TOOL_ROWS = [
  {
    definition: QUICK_SCAN,
    handler: 'QuickScanCapability',
    name: 'Quick scan',
    description: 'Score a draft at once without AI. Free; stores nothing.',
    rateLimit: 120,
  },
  {
    definition: ASSESS_DRAFT,
    handler: 'AssessDraftCapability',
    name: 'Assess a draft',
    description: 'Start a full review by the AI panel. Spends a review credit.',
    rateLimit: 60,
  },
  {
    definition: GET_ASSESSMENT,
    handler: 'GetAssessmentCapability',
    name: 'Read an assessment',
    description: "Read one of the workspace's assessments, as an assistant needs it.",
    rateLimit: 120,
  },
  {
    definition: COMPARE_DRAFTS,
    handler: 'CompareDraftsCapability',
    name: 'Compare drafts',
    description:
      'Review two to five drafts the same way and say which lands better. Spends credits.',
    rateLimit: 30,
  },
  {
    definition: GET_COMPARISON,
    handler: 'GetComparisonCapability',
    name: 'Read a comparison',
    description:
      "Read one of the workspace's comparisons and its verdict, as an assistant needs it.",
    rateLimit: 120,
  },
  {
    definition: REWRITE_DRAFT,
    handler: 'RewriteDraftCapability',
    name: 'Rewrite a draft',
    description:
      'Have the editor rewrite a reviewed draft, or fill its placeholders. Spends credits.',
    rateLimit: 30,
  },
  {
    definition: GET_REWRITE,
    handler: 'GetRewriteCapability',
    name: 'Read a rewrite',
    description: "Read one of the workspace's rewrites and its placeholders.",
    rateLimit: 120,
  },
] as const;
