/**
 * Culture profiles and positions (t-13): the prototype's `cultureProfile`,
 * `lewisLabel`, `culturePositions` and the cue patterns they read, ported
 * line for line.
 *
 * A reader's profile is where their culture expects a text to sit on each
 * scale; a text's positions are where it does sit. Both are 0–1 per scale.
 * Whether any of it is used is the culture switch's call (D11), made in
 * `quick-scan.ts` and `assemble.ts`, not here.
 */
import type { EngineModel, Lewis } from '@/lib/app/frameworks/howdoesthisland/engine/model';
import { NEG, POS, countIn, wordCount } from '@/lib/app/frameworks/howdoesthisland/engine/text';
import type {
  CultureProfile,
  GlobalProfile,
} from '@/lib/app/frameworks/howdoesthisland/engine/types';

export const cl01 = (v: number): number => Math.max(0, Math.min(1, v));

/** The profile for a global or mixed audience: the middle of every scale, a wide tolerance. */
export function globalProfile(m: EngineModel): GlobalProfile {
  return {
    id: 'global',
    name: 'Global or mixed audience',
    global: true,
    lewis: { linear: 1 / 3, multi: 1 / 3, reactive: 1 / 3 },
    hofstede: null,
    targets: Object.fromEntries(m.SCALE_IDS.map((s) => [s, 0.5])),
    tolerance: 0.3,
  };
}

/** A country's profile, or the global one for an id the model does not have. */
export function cultureProfile(m: EngineModel, id: string | undefined): CultureProfile {
  const c = id === undefined ? undefined : m.COUNTRY.get(id);
  if (!c) return globalProfile(m);
  const { linear: L, multi: Mu, reactive: R } = c.lewis;
  const h = (k: string) => {
    const v = c.hofstede[k];
    return v == null ? 0.5 : v / 100;
  };
  const t = {
    context: cl01(0.6 * (0.85 * R + 0.45 * Mu + 0.05 * L) + 0.4 * (1 - h('idv'))),
    directness: cl01(0.75 * (0.9 * R + 0.35 * Mu + 0.05 * L) + 0.25 * (1 - h('idv'))),
    persuading: cl01(c.persuading),
    formality: cl01(0.65 * h('pdi') + 0.35 * (0.6 * R + 0.35 * Mu + 0.1 * L)),
    trust: cl01(0.6 * (0.9 * Mu + 0.8 * R + 0.1 * L) + 0.4 * (1 - h('idv'))),
    collective: cl01(1 - h('idv')),
    time: cl01(0.5 * (0.8 * Mu + 0.6 * R) + 0.5 * h('lto')),
    uncertainty: cl01(h('uai')),
    expressiveness: cl01(0.12 + 0.75 * Mu - 0.05 * R + 0.15 * (h('ivr') - 0.5)),
  };
  // Copies, not the model's own (frozen) objects, so a caller may change a result.
  return {
    ...c,
    lewis: { ...c.lewis },
    hofstede: { ...c.hofstede },
    global: false,
    targets: t,
    tolerance: 0.14,
  };
}

const LEWIS_POLES = ['linear', 'multi', 'reactive'] as const;
const LEWIS_NAMES: Record<keyof Lewis, string> = {
  linear: 'linear-active',
  multi: 'multi-active',
  reactive: 'reactive',
};

export function lewisLabel(l: Lewis): string {
  // The model's own key order, so a tie sorts as the prototype's did.
  const s = LEWIS_POLES.map((k) => [k, l[k]] as const).sort((a, b) => b[1] - a[1]);
  if (s[0][1] < 0.45) return 'A balanced blend of all three';
  return (
    `Mostly ${LEWIS_NAMES[s[0][0]]}` +
    (s[1][1] >= 0.2 ? `, with ${LEWIS_NAMES[s[1][0]]} traits` : '')
  );
}

/** Where a text sits between two cue counts, smoothed: 0.5 when it has neither. */
export const share = (hi: number, lo: number, a = 1): number => (hi + a) / (hi + lo + 2 * a);

