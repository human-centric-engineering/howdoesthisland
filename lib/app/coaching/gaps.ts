/**
 * A review's gaps, as questions for the writer (t-108, `.context/app/coaching.md`).
 *
 * A review says what is missing: proof from someone like the reader, a cost
 * in the reader's terms, a reason to act now. Only the writer knows those
 * facts. {@link buildGaps} turns a finished review into an ordered list of
 * them, each with a plain-words question about the writer's situation, for
 * the coaching conversation (t-110) and the worked example (t-112) to start
 * from.
 *
 * **No AI call.** Everything here is computed from what the report already
 * shows the writer (its {@link ReportView}) and the templates below, so the
 * list costs nothing and is the same every time it is read. The coach
 * rewords the questions conversationally; this gives it what to ask and in
 * what order.
 *
 * **Where gaps come from**, strongest first (the order of the list):
 *
 * 1. **The latest rewrite's placeholders** (`[ADD: …]`,
 *    `lib/app/frameworks/placeholders.ts`): the editor has already said it
 *    cannot write on without them.
 * 2. **Recommendations whose suggested rewrite has a slot in brackets**
 *    (`We [result, with a number] for [a named client like her]`), by
 *    impact. A slot is a fact the reviewer could not supply. A
 *    recommendation with no slot is a change the rewrite can make alone
 *    (cut a superlative, shorten a sentence), so it is not a gap.
 * 3. **Notes on weaknesses**, where what the note is about needs a fact.
 * 4. **Appeals that scored low** ({@link LOW_APPEAL_SCORE}) with no gap yet:
 *    one gap each, from the weakest part of that appeal that needs a fact.
 * 5. **Brief fields the project leaves empty** (offer, audience, voice,
 *    markets, goals). Only for a review in a project.
 *
 * Several sources that need the same fact are one gap ({@link TOPICS}): a
 * note and a recommendation on borrowed credibility both ask for a customer
 * like the reader, so the writer is asked once, and the gap lists both.
 *
 * **A gap already answered is dropped.** For now that is the project's
 * brief: a filled field answers its own gap, and the audience answers the
 * question about who the reader is. Saved facts (t-109) will answer more.
 *
 * **The model is IP.** A question is built only from what the report
 * shows, and never names a dimension, move, lever or any other id of the
 * model, nor its rubric, weights or reviewers. Text taken from the review
 * (a recommendation's issue, a placeholder's label) is checked against the
 * model's own ids ({@link modelVocabulary}) and against
 * {@link MODEL_TERMS}. One that carries any is not used: the template's own
 * words stand in, or the gap is left out.
 */
import type { ReportModel } from '@/lib/app/reports/input';
import type { ReportRecommendationView, ReportView } from '@/lib/app/reports/view';
import { parsePlaceholders } from '@/lib/app/frameworks/placeholders';
import type { Brief } from '@/lib/app/projects/validations';

/** An appeal scoring below this (0–100) is low: under the model's "Developing" band. */
export const LOW_APPEAL_SCORE = 40;

/** The most gaps one review offers. The coach's turn cap bounds what it can ask anyway. */
export const MAX_GAPS = 15;

/** Words about how the model works, which no question may use. */
export const MODEL_TERMS = [
  'rubric',
  'weight',
  'weights',
  'weighting',
  'formula',
  'dimension',
  'dimensions',
  'lever',
  'levers',
  'judge',
  'judges',
] as const;

/** Where a gap came from: what the report shows, by its own numbering. */
export type GapSource =
  | { kind: 'placeholder'; placeholderId: string }
  | { kind: 'recommendation'; number: number }
  | { kind: 'note'; number: number }
  | { kind: 'appeal' }
  | { kind: 'brief'; field: BriefField };

export interface Gap {
  /** Stable for the same review: what an answer is keyed to. */
  id: string;
  /** What is missing, in a few words. */
  missing: string;
  /** What to ask the writer, about their situation. */
  question: string;
  /** Why it matters, in a sentence. */
  why: string;
  /**
   * What the review said about it, in its own words (a recommendation's
   * issue, a note), for the coach to quote: strongest first, each once.
   * Empty when it said nothing a gap may carry.
   */
  found: string[];
  /** Every place in the review that asks for it, strongest first. */
  sources: GapSource[];
}

/** What is already known about the writer's situation. */
export interface Known {
  /** The project's brief as it is now, or `null` for a review in no project. */
  brief: Brief | null;
}

