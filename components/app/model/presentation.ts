/**
 * The words the model pages put around the model's records (t-63).
 *
 * Every entry here is optional. A section, kind or field a version adds that
 * is not listed gets a name made from its key and is shown in full, so a new
 * version of the model never needs this file changed to be readable. An entry
 * for something a version no longer has is simply never used. Nothing here
 * counts records ("four appeals", "nine reviewers"): counts are read from the
 * version shown, so the copy cannot go stale when the model changes.
 *
 * Words follow app-plan §4, "The words we use": copy, review, AI reviewers,
 * type of copy.
 */

export interface SectionCopy {
  title: string;
  /** One or two sentences: what this part of the model is for. */
  intro?: string;
}

/**
 * The sections shown first on `/model`, in this order. Any other section the
 * version has follows, under "Also in the model", in the model's own order.
 */
export const FEATURED_SECTIONS: readonly string[] = [
  'appeals',
  'dimensions',
  'lenses',
  'moves',
  'red_flags',
  'perspectives',
  'duties',
  'content_types',
  'scoring',
  'research',
  'limitations',
  'culture',
];

export const SECTION_COPY: Readonly<Record<string, SectionCopy>> = {
  appeals: {
    title: 'Appeals',
    intro:
      'The oldest layer of the model: the classical ways a message wins someone over. Each one asks a question the reader asks, usually without noticing.',
  },
  dimensions: {
    title: 'Dimensions',
    intro:
      'What each appeal is made of, one question at a time. Each dimension comes with a rubric, the questions an AI reviewer asks, and the signs it looks for.',
  },
  lenses: {
    title: 'Lenses',
    intro:
      'Ways of reading the whole piece rather than any one line. They are reported beside the appeals, not folded into the overall score.',
  },
  moves: {
    title: 'Moves',
    intro:
      'The changes a review suggests, each with a before and after, and a guardrail that says where the move stops being honest.',
  },
  red_flags: {
    title: 'Red flags',
    intro:
      'Patterns that cost a reader’s trust as soon as they spot them: manufactured urgency, empty superlatives, claims nobody could check.',
  },
  perspectives: {
    title: 'Perspectives and levers',
    intro:
      'Schools of thought on influence, from classical rhetoric to behavioural science and ethics. Each one brings levers: what to look for, the honest use and the misuse.',
  },
  duties: {
    title: 'Rhetorical duties',
    intro: 'What a piece is trying to do for its reader, after the duties Cicero set the orator.',
  },
  content_types: {
    title: 'Types of copy',
    intro:
      'A CV is not a landing page. Each type of copy sets the mix of appeals it needs, the dimensions that matter most and what to watch for.',
  },
  research: {
    title: 'Evidence register',
    intro:
      'The studies the model rests on, what each one found, what it changed in the model, and how strong the evidence is.',
  },
  limitations: {
    title: 'Limitations',
    intro: 'Where the model is weakest, and what it does about each weakness.',
  },
  culture: {
    title: 'Culture',
    intro:
      'How the same copy reads differently across cultures, and the scales a review uses to say so. Approximate by design: culture is not destiny.',
  },
  scoring: {
    title: 'Scoring',
    intro:
      'How a review turns the AI reviewers’ marks into scores: the scale, the weights, the bands, and the caps that keep the best scores for copy that earns them.',
  },
  meta: { title: 'About this version' },
  brand: { title: 'Name and principles' },
  length_targets: { title: 'Length targets' },
  judge_output_schema: { title: 'What an AI reviewer returns' },
  influence_output_schema: { title: 'What the influence panel returns' },
  archetypes: { title: 'Reader archetypes' },
  exec_roles: { title: 'Executive readers' },
  audience_modifiers: { title: 'Reader settings' },
  balance_rules: { title: 'Balance rules' },
  craft_metrics: { title: 'Craft measures' },
  judges: { title: 'AI reviewers' },
  groups: { title: 'Reviewer groups' },
  extra_dimensions: { title: 'More dimensions' },
  judge_catalogue: { title: 'Reviewer sets' },
  knowledge_refs: {
    title: 'Sources',
    intro: 'The frameworks, concepts, thinkers and studies the model draws on.',
  },
};

/** What one record of a kind is called, for headings and "Linked from" lists. */
export const KIND_LABEL: Readonly<Record<string, { one: string; many: string }>> = {
  appeal: { one: 'Appeal', many: 'Appeals' },
  dimension: { one: 'Dimension', many: 'Dimensions' },
  lens: { one: 'Lens', many: 'Lenses' },
  archetype: { one: 'Reader archetype', many: 'Reader archetypes' },
  exec_role: { one: 'Executive reader', many: 'Executive readers' },
  perspective: { one: 'Perspective', many: 'Perspectives' },
  lever: { one: 'Lever', many: 'Levers' },
  move: { one: 'Move', many: 'Moves' },
  red_flag: { one: 'Red flag', many: 'Red flags' },
  content_type: { one: 'Type of copy', many: 'Types of copy' },
  audience_modifier: { one: 'Reader setting', many: 'Reader settings' },
  balance_rule: { one: 'Balance rule', many: 'Balance rules' },
  craft_metric: { one: 'Craft measure', many: 'Craft measures' },
  judge: { one: 'AI reviewer', many: 'AI reviewers' },
  research: { one: 'Study', many: 'Studies' },
  limitation: { one: 'Limitation', many: 'Limitations' },
  duty: { one: 'Duty', many: 'Duties' },
  group: { one: 'Reviewer group', many: 'Reviewer groups' },
  extra_dimension: { one: 'Dimension', many: 'Dimensions' },
  judge_profile: { one: 'Reviewer set', many: 'Reviewer sets' },
  knowledge_framework: { one: 'Framework', many: 'Frameworks' },
  knowledge_concept: { one: 'Concept', many: 'Concepts' },
  knowledge_thinker: { one: 'Thinker', many: 'Thinkers' },
  knowledge_study: { one: 'Study', many: 'Studies' },
  knowledge_overlay: { one: 'Overlay', many: 'Overlays' },
  culture_pole: { one: 'Cultural type', many: 'Cultural types' },
  culture_hofstede_dim: { one: 'Hofstede dimension', many: 'Hofstede dimensions' },
  culture_scale: { one: 'Cultural scale', many: 'Cultural scales' },
  culture_country: { one: 'Country', many: 'Countries' },
};

