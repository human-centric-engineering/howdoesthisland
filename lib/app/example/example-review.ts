/**
 * The worked example on `/example-review` (t-69): one cold sales email taken
 * through a review, draft to final, as the app shows it.
 *
 * Validated by the model without calling an AI provider. The quick scan is
 * the engine's own, run on each draft. The AI reviewers' replies below were
 * written by hand from the model (its dimensions, moves and red flags), in
 * the shape a reviewer returns, and each one passes the engine's own reply
 * validation with nothing dropped or missing. The engine assembles them into
 * the result the report renders, and checks the editor's summaries against
 * it. So every score on the page is the engine's arithmetic, and every note
 * is one a reviewer could have written. A test re-runs all of it against the
 * newest model in the repo.
 *
 * The sender, client and numbers are invented for the example.
 */
import { z } from 'zod';
import type { FrameworkDefinition, JsonObject } from '@/lib/app/frameworks/types';

/** Who the email is for: a cold reader, as the context of a review says it. */
export const EXAMPLE_CONTEXT = {
  contentType: 'sales_email',
  audience: { relationship: 'cold', awareness: 'problem_aware' },
} as const;

/** The reviewers the example runs: the appeals panel, always on. */
export const EXAMPLE_PROFILE = 'core';

export const EXAMPLE_TITLE = 'Cold email to a new prospect';

export const DRAFT = `Hi Sarah,

My name is Tom and I am the Business Development Manager at BrightPath Consulting. We are a leading provider of digital transformation solutions. Our innovative approach delivers outstanding results for our clients.

We work with companies of all sizes across many industries, helping them streamline processes, leverage cutting-edge technology and unlock their full potential.

I would love to set up a 45-minute call to walk you through our capabilities. Please let me know when you are free.

Best regards,
Tom`;

export const FINAL = `Hi Sarah,

Congratulations on opening the Leeds warehouse. A second site often means hours each week spent reconciling stock between two systems.

We fixed exactly that for Harlow & Finch last year. They now see both warehouses in one stock view, and reconciliation fell from nine hours a week to under two. We connected the systems they already had, so nothing was replaced.

If you are already midway through a new ERP rollout, this is not the moment, and I would wait.

Otherwise, can I send you the two-page summary of what we changed at Harlow & Finch? It would be useful before you plan the next quarter.

Best,
Tom Reid
BrightPath Consulting`;

type Reply = JsonObject;