export interface GapsInput {
  view: ReportView;
  /** The latest finished rewrite's draft, or `null` for none. */
  rewriteDraft: string | null;
  known: Known;
  /** The model's own ids ({@link modelVocabulary}): never in a gap's text. */
  vocabulary: readonly string[];
}

type BriefField = keyof Brief;

// ─── The templates ──────────────────────────────────────────────────────────

interface Topic {
  missing: string;
  question: string;
  why: string;
  /** The brief field that answers it, when one does. */
  answeredBy?: BriefField;
}

/**
 * The facts a review can find missing, each asked one way. Keyed by our own
 * names, which are the gaps' ids; never by the model's.
 */
export const TOPICS = {
  'customer-proof': {
    missing: 'Proof from a customer like your reader',
    question:
      'Have you solved this for someone like your reader? Who was it, and what changed for them, in hours, money or another number?',
    why: 'Proof from someone like the reader persuades more than anything you say about yourself.',
  },
  'reader-moment': {
    missing: 'Something happening in your reader’s world now',
    question:
      'What is happening for your reader right now that makes this worth reading: news, a change, a new project or a deadline?',
    why: 'A reader decides in the first line whether a message is for them, and a real reason for writing now gives them one.',
  },
  'reader-problem': {
    missing: 'The problem your reader has',
    question:
      'What problem is your reader likely to have right now? Put it in the words they would use.',
    why: 'A reader acts on a problem they recognise as theirs.',
  },
  'concrete-change': {
    missing: 'What would change for your reader',
    question: 'If your reader said yes, what would they actually see change, day to day?',
    why: 'A change the reader can picture is easier to want than a benefit described in general.',
  },
  story: {
    missing: 'A short, true story',
    question:
      'Is there a short, true story you could tell: one person, the problem they had, and what changed for them?',
    why: 'A story carries a point further than the point on its own.',
  },
  'how-it-works': {
    missing: 'How you get the result',
    question: 'How do you get the result? Say it in one plain sentence your reader would follow.',
    why: 'A result is believed when the reader can see how it comes about.',
  },
  comparison: {
    missing: 'What your reader does today',
    question: 'What does your reader do about this today, and how is your way different?',
    why: 'A reader weighs an offer against what they already do.',
  },
  objection: {
    missing: 'Your reader’s likeliest doubt',
    question:
      'What is your reader’s likeliest reason to say no, or not now? And is there anyone you would honestly tell to wait?',
    why: 'Answering a doubt before the reader raises it, and saying when not to buy, makes the rest more believable.',
  },
  'cost-of-waiting': {
    missing: 'What waiting costs your reader',
    question:
      'What does leaving this alone cost your reader, in time or money each week, month or year?',
    why: 'A cost the reader can put a figure on gives them a reason to act now.',
  },
  'small-ask': {
    missing: 'A small first step',
    question:
      'What small, useful thing could you offer as a first step, something your reader could say yes to in a minute?',
    why: 'A small first step is far more likely to be taken than a big one.',
  },
  reader: {
    missing: 'Who your reader is',
    question:
      'Who exactly is your reader: their role, the kind of organisation they are in, and what you have in common with them?',
    why: 'Copy written for one clear reader speaks to them; copy written for everyone speaks to no one.',
    answeredBy: 'audience',
  },
} as const satisfies Record<string, Topic>;

export type TopicId = keyof typeof TOPICS;

const topicOf = (id: TopicId): Topic => TOPICS[id];

/**
 * Which part of the model needs which fact (HowDoesThisLand 0.5.x). A part
 * missing here is a craft change the rewrite can make alone (polish,
 * structure, clarity, surprise), so a note on it is not a gap; a
 * recommendation on it with a slot still is, asked in its own words.
 */
export const TOPIC_OF: Readonly<Record<string, TopicId>> = {
  eth_competence: 'customer-proof',
  eth_borrowed: 'customer-proof',
  eth_goodwill: 'reader-moment',
  eth_integrity: 'objection',
  eth_identification: 'reader',
  pat_stakes: 'reader-problem',
  pat_empathy: 'reader-problem',
  pat_vividness: 'concrete-change',
  pat_story: 'story',
  pat_identity: 'reader',
  log_evidence: 'customer-proof',
  log_mechanism: 'how-it-works',
  log_comparison: 'comparison',
  log_objections: 'objection',
  kai_moment: 'reader-moment',
  kai_integrity: 'reader-moment',
  kai_stakes: 'cost-of-waiting',
  kai_call: 'small-ask',
  kai_efficacy: 'small-ask',
};

