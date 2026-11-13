/**
 * The engine baseline's corpus (t-12): text × context pairs beyond the eval set.
 *
 * All 18 eval cases read with the `global` culture and no writer, and most use
 * the default audience. This corpus is what pins the rest of the engine: reader
 * cultures across the Lewis spread of the model's countries, a writer culture
 * (none, the same as the reader, and a different one), every content type,
 * archetype and exec role, the audience modifiers, and texts with `İ` ahead of
 * a highlighted quote, where `locate()`'s case-insensitive path lands on the
 * wrong offset.
 *
 * Twelve texts, four contexts each. The first context reads the text as what
 * it is; the other three rotate through the model's lists so that every value
 * is reached. Rotation rather than hand-picking, so {@link checkCoverage} can
 * say what the corpus covers instead of a comment claiming it.
 *
 * The texts are written for this corpus. They are not real messages.
 */
import { z } from 'zod';

/** One corpus text, and the content type it actually is. */
export interface CorpusText {
  id: string;
  contentType: string;
  text: string;
}

/** The context shape the prototype's engine reads (its `DEFAULT_CTX`). */
export interface EngineContext {
  contentType: string;
  archetype: string;
  role: string;
  audience: Record<string, string>;
  culture: { reader: string; writer: string };
}

export interface CorpusPair {
  id: string;
  textId: string;
  text: string;
  ctx: EngineContext;
}

/** The lists the rotation draws from, read from the model by the caller. */
export interface CorpusModelLists {
  contentTypes: readonly string[];
  archetypes: readonly string[];
  roles: readonly string[];
  /** Audience modifier id → its option ids, archetype excluded. */
  audience: Readonly<Record<string, readonly string[]>>;
}

export const CORPUS_TEXTS: readonly CorpusText[] = [
  {
    id: 'launch-email',
    contentType: 'sales_email',
    text:
      "Hi Sam,\n\nI hope this finds you well. I'm reaching out because our team just shipped Ledgerly 3.0 and I think it's a game-changer for your AP workflow.\n\n" +
      'We help finance teams close the month 40% faster. Our customers include the best brands in retail, and our KPIs speak for themselves.\n\n' +
      "Can we touch base for 15 minutes this week? I'd love to circle back on the ballpark numbers and get the ball rolling.\n\nCheers,\nAlex",
  },
  {
    id: 'board-briefing',
    contentType: 'exec_briefing',
    text:
      'Recommendation: approve the second data centre in Frankfurt by 30 June.\n\n' +
      'Why now\n' +
      '- Peak load reached 87% of capacity in March, according to the Q1 operations report.\n' +
      '- Each month of delay adds an estimated EUR 120,000 in overflow costs.\n\n' +
      'Options considered\n' +
      'We compared three options: expand in place, lease colocation space, or build in Frankfurt. Expanding in place was rejected because the site cannot take more power. Colocation costs less up front but more over five years.\n\n' +
      'Risks\n' +
      'The main risk is the construction timeline. We have a fixed-price contract with penalty clauses, and a milestone review every month.\n\n' +
      'Decision needed: approval of the EUR 14m budget at the board meeting on 12 May.',
  },
  {
    id: 'fundraising',
    contentType: 'fundraising_appeal',
    text:
      'Last winter, Maria walked four kilometres every morning to carry water to her family. Some days she was too tired to go to school.\n\n' +
      'This year, the well in her village works. She is in class every day, and she wants to be a nurse.\n\n' +
      'Your gift of £25 keeps a well running for a month. Together we can reach 40 more villages before the dry season.\n\n' +
      "Don't wait. Donate today, and help another child like Maria hope again.",
  },
  {
    id: 'cover-letter',
    contentType: 'cover_letter',
    text:
      'Dear Hiring Manager,\n\n' +
      'I am writing to apply for the Operations Lead role. I have eight years of experience leading teams of guys on the warehouse floor and I report directly to the chairman.\n\n' +
      'I am a proven, world-class leader who always delivers. My synergistic approach leverages holistic best-of-breed processes to drive actionable learnings across the ecosystem.\n\n' +
      'I would welcome the chance to discuss how I could contribute.\n\nYours sincerely,\nJordan Lee',
  },
  {
    id: 'istanbul-release',
    contentType: 'press_release',
    text:
      'İstanbul, 4 March: İzmir Logistics today opened a new freight hub on the Asian side of the city.\n\n' +
      'The hub will handle 2,000 containers a week and create 350 jobs in the region. It was built in eleven months.\n\n' +
      '"This hub brings our customers closer to the markets that matter to them," said Ayşe Demir, chief executive. "We are proud of the team that built it."\n\n' +
      'Operations start on 1 April. Shippers can book space from today at the company website.',
  },
  {
    id: 'change-message',
    contentType: 'change_message',
    text:
      'Team,\n\n' +
      'Over the next two years we are going to change how we serve our customers. This is a long-term journey, and we will make it together.\n\n' +
      'Why? Because our customers have told us, clearly, that they want one person to call rather than five. That is the reason for the new account teams.\n\n' +
      'Nothing changes for you this month. In June each of us will join an account team, and your manager will talk to you personally before then.\n\n' +
      'I know change is hard. I also know this team, and I trust us to build something lasting for our community.\n\nPriya',
  },
  {
    id: 'social-hype',
    contentType: 'social_post',
    text: 'BIG NEWS!!! Our new app is here and it is absolutely amazing! Guaranteed to double your productivity or your money back. Only 100 spots left, act now before it is too late! #productivity #startup',
  },
  {
    id: 'speech-anaphora',
    contentType: 'speech',
    text:
      'Friends, we did not come here to complain, but to build.\n\n' +
      'We will build schools that open their doors to every child. We will build clinics that treat the sick without asking what they can pay. We will build roads, bridges and railways that carry our children further than we ever went.\n\n' +
      'It will not be quick. It will not be easy. It will be worth it.\n\n' +
      'So I ask you: will you build it with us? Join us on Saturday at the town hall, and bring a neighbour.',
  },
  {
    id: 'formal-proposal',
    contentType: 'sales_proposal',
    text:
      'Dear Mr Tanaka,\n\n' +
      'Thank you for the honour of meeting your colleagues in Osaka last month. We would be grateful for the opportunity to continue our partnership.\n\n' +
      'Perhaps it may be helpful to share our thinking. It seems that a phased approach could suit your organisation, beginning with one plant and extending to others once the results are clear.\n\n' +
      'We would be pleased to visit again at your convenience, if possible in the coming weeks, to introduce our engineering team personally.\n\n' +
      'Respectfully,\nKenji Mori\nDirector, Partnerships',
  },
  {
    id: 'case-study',
    contentType: 'case_study',
    text:
      'How Northfield Dairy cut energy use by a fifth\n\n' +
      'The problem\n' +
      'Northfield was spending £310,000 a year on refrigeration. The compressors were run at full power around the clock, and nobody was measuring which rooms needed it.\n\n' +
      'What we did\n' +
      'For example, sensors were installed in every cold room in the first week. Then the compressors were scheduled against real demand. In practice this meant two of six compressors were switched off overnight.\n\n' +
      'Results\n' +
      'Energy use fell by 21% in the first year (Northfield meter data, 2025). The project paid for itself in fourteen months.',
  },
  {
    id: 'one-liner',
    contentType: 'general',
    text: 'Thanks so much, see you tomorrow!',
  },
  {
    id: 'izmir-update',
    contentType: 'general',
    text:
      'İlk adım: the İzmir office moves to the new building on Monday.\n\n' +
      'Desks are allocated by team, and the floor plan is on the intranet. Please clear your desk by Friday at five.\n\n' +
      'If you need help with the move, ask the facilities team. They will collect boxes on Saturday morning.',
  },
];