/** The AI reviewers' replies to the first draft, by slot. */
const DRAFT_REPLIES: Readonly<Record<string, Reply>> = {
  judge_ethos: {
    appeal: 'ethos',
    summary:
      'The email asks Sarah to trust a job title and two superlatives. Nothing in it shows Tom understands her business or has done this before.',
    dimension_scores: [
      {
        id: 'eth_competence',
        score: 1,
        rationale: 'A job title stands in for evidence; no result or judgement is shown.',
      },
      {
        id: 'eth_integrity',
        score: 1,
        rationale: '“Leading provider” and “outstanding results” are claimed, not shown.',
      },
      {
        id: 'eth_goodwill',
        score: 1,
        rationale: 'It opens with the sender; Sarah’s world never appears.',
      },
      {
        id: 'eth_borrowed',
        score: 0,
        rationale: 'No client, result or reference vouches for the claims.',
      },
      {
        id: 'eth_identification',
        score: 1,
        rationale: 'Nothing signals shared ground with a retailer.',
      },
      { id: 'eth_polish', score: 3, rationale: 'Clean and consistent, if formal.' },
    ],
    highlights: [
      {
        quote: 'My name is Tom and I am the Business Development Manager at BrightPath Consulting.',
        dimension: 'eth_goodwill',
        polarity: 'weakness',
        note: 'The first line is about the sender. A cold reader decides in this sentence whether the email is for her.',
      },
      {
        quote: 'We are a leading provider of digital transformation solutions.',
        dimension: 'eth_integrity',
        polarity: 'weakness',
        note: 'A self-awarded superlative with nothing behind it. A sceptical reader discounts it, and what follows.',
      },
      {
        quote: 'Our innovative approach delivers outstanding results for our clients.',
        dimension: 'eth_borrowed',
        polarity: 'weakness',
        note: 'Which clients, and what results? One named result would do more than both adjectives.',
      },
    ],
    recommendations: [
      {
        dimension: 'eth_goodwill',
        move: 'mv_flip_we_to_you',
        issue: 'The email opens with Tom, not with Sarah.',
        original:
          'My name is Tom and I am the Business Development Manager at BrightPath Consulting.',
        rewrite: 'Congratulations on [something real and recent at her company].',
        impact: 'high',
      },
      {
        dimension: 'eth_borrowed',
        move: 'mv_specific_testimonial',
        issue: 'The results are claimed, not shown.',
        original: 'Our innovative approach delivers outstanding results for our clients.',
        rewrite: 'We [result, with a number] for [a named client like her] last year.',
        impact: 'high',
      },
    ],
    red_flags: [
      {
        id: 'rf_hype',
        quote: 'a leading provider',
        note: 'A superlative the sender awards himself.',
      },
    ],
  },
  judge_pathos: {
    appeal: 'pathos',
    summary:
      'There is no problem here Sarah would recognise as hers, and nothing she can picture. The middle paragraph is abstract enough to say nothing.',
    dimension_scores: [
      {
        id: 'pat_stakes',
        score: 0,
        rationale: 'No problem of hers is named, and no outcome she wants.',
      },
      {
        id: 'pat_vividness',
        score: 0,
        rationale: 'Abstract throughout; nothing a reader can picture.',
      },
      { id: 'pat_story', score: 0, rationale: 'No story, even a short one.' },
      {
        id: 'pat_identity',
        score: 1,
        rationale: '“Companies of all sizes” includes everyone, so speaks to no one.',
      },
      { id: 'pat_empathy', score: 0, rationale: 'Shows no sense of what her week is like.' },
      { id: 'pat_surprise', score: 0, rationale: 'Every line is predictable for a cold email.' },
    ],
    highlights: [
      {
        quote:
          'helping them streamline processes, leverage cutting-edge technology and unlock their full potential.',
        dimension: 'pat_vividness',
        polarity: 'weakness',
        note: 'Three abstractions in a row. She can’t tell what would actually change for her.',
      },
    ],
    recommendations: [
      {
        dimension: 'pat_stakes',
        move: 'mv_name_struggling_moment',
        issue: 'Her problem is never named.',
        original: '',
        rewrite: '[The specific problem her new situation brings], in the words she would use.',
        impact: 'high',
      },
      {
        dimension: 'pat_vividness',
        move: 'mv_abstract_to_concrete',
        issue: 'The benefit is abstract.',
        original: 'leverage cutting-edge technology and unlock their full potential',
        rewrite: '[one concrete change she would see, such as one stock view across both sites]',
        impact: 'medium',
      },
    ],
    red_flags: [],
  },
  judge_logos: {
    appeal: 'logos',
    summary:
      'The argument is all claim and no evidence: no number, no example and no account of how the results come about. It is short and clear, at least.',
    dimension_scores: [
      { id: 'log_evidence', score: 0, rationale: 'Not one specific, checkable claim.' },
      { id: 'log_mechanism', score: 0, rationale: 'Never says how the results are achieved.' },
      {
        id: 'log_structure',
        score: 2,
        rationale: 'A recognisable order, but the point comes late.',
      },
      { id: 'log_comparison', score: 0, rationale: 'No contrast with what she does today.' },
      { id: 'log_objections', score: 0, rationale: 'Her obvious doubts go unanswered.' },
      { id: 'log_clarity', score: 2, rationale: 'Short sentences, but jargon blurs the meaning.' },
    ],
    highlights: [
      {
        quote: 'We work with companies of all sizes across many industries',
        dimension: 'log_evidence',
        polarity: 'weakness',
        note: 'Broad enough to be true of anyone, so it proves nothing.',
      },
    ],
    recommendations: [
      {
        dimension: 'log_evidence',
        move: 'mv_quantify_claim',
        issue: '“Outstanding results” has no number behind it.',
        original: 'delivers outstanding results',
        rewrite: 'cut [a measure she cares about] from [before] to [after]',
        impact: 'high',
      },
      {
        dimension: 'log_mechanism',
        move: 'mv_name_mechanism',
        issue: 'Nothing says how the result is achieved.',
        original: '',
        rewrite: 'We did it by [how, in one plain sentence].',
        impact: 'medium',
      },
    ],
    red_flags: [
      {
        id: 'rf_buzzword_cluster',
        quote: 'leverage cutting-edge technology and unlock their full potential',
        note: 'Buzzwords stacked until the offer disappears.',
      },
    ],
  },
  judge_kairos: {
    appeal: 'kairos',
    summary:
      'There is no reason to reply now, and the ask is large for a stranger: forty-five minutes on the strength of one email.',
    dimension_scores: [
      {
        id: 'kai_moment',
        score: 0,
        rationale: 'Nothing ties it to anything happening in her world.',
      },
      { id: 'kai_stakes', score: 0, rationale: 'No sense of what waiting costs her.' },
      { id: 'kai_efficacy', score: 1, rationale: 'The next step is clear but heavy.' },
      { id: 'kai_integrity', score: 2, rationale: 'No false urgency, but no real urgency either.' },
      {
        id: 'kai_call',
        score: 1,
        rationale: 'One ask, far bigger than the trust the email has built.',
      },
    ],
    highlights: [
      {
        quote: 'I would love to set up a 45-minute call to walk you through our capabilities.',
        dimension: 'kai_call',
        polarity: 'weakness',
        note: 'Forty-five minutes about “our capabilities” is a big ask from a stranger, and it is about him.',
      },
    ],
    recommendations: [
      {
        dimension: 'kai_call',
        move: 'mv_make_it_easy',
        issue: 'The ask is too big for a first email.',
        original: 'I would love to set up a 45-minute call to walk you through our capabilities.',
        rewrite: 'Can I send you [one short, useful thing she can read in five minutes]?',
        impact: 'high',
      },
      {
        dimension: 'kai_moment',
        move: 'mv_why_now_hook',
        issue: 'Nothing says why now.',
        original: '',
        rewrite: '[A real reason this matters now, from her side.]',
        impact: 'medium',
      },
    ],
    red_flags: [],
  },
};