/** A brief field left empty, asked as a gap. `audience` is the {@link TOPICS} `reader`. */
const BRIEF_GAPS: Readonly<Record<Exclude<BriefField, 'audience'>, Topic>> = {
  offer: {
    missing: 'What you offer',
    question: 'What do you offer: the product, service or idea this copy is for?',
    why: 'Every suggestion is sharper once it is clear what is being offered.',
  },
  voice: {
    missing: 'How you sound',
    question: 'How should you sound? Two or three words for your tone of voice will do.',
    why: 'A rewrite that keeps your voice still sounds like you.',
  },
  markets: {
    missing: 'Where it will be read',
    question: 'Where will this be read: which countries or markets?',
    why: 'What persuades differs from one market to the next.',
  },
  goals: {
    missing: 'What the copy must achieve',
    question: 'What should this copy achieve: what do you want the reader to do after reading it?',
    why: 'Copy aimed at one outcome is easier to measure, and to improve.',
  },
};

const BRIEF_ORDER: readonly BriefField[] = ['offer', 'audience', 'voice', 'markets', 'goals'];

// ─── The model's own words ──────────────────────────────────────────────────

/** Every id the model names things by: what no gap's text may carry. */
export function modelVocabulary(model: ReportModel): string[] {
  const ids = [
    ...model.appeals,
    ...model.dimensions,
    ...model.extra_dimensions,
    ...model.lenses,
    ...model.duties,
    ...model.moves,
    ...model.red_flags,
    ...model.groups,
    ...model.judge_catalogue,
    ...model.judges,
    ...model.perspectives,
    ...model.perspectives.flatMap((p) => p.levers),
  ].map((x) => x.id);
  return [...new Set(ids)];
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether `text` carries any of `words`, as a whole word, ignoring case. */
export function carriesVocabulary(text: string, words: readonly string[]): boolean {
  return words.some((w) =>
    new RegExp(`(^|[^\\p{L}\\p{N}_])${escape(w)}($|[^\\p{L}\\p{N}_])`, 'iu').test(text)
  );
}

// ─── Building the list ──────────────────────────────────────────────────────

/** A slot in a suggested rewrite: `[a named client like her]`. Not `[ADD: …]`, nor a link. */
const SLOT = /\[(?!ADD:)([^[\]\n]+)\](?!\()/gi;

/** The slots in a recommendation's suggested rewrite, each once, in order. */
export function slotsOf(rewrite: string): string[] {
  const seen = new Set<string>();
  const slots: string[] = [];
  for (const m of rewrite.matchAll(SLOT)) {
    const slot = m[1].replace(/\s+/g, ' ').trim();
    const key = slot.toLowerCase();
    if (slot === '' || seen.has(key)) continue;
    seen.add(key);
    slots.push(slot);
  }
  return slots;
}

/** Strength of a source, for the order: lower first. */
const IMPACT_RANK: Readonly<Record<string, number>> = { high: 1, medium: 2, low: 3 };
const NOTE_RANK = 4;
const APPEAL_RANK = 5;
const BRIEF_RANK = 6;

interface Draft extends Gap {
  rank: number;
  /** Ties on rank: the report's own order. */
  order: number;
}

/** The review's gaps, strongest first, those already answered left out. */
export function buildGaps({ view, rewriteDraft, known, vocabulary }: GapsInput): Gap[] {
  const forbidden = [...vocabulary, ...MODEL_TERMS];
  const clean = (text: string): boolean => !carriesVocabulary(text, forbidden);
  const answered = (field: BriefField | undefined): boolean =>
    field !== undefined && (known.brief?.[field] ?? '').trim() !== '';

  const gaps = new Map<string, Draft>();
  const add = (gap: Draft): void => {
    const held = gaps.get(gap.id);
    if (!held) {
      gaps.set(gap.id, gap);
      return;
    }
    held.sources.push(...gap.sources);
    for (const f of gap.found) if (!held.found.includes(f)) held.found.push(f);
    if (gap.rank < held.rank || (gap.rank === held.rank && gap.order < held.order)) {
      held.rank = gap.rank;
      held.order = gap.order;
    }
  };
  const fromTopic = (
    id: TopicId,
    source: GapSource,
    rank: number,
    order: number,
    found?: string
  ): void => {
    const topic = topicOf(id);
    if (answered(topic.answeredBy)) return;
    add({
      id,
      missing: topic.missing,
      question: topic.question,
      why: topic.why,
      found: found !== undefined && found.trim() !== '' && clean(found) ? [found] : [],
      sources: [source],
      rank,
      order,
    });
  };

  // 1. The latest rewrite's placeholders. A label carrying the model's words
  // cannot be asked about in its own words, and has no other, so it is left.
  for (const [i, p] of parsePlaceholders(rewriteDraft ?? '').entries()) {
    if (!clean(p.label)) continue;
    add({
      id: `placeholder-${p.id}`,
      missing: p.label,
      question: `Your rewrite has a gap for ${p.label}. What should go there?`,
      why: 'Only you know this, so the rewrite left it for you to fill.',
      found: [],
      sources: [{ kind: 'placeholder', placeholderId: p.id }],
      rank: 0,
      order: i,
    });
  }

  // 2. Recommendations with a slot, by impact then number.
  for (const r of view.recommendations) {
    const slots = slotsOf(r.rewrite);
    if (slots.length === 0) continue;
    const rank = IMPACT_RANK[r.impact] ?? IMPACT_RANK.low;
    const source: GapSource = { kind: 'recommendation', number: r.number };
    const topic = TOPIC_OF[r.dimensionId];
    if (topic) fromTopic(topic, source, rank, r.number, r.issue);
    else addOwnWords(r, slots, rank, source, clean, add);
  }

  // 3. Notes on weaknesses, where the weakness needs a fact.
  for (const n of view.copy.notes) {
    if (n.polarity !== 'weakness') continue;
    const topic = TOPIC_OF[n.dimensionId];
    if (topic) fromTopic(topic, { kind: 'note', number: n.number }, NOTE_RANK, n.number, n.note);
  }

  // 4. Low appeals with no gap yet: one each, from their weakest part that needs a fact.
  const covered = new Set(gaps.keys());
  for (const [i, appeal] of view.lands.appeals.entries()) {
    if (appeal.score >= LOW_APPEAL_SCORE) continue;
    const rows = view.dimensions.find((g) => g.id === appeal.id)?.rows ?? [];
    const topics = rows.flatMap((row) => {
      const topic = TOPIC_OF[row.id];
      return topic ? [{ topic, score: row.score }] : [];
    });
    if (topics.some((t) => covered.has(t.topic))) continue;
    const weakest = topics
      .filter((t) => !answered(topicOf(t.topic).answeredBy))
      .reduce<(typeof topics)[number] | null>(
        (low, t) => (low && low.score <= t.score ? low : t),
        null
      );
    if (weakest) fromTopic(weakest.topic, { kind: 'appeal' }, APPEAL_RANK, i);
  }

  // 5. The brief's empty fields, for a review in a project.
  if (known.brief) {
    for (const [i, field] of BRIEF_ORDER.entries()) {
      if (answered(field)) continue;
      const source: GapSource = { kind: 'brief', field };
      if (field === 'audience') {
        fromTopic('reader', source, BRIEF_RANK, i);
        continue;
      }
      const topic = BRIEF_GAPS[field];
      add({
        id: `brief-${field}`,
        missing: topic.missing,
        question: topic.question,
        why: topic.why,
        found: [],
        sources: [source],
        rank: BRIEF_RANK,
        order: i,
      });
    }
  }

  return [...gaps.values()]
    .sort((a, b) => a.rank - b.rank || a.order - b.order || a.id.localeCompare(b.id))
    .slice(0, MAX_GAPS)
    .map(({ id, missing, question, why, found, sources }) => ({
      id,
      missing,
      question,
      why,
      found,
      sources,
    }));
}

/**
 * A recommendation with slots on a part of the model with no template: asked
 * in the review's own words, the suggestion with its brackets to fill. Left
 * out when those words carry the model's.
 */
function addOwnWords(
  r: ReportRecommendationView,
  slots: string[],
  rank: number,
  source: GapSource,
  clean: (text: string) => boolean,
  add: (gap: Draft) => void
): void {
  if (!clean(r.rewrite) || !clean(r.issue)) return;
  add({
    id: `recommendation-${r.number}`,
    missing: slots.join('; '),
    question: `The review suggests: “${r.rewrite}” What would you put in the brackets?`,
    why: 'Only you know what goes there, so the review could not suggest it.',
    found: [r.issue],
    sources: [source],
    rank,
    order: r.number,
  });
}