/**
 * Reader cultures, chosen across the Lewis spread: linear-active (us, de, gb),
 * multi-active (br, it, sa, mx), reactive (jp, cn, vn, fi), blends (za, in,
 * sg), the explicit `global`, and an id the model does not have — which the
 * engine treats as global. Writers rotate through none, the reader's own, and
 * a culture that is not the reader's.
 */
export const READERS = [
  'us',
  'jp',
  'br',
  'de',
  'cn',
  'za',
  'it',
  'fi',
  'sa',
  'gb',
  'vn',
  'in',
  'mx',
  'sg',
  'global',
  'zz',
] as const;

const OTHER_WRITER = { default: 'gb', ifReaderIsGb: 'jp' } as const;

function writerFor(k: number, reader: string): string {
  if (k % 3 === 0) return '';
  if (k % 3 === 1) return reader;
  return reader === 'gb' ? OTHER_WRITER.ifReaderIsGb : OTHER_WRITER.default;
}

/**
 * The 48 pairs: each text under four contexts.
 *
 * Pair `n` (0-based, text-major) takes reader `READERS[n % 16]`, archetype
 * `n % 6`, a role on every other pair cycling the role list, and audience
 * options rotated with a different stride per modifier. Its content type is
 * the text's own for the first context; the other contexts cycle the whole
 * content-type list in turn.
 */
export function buildCorpus(lists: CorpusModelLists): CorpusPair[] {
  const pairs: CorpusPair[] = [];
  const modifiers = Object.keys(lists.audience);
  let n = 0;
  let rotated = 0;
  for (const t of CORPUS_TEXTS) {
    for (let k = 0; k < 4; k++, n++) {
      const reader = READERS[n % READERS.length];
      const audience: Record<string, string> = {};
      modifiers.forEach((m, mi) => {
        const options = lists.audience[m];
        audience[m] = options[(Math.floor(n / (mi + 1)) + mi) % options.length];
      });
      pairs.push({
        id: `${t.id}-${k + 1}`,
        textId: t.id,
        text: t.text,
        ctx: {
          contentType:
            k === 0 ? t.contentType : lists.contentTypes[rotated++ % lists.contentTypes.length],
          archetype: lists.archetypes[n % lists.archetypes.length],
          role: n % 2 === 1 ? lists.roles[((n - 1) / 2) % lists.roles.length] : '',
          audience,
          culture: { reader, writer: writerFor(n, reader) },
        },
      });
    }
  }
  return pairs;
}