/** Field names as a reader would say them. Unlisted fields are named from their key. */
export const FIELD_LABEL: Readonly<Record<string, string>> = {
  judge_asks: 'The AI reviewer asks',
  aristotle_link: 'In Aristotle',
  modern_reading: 'A modern reading',
  grounded_in: 'Grounded in',
  gumption: 'Grounded in',
  research: 'Evidence',
  evidence: 'Strength of evidence',
  refs: 'Evidence',
  positive_signals: 'Signs it works',
  negative_signals: 'Signs it doesn’t',
  evidence_basis: 'Evidence basis',
  why_add: 'Why it is here',
  look_for: 'Look for',
  ethical_use: 'Honest use',
  misuse: 'Misuse',
  priority_dimensions: 'Matters most',
  watch_outs: 'Watch out for',
  weights: 'Target mix',
  weight_delta: 'Shifts the mix by',
  implication: 'What it changed',
  mitigation: 'In the model',
  replication_status: 'Replication',
  key_question: 'Key question',
  cares_about: 'Cares about',
  red_flags: 'Red flags',
  primary: 'Primary duty',
  secondary: 'Secondary duty',
  content_types: 'Types of copy',
  judges: 'AI reviewers',
};

/**
 * Fields that hold what the engine reads rather than what a person reads:
 * regular expressions, colours, output limits. Shown folded away under
 * "How the engine reads it", never dropped, since the page shows the whole
 * model.
 */
export const TECHNICAL_FIELDS: ReadonlySet<string> = new Set([
  'heuristic',
  'pattern',
  'quick',
  'pos',
  'neg',
  'colour',
  'max_highlights',
  'max_recommendations',
]);

/**
 * Fields read first, in this order, when a record has them. The stored model
 * does not keep the file's key order (Postgres orders an object's keys by
 * length), so the order is set here. Fields not listed follow: text, then
 * lists, then maps, then numbers, each alphabetically.
 */
export const LEADING_FIELDS: readonly string[] = [
  'description',
  'definition',
  'summary',
  'detail',
  'finding',
  'implication',
  'mitigation',
  'statement',
  'how',
  'example',
  'guardrail',
  'look_for',
  'ethical_use',
  'misuse',
  'message',
  'when',
  'aristotle',
  'modern_reading',
  'why_add',
  'judge_asks',
  'rubric',
  'positive_signals',
  'negative_signals',
  'advice',
];

function typeRank(value: unknown): number {
  if (typeof value === 'string') return 0;
  if (Array.isArray(value)) return 1;
  if (typeof value === 'object' && value !== null) return 2;
  return 3;
}

/** A record's fields in reading order. */
export function readingOrder<T>(entries: [string, T][]): [string, T][] {
  const lead = (key: string) => {
    const i = LEADING_FIELDS.indexOf(key);
    return i < 0 ? LEADING_FIELDS.length : i;
  };
  return [...entries].sort(
    ([a, av], [b, bv]) => lead(a) - lead(b) || typeRank(av) - typeRank(bv) || a.localeCompare(b)
  );
}

/** The field a record's heading is taken from, first one present. Else the id. */
export const TITLE_FIELDS: readonly string[] = ['name', 'title', 'term', 'cite'];

/** Fields shown beside the heading rather than in the body, when present. */
export const SUBTITLE_FIELDS: readonly string[] = [
  'greek',
  'latin',
  'tagline',
  'school',
  'question',
];

function humanise(key: string): string {
  const words = key.replace(/[_-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

export function sectionCopy(key: string): SectionCopy {
  return SECTION_COPY[key] ?? { title: humanise(key) };
}

export function kindLabel(kind: string, count: 'one' | 'many' = 'one'): string {
  // A section's own fields (`section:scoring`) are named after the section.
  if (kind.startsWith('section:')) return sectionCopy(kind.slice('section:'.length)).title;
  const known = KIND_LABEL[kind];
  if (known) return known[count];
  const base = humanise(kind.replace(/^(knowledge|culture)_/, ''));
  return count === 'many' && !base.endsWith('s') ? `${base}s` : base;
}

export function fieldLabel(key: string): string {
  return FIELD_LABEL[key] ?? humanise(key);
}