/** The AI reviewers' replies to the final draft, by slot. */
const FINAL_REPLIES: Readonly<Record<string, Reply>> = {
  judge_ethos: {
    appeal: 'ethos',
    summary:
      'Credibility now comes from a named client and a result Sarah could check, and from an honest word about when not to buy. That is rare in a cold email.',
    dimension_scores: [
      {
        id: 'eth_competence',
        score: 3,
        rationale: 'A specific, relevant result shows Tom has done this before.',
      },
      {
        id: 'eth_integrity',
        score: 4,
        rationale: 'Admits when the offer doesn’t fit, and claims only what it shows.',
      },
      { id: 'eth_goodwill', score: 3, rationale: 'Opens with her news and stays on her problem.' },
      {
        id: 'eth_borrowed',
        score: 3,
        rationale: 'A named client, a like-for-like problem and a number.',
      },
      {
        id: 'eth_identification',
        score: 2,
        rationale: 'Speaks her trade’s language, though not yet as a peer.',
      },
      { id: 'eth_polish', score: 4, rationale: 'Clean, consistent and warm.' },
    ],
    highlights: [
      {
        quote: 'We fixed exactly that for Harlow & Finch last year.',
        dimension: 'eth_borrowed',
        polarity: 'strength',
        note: 'A named client with the same problem: proof she can relate to.',
      },
      {
        quote:
          'If you are already midway through a new ERP rollout, this is not the moment, and I would wait.',
        dimension: 'eth_integrity',
        polarity: 'strength',
        note: 'Saying when not to buy makes everything else more believable.',
      },
    ],
    recommendations: [
      {
        dimension: 'eth_identification',
        move: 'mv_similar_others',
        issue: 'Harlow & Finch could be closer to her world.',
        original: 'We fixed exactly that for Harlow & Finch last year.',
        rewrite: 'We fixed exactly that for Harlow & Finch, [a retailer of her size], last year.',
        impact: 'low',
      },
    ],
    red_flags: [],
  },
  judge_pathos: {
    appeal: 'pathos',
    summary:
      'The email names a problem Sarah will recognise from her own week, and an outcome she can picture. It stays calm, which suits a cold reader.',
    dimension_scores: [
      {
        id: 'pat_stakes',
        score: 3,
        rationale: 'Names her likely problem and the outcome she wants.',
      },
      {
        id: 'pat_vividness',
        score: 3,
        rationale: 'Hours each week, two systems, one stock view: easy to picture.',
      },
      { id: 'pat_story', score: 2, rationale: 'A two-line case story carries the argument.' },
      { id: 'pat_identity', score: 1, rationale: 'Little about who acting would make her.' },
      {
        id: 'pat_empathy',
        score: 2,
        rationale: 'Recognises the cost of her new site without overdoing it.',
      },
      {
        id: 'pat_surprise',
        score: 1,
        rationale: 'Predictable, though the honest exit stands out.',
      },
    ],
    highlights: [
      {
        quote:
          'A second site often means hours each week spent reconciling stock between two systems.',
        dimension: 'pat_stakes',
        polarity: 'strength',
        note: 'Her problem, in her terms, before anything about the sender.',
      },
    ],
    recommendations: [
      {
        dimension: 'pat_story',
        move: 'mv_add_micro_story',
        issue: 'The case could be one beat more human.',
        original: '',
        rewrite:
          '[One line on what changed for the person at Harlow & Finch who did the reconciling.]',
        impact: 'low',
      },
    ],
    red_flags: [],
  },
  judge_logos: {
    appeal: 'logos',
    summary:
      'The case is specific and checkable: a before and after, a mechanism, and her likeliest objection answered before she raises it.',
    dimension_scores: [
      {
        id: 'log_evidence',
        score: 3,
        rationale: 'A specific before and after for a named client.',
      },
      {
        id: 'log_mechanism',
        score: 3,
        rationale: 'Says how: connecting what they had rather than replacing it.',
      },
      {
        id: 'log_structure',
        score: 3,
        rationale: 'Problem, proof, limit, ask: each earns the next.',
      },
      { id: 'log_comparison', score: 2, rationale: 'An implied contrast with replacing systems.' },
      {
        id: 'log_objections',
        score: 3,
        rationale: 'Answers the “not now, we’re mid-rollout” objection.',
      },
      { id: 'log_clarity', score: 3, rationale: 'Plain words and short sentences.' },
    ],
    highlights: [
      {
        quote: 'reconciliation fell from nine hours a week to under two',
        dimension: 'log_evidence',
        polarity: 'strength',
        note: 'A number she can picture in her own week.',
      },
      {
        quote: 'We connected the systems they already had, so nothing was replaced.',
        dimension: 'log_mechanism',
        polarity: 'strength',
        note: 'Says how, and removes the fear of a big replacement project.',
      },
    ],
    recommendations: [],
    red_flags: [],
  },
  judge_kairos: {
    appeal: 'kairos',
    summary:
      'Real timing, her new warehouse and her planning, and a small, useful ask. Urgency is honest and on her side.',
    dimension_scores: [
      {
        id: 'kai_moment',
        score: 3,
        rationale: 'Anchored in something real and recent at her company.',
      },
      { id: 'kai_stakes', score: 2, rationale: 'The cost of waiting is implied, not stated.' },
      { id: 'kai_efficacy', score: 3, rationale: 'A small, easy next step.' },
      { id: 'kai_integrity', score: 4, rationale: 'Even says when to wait.' },
      { id: 'kai_call', score: 3, rationale: 'One low-friction ask, sized to a first contact.' },
    ],
    highlights: [
      {
        quote: 'Congratulations on opening the Leeds warehouse.',
        dimension: 'kai_moment',
        polarity: 'strength',
        note: 'A real reason for writing now, from her side.',
      },
      {
        quote: 'can I send you the two-page summary of what we changed at Harlow & Finch?',
        dimension: 'kai_call',
        polarity: 'strength',
        note: 'Easy to say yes to, and useful even if she never buys.',
      },
    ],
    recommendations: [
      {
        dimension: 'kai_stakes',
        move: 'mv_cost_of_inaction',
        issue: 'What the hours cost is left for her to work out.',
        original: '',
        rewrite: 'At [her team’s hourly cost], that is about [£ a year] spent reconciling.',
        impact: 'low',
      },
    ],
    red_flags: [],
  },
};