/** Lewis profile per country id, for {@link checkCoverage}. */
export type LewisById = Readonly<
  Record<string, { linear: number; multi: number; reactive: number }>
>;

/** Only the parts of the model the corpus reads. */
export const corpusModelSchema = z.object({
  content_types: z.array(z.object({ id: z.string() })),
  archetypes: z.array(z.object({ id: z.string() })),
  exec_roles: z.array(z.object({ id: z.string() })),
  audience_modifiers: z.array(
    z.object({ id: z.string(), options: z.array(z.object({ id: z.string() })) })
  ),
  culture: z.object({
    countries: z.array(
      z.object({
        id: z.string(),
        lewis: z.object({ linear: z.number(), multi: z.number(), reactive: z.number() }),
      })
    ),
  }),
});

/**
 * The rotation lists and Lewis profiles from a model. The `archetype` audience
 * modifier is left out: the context carries the archetype on its own, and the
 * engine skips that modifier too.
 */
export function corpusInputs(model: unknown): { lists: CorpusModelLists; lewis: LewisById } {
  const m = corpusModelSchema.parse(model);
  return {
    lists: {
      contentTypes: m.content_types.map((c) => c.id),
      archetypes: m.archetypes.map((a) => a.id),
      roles: m.exec_roles.map((r) => r.id),
      audience: Object.fromEntries(
        m.audience_modifiers
          .filter((x) => x.id !== 'archetype')
          .map((x) => [x.id, x.options.map((o) => o.id)])
      ),
    },
    lewis: Object.fromEntries(m.culture.countries.map((c) => [c.id, c.lewis])),
  };
}

/**
 * What the corpus fails to cover, as messages; empty when it covers it all.
 *
 * The recorder refuses to write fixtures unless this is empty, so the coverage
 * the task promised is a property of the run, not of a comment.
 */
export function checkCoverage(
  pairs: readonly CorpusPair[],
  lists: CorpusModelLists,
  lewis: LewisById
): string[] {
  const gaps: string[] = [];
  if (pairs.length < 40) gaps.push(`only ${pairs.length} pairs; at least 40 are needed`);

  const missing = (label: string, all: readonly string[], seen: Set<string>) => {
    const left = all.filter((x) => !seen.has(x));
    if (left.length) gaps.push(`${label} not covered: ${left.join(', ')}`);
  };
  missing('content types', lists.contentTypes, new Set(pairs.map((p) => p.ctx.contentType)));
  missing('archetypes', lists.archetypes, new Set(pairs.map((p) => p.ctx.archetype)));
  missing('exec roles', lists.roles, new Set(pairs.map((p) => p.ctx.role)));
  for (const [m, options] of Object.entries(lists.audience)) {
    missing(`audience ${m}`, options, new Set(pairs.map((p) => p.ctx.audience[m])));
  }

  const readers = new Set(pairs.map((p) => p.ctx.culture.reader));
  for (const pole of ['linear', 'multi', 'reactive'] as const) {
    const n = [...readers].filter((r) => (lewis[r]?.[pole] ?? 0) >= 0.55).length;
    if (n < 2) gaps.push(`fewer than two readers are mostly ${pole}`);
  }
  if (![...readers].some((r) => lewis[r] && Math.max(...Object.values(lewis[r])) < 0.45)) {
    gaps.push('no reader is a balanced blend');
  }
  if (![...readers].some((r) => !lewis[r])) gaps.push('no reader falls back to global');

  const writers = pairs.map((p) => p.ctx.culture);
  if (!writers.some((c) => c.writer === '')) gaps.push('no pair without a writer culture');
  if (!writers.some((c) => c.writer && c.writer === c.reader)) {
    gaps.push('no pair whose writer is the reader');
  }
  if (
    !writers.some((c) => c.writer && lewis[c.writer] && lewis[c.reader] && c.writer !== c.reader)
  ) {
    gaps.push('no pair whose writer and reader are different known cultures');
  }

  // `İ` lower-cases to two code units, so it must come before the quote that
  // `locate()` finds case-insensitively: the last sentence (synthetic.ts).
  const dotted = pairs.filter((p) => {
    const at = p.text.indexOf('İ');
    return at >= 0 && at < p.text.lastIndexOf('\n');
  });
  if (!dotted.length) gaps.push('no text has İ ahead of its last paragraph');

  return gaps;
}