export const CUE = {
  explicit:
    '\\b(to be clear|in short|in summary|the point is|specifically|this means|that is|i\\.e\\.|we recommend|my (ask|recommendation)|in other words|to summarise|to summarize)\\b',
  implicit:
    '\\b(perhaps|it may be|one might|it seems|we wonder|it could be|as you (may|might) know|as you know|needless to say|you will appreciate)\\b',
  direct:
    "\\b(you must|you need to|you should|we need|wrong|fail(ed|ure)?|problem|unacceptable|immediately|do not|don'?t|no\\b)",
  indirect:
    '\\b(perhaps|might|would you|could we|could you|may i|i wonder|if possible|kindly|we would be grateful|it would be helpful|would it be possible|if convenient|when you have a moment)\\b',
  principle:
    '\\b(because|why|principle|theory|research|evidence|framework|concept|the reason|fundamental|logic|in principle)\\b',
  application:
    "\\b(for example|for instance|here'?s how|step|case|in practice|we did|results|tried|practical|how to|example)\\b",
  informal:
    "\\b(hi|hey|thanks|cheers|guys|awesome|super|cool|great|stuff|gonna|wanna|folks)\\b|[a-z]'(ll|re|ve|d|s)\\b|n't\\b|!",
  formal:
    '\\b(dear|mr|ms|mrs|dr|professor|respectfully|kindly|sincerely|regards|esteemed|honoured|honored|we would be grateful|please find|i remain|yours faithfully|yours sincerely)\\b',
  task: '\\b(results|deliverables?|roi|deadline|efficien\\w*|cost|scope|data|kpis?|metrics?|output|performance|budget)\\b|\\d+\\s?%',
  relationship:
    '\\b(relationship|partnership|partner|long-term|together|trust|meet|coffee|lunch|dinner|family|personally|get to know|honoured|honored|introduce|friend|our people|community)\\b',
  individual:
    '\\b(you|your|yours|i|my|me|individual|personal|own|stand out|achieve|your career|yourself)\\b',
  collective:
    '\\b(we|our|us|team|together|community|everyone|group|colleagues|family|society|all of us|shared)\\b',
  urgent:
    "\\b(now|today|deadline|immediately|asap|this week|by (monday|tuesday|wednesday|thursday|friday)|limited|quick(ly)?|fast|don'?t wait|hurry|right away)\\b",
  longterm:
    '\\b(long-term|long term|over time|future|years|generations|patient|patience|sustainable|lasting|journey|legacy|for decades)\\b',
  detail:
    '\\b(guarantee\\w*|step|process|plan|risk|specifically|exactly|detailed|ensure|proven|certified|warranty|contract|terms|procedure|timeline|milestone|schedule)\\b',
  intens:
    '\\b(really|so|incredibly|amazing|absolutely|totally|fantastic|wonderful|love|thrilled|delighted|passionate|exciting|excited)\\b',
} as const;

export const IDIOMS =
  '\\b(touch base|circle back|ballpark|home run|out of the park|slam dunk|move the needle|low-hanging fruit|piece of cake|on the same page|ducks in a row|run it up the flagpole|boil the ocean|drink(ing)? from (a|the) fire ?hose|bite the bullet|back to square one|ball is in your court|par for the course|go the extra mile|think outside the box|game-?changer|deep dive|wheelhouse|bandwidth|knock it out|quick win|level the playing field|the whole nine yards|hail mary|curveball|step up to the plate|cover all the bases|cost an arm and a leg|once in a blue moon|cut corners|hit the ground running|ahead of the curve|since sliced bread|elephant in the room|get the ball rolling|on the ball|pull out all the stops|pinch of salt|no-brainer|ballgame|level up|crush it|nail it|full-court press|monday morning quarterback|punt)\\b';

/** Where the text sits on each culture scale, 0–1, from its cues alone. */
export function culturePositions(text: string): Record<string, number> {
  const W = Math.max(1, wordCount(text));
  const cut = Math.floor(text.length * 0.4);
  const head = text.slice(0, cut);
  const n = (p: string) => countIn(text, p);
  const emo = countIn(text, `\\b(${POS}|${NEG})\\b`);
  return {
    context: share(
      n(CUE.implicit),
      n(CUE.explicit) + (text.match(/^\s*([-•*]|\d+[.)])\s/gm) ?? []).length * 0.5
    ),
    directness: share(n(CUE.indirect), n(CUE.direct)),
    persuading: share(countIn(head, CUE.principle), countIn(head, CUE.application)),
    formality: share(n(CUE.formal) * 1.5, n(CUE.informal) * 0.6),
    trust: share(n(CUE.relationship), n(CUE.task)),
    collective: share(n(CUE.collective), n(CUE.individual) * 0.7),
    time: share(n(CUE.longterm), n(CUE.urgent)),
    uncertainty: cl01((((n(CUE.detail) + (text.match(/\d/g) ?? []).length * 0.15) / W) * 100) / 4),
    expressiveness: cl01(
      ((((text.match(/!/g) ?? []).length * 2 + emo + n(CUE.intens)) / W) * 100) / 10
    ),
  };
}