/** The editor's summaries: changes name the result's recommendations, `rec_1` first. */
const DRAFT_EDITOR = {
  verdict:
    'Sarah will read this as one of a dozen similar emails this week. It talks about BrightPath, gives her nothing to check, and asks for forty-five minutes before earning one.',
  changes: [
    {
      recommendation: 'rec_1',
      change: 'Open with her news and her problem, not with Tom’s job title.',
      why: 'A cold reader decides in the first line whether an email is for her.',
    },
    {
      recommendation: 'rec_2',
      change: 'Replace the superlatives with one named client and one result.',
      why: 'Specific proof is believed; adjectives are skipped.',
    },
    {
      recommendation: 'rec_7',
      change: 'Shrink the ask to something she can say yes to in a minute.',
      why: 'A small first step is far more likely to be taken than a meeting.',
    },
  ],
  works: ['It is short, and it has one clear ask.'],
};

const FINAL_EDITOR = {
  verdict:
    'This reads as written for Sarah. It names her likely problem, proves it can be solved with a result she can check, is honest about when not to buy, and asks for very little.',
  changes: [
    {
      recommendation: 'rec_3',
      change: 'Say what the hours cost her in money.',
      why: 'A cost she can quote to her finance director gives her a reason to act.',
    },
    {
      recommendation: 'rec_1',
      change: 'Say how Harlow & Finch is like her business.',
      why: 'Proof from someone like the reader persuades most.',
    },
    {
      recommendation: 'rec_2',
      change: 'Add one line on what changed for the person who did the reconciling.',
      why: 'A person in the story makes the result easier to feel.',
    },
  ],
  works: [
    'Opening with her new warehouse.',
    'A named client and a before and after.',
    'Saying when not to buy.',
  ],
};

