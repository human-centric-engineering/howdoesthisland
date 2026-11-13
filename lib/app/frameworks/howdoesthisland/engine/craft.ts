/**
 * Craft metrics (t-13): the prototype's `craft()`, ported line for line.
 * Readability, voice, emotion and rhetorical devices, counted from the text
 * alone. Nothing here reads the model.
 */
import {
  NEG,
  POS,
  STOP,
  countIn,
  splitSentences,
  syllables,
  words as wordsOf,
  type Sentence,
} from '@/lib/app/frameworks/howdoesthisland/engine/text';

export interface CraftMetrics {
  words: number;
  sentences: number;
  speaking_sec: number;
  gunning_fog: number;
  fk_grade: number;
  passive_pct: number;
  emotional_pct: number;
  positivity: number;
  avg_sentence: number;
  you: number;
  we: number;
  i: number;
  devices: {
    tricolon: number;
    antithesis: number;
    anaphora: number;
    questions: number;
    alliteration: number;
  };
}

export function craft(text: string, S: readonly Sentence[] = splitSentences(text)): CraftMetrics {
  const words = wordsOf(text);
  const W = Math.max(1, words.length);
  const SN = Math.max(1, S.length);
  let syl = 0;
  let complex = 0;
  for (const w of words) {
    const s = syllables(w);
    syl += s;
    if (s >= 3) complex++;
  }
  const passive = S.filter((s) =>
    /\b(am|is|are|was|were|be|been|being)\s+(\w+ly\s+)?\w+(ed|en|wn|lt|ught)\b/i.test(s.text)
  ).length;
  const pos = countIn(text, `\\b(${POS})\\b`);
  const neg = countIn(text, `\\b(${NEG})\\b`);
  let anaphora = 0;
  const first = (x: Sentence) =>
    (x.text.split(/\s+/)[0] || '').toLowerCase().replace(/[^a-z']/g, '');
  for (let k = 2; k < S.length; k++) {
    const a = first(S[k]);
    if (a && a.length > 1 && a === first(S[k - 1]) && a === first(S[k - 2])) anaphora++;
  }
  let allit = 0;
  const ws = words
    .map((w) => w.toLowerCase())
    .filter((w) => !STOP.has(w) && /^[b-df-hj-np-tv-z]/.test(w));
  for (let k = 2; k < ws.length; k++) {
    if (ws[k][0] === ws[k - 1][0] && ws[k][0] === ws[k - 2][0]) allit++;
  }
  return {
    words: W,
    sentences: S.length,
    speaking_sec: Math.round((W / 130) * 60),
    gunning_fog: +(0.4 * (W / SN + (100 * complex) / W)).toFixed(1),
    fk_grade: +(0.39 * (W / SN) + 11.8 * (syl / W) - 15.59).toFixed(1),
    passive_pct: Math.round((100 * passive) / SN),
    emotional_pct: +((100 * (pos + neg)) / W).toFixed(1),
    positivity: pos + neg ? Math.round((100 * (pos - neg)) / (pos + neg)) : 0,
    avg_sentence: +(W / SN).toFixed(1),
    you: countIn(text, '\\b(you|your|yours)\\b'),
    we: countIn(text, '\\b(we|our|us|ours)\\b'),
    i: countIn(text, '\\b(i|my|me|mine)\\b'),
    devices: {
      tricolon: countIn(
        text,
        "\\b[\\w'’-]+(?: [\\w'’-]+)?, [\\w'’-]+(?: [\\w'’-]+)?,? and [\\w'’-]+\\b"
      ),
      antithesis:
        countIn(text, '\\bnot\\b[^.?!\\n]{1,60}\\bbut\\b') +
        countIn(text, '\\b(rather than|instead of)\\b'),
      anaphora,
      questions: (text.match(/\?/g) ?? []).length,
      alliteration: allit,
    },
  };
}