/** What one draft's review is made from: its text, the reviewers' replies and the editor's. */
export interface ExampleInput {
  text: string;
  replies: Readonly<Record<string, unknown>>;
  editor: unknown;
}

export type ExampleStage = 'draft' | 'final';

export const EXAMPLE_INPUTS: Readonly<Record<ExampleStage, ExampleInput>> = {
  draft: { text: DRAFT, replies: DRAFT_REPLIES, editor: DRAFT_EDITOR },
  final: { text: FINAL, replies: FINAL_REPLIES, editor: FINAL_EDITOR },
};

/** One draft, reviewed: the quick scan's result alone, and the full one with the editor's record. */
export interface ExampleReview {
  text: string;
  quick: unknown;
  full: unknown;
  /** What validation dropped or recorded missing, by slot: empty when the example holds. */
  problems: string[];
  /** The reviewer slots whose replies the engine accepted, in run order. */
  accepted: string[];
}

/**
 * The note an AI reviewer wrote on `quote` in the first draft. The landing
 * page's sample shows these notes, so it reads them from here rather than
 * keeping a second copy that could drift.
 */
export function draftNote(quote: string): string {
  for (const reply of Object.values(DRAFT_REPLIES)) {
    const parsed = highlightsOf.safeParse(reply);
    const found = parsed.success ? parsed.data.highlights.find((h) => h.quote === quote) : null;
    if (found?.note) return found.note;
  }
  throw new Error(`No note on "${quote}" in the example's first draft`);
}

const highlightsOf = z.object({
  highlights: z.array(z.object({ quote: z.string(), note: z.string().optional() })),
});

/**
 * Review both drafts with the engine, as a run would: the quick scan, each
 * reviewer's reply through validation, the result assembled, and the
 * editor's summary checked against it. Pure: give it a materialised model.
 */
export function reviewExample(
  def: FrameworkDefinition,
  model: JsonObject,
  inputs: Readonly<Record<ExampleStage, ExampleInput>> = EXAMPLE_INPUTS
): Record<ExampleStage, ExampleReview> {
  const engine = def.createEngine(model);
  const parsed = engine.parseContext(EXAMPLE_CONTEXT);
  if (!parsed.ok) throw new Error('The example context does not fit this model');
  const slots = engine.activeJudgeSlots(EXAMPLE_PROFILE);

  const review = (stage: ExampleStage): ExampleReview => {
    const { text, replies, editor } = inputs[stage];
    const problems: string[] = [];
    const accepted: string[] = [];
    const quick = engine.quickScan(text, parsed.ctx);
    const outputs: Record<string, unknown> = {};
    for (const slot of slots) {
      const checked = engine.validateJudgeReply(slot, replies[slot], text);
      if (!checked.ok) {
        problems.push(`${stage}.${slot}: ${checked.detail}`);
        continue;
      }
      for (const d of checked.drops) problems.push(`${stage}.${slot}: ${JSON.stringify(d)}`);
      outputs[slot] = checked.output;
      accepted.push(slot);
    }
    const assembled = engine.assemble(text, parsed.ctx, quick, outputs, null);
    const summary = engine.validateEditorReply(editor, assembled);
    if (!summary.ok) problems.push(`${stage}.editor: ${summary.detail}`);
    else for (const d of summary.drops) problems.push(`${stage}.editor: ${JSON.stringify(d)}`);
    const full =
      typeof assembled === 'object' && assembled !== null && summary.ok
        ? {
            ...assembled,
            editor: { status: 'written', summary: summary.output, model: 'example' },
          }
        : assembled;
    return {
      text,
      quick: engine.assemble(text, parsed.ctx, quick, {}, null),
      full,
      problems,
      accepted,
    };
  };

  return { draft: review('draft'), final: review('final') };
}
