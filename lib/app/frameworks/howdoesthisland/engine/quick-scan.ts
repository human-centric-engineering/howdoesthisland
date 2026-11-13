/**
 * The quick scan (t-13): the prototype's `quickScan` and `extraScan`, ported
 * line for line. Deterministic and free: every score comes from the model's
 * patterns and the text, with no model call.
 *
 * **The culture switch (D11).** With culture off, the reader's and writer's
 * cultures are not read (the reader is a global audience), and no culture
 * output is produced: no `cul_*` scores, notes or highlights, and no
 * `culture` block. The text's formality is still measured, because craft's
 * tone score compares it with what the content type expects.
 */
import { craft } from '@/lib/app/frameworks/howdoesthisland/engine/craft';
import {
  CUE,
  IDIOMS,
  cultureProfile,
  culturePositions,
  globalProfile,
  share,
} from '@/lib/app/frameworks/howdoesthisland/engine/culture';
import { must, type EngineModel } from '@/lib/app/frameworks/howdoesthisland/engine/model';
import { appealOf, isExec } from '@/lib/app/frameworks/howdoesthisland/engine/scoring';
import {
  STOP,
  clamp,
  countIn,
  splitSentences,
  wordCount,
  type Sentence,
} from '@/lib/app/frameworks/howdoesthisland/engine/text';
import type { CraftMetrics } from '@/lib/app/frameworks/howdoesthisland/engine/craft';
import type {
  CultureProfile,
  EngineContext,
  Highlight,
  LeverState,
  Polarity,
  QuickScan,
  RedFlag,
} from '@/lib/app/frameworks/howdoesthisland/engine/types';

export interface EngineOptions {
  /** The culture switch (D11): `isCultureEnabled()` where the engine is created. */
  culture: boolean;
}

/** The lever each red flag misuses. */
const FLAG_LEVER: Readonly<Record<string, string>> = {
  rf_false_urgency: 'lv_scarcity',
  rf_confirmshaming: 'lv_respect',
  rf_controlling: 'lv_freedom',
  rf_fear: 'lv_efficacy',
  rf_hype: 'lv_tactic_visibility',
  rf_absolute_promise: 'lv_truthful',
  rf_weasel: 'lv_truthful',
  rf_buzzword_cluster: 'lv_fluency',
  rf_status_threat: 'lv_no_status_threat',
};

/** Acronyms every reader is taken to know. */
const ACRO_OK: ReadonlySet<string> = new Set(
  'UK US USA EU UN CEO CFO COO CTO CIO CMO CHRO CRO HR AI OK PDF FAQ NHS BBC TV PM AM ID IT CV PR ROI GDP NGO UAE SME B2B B2C AM PM Q1 Q2 Q3 Q4 FY HQ IPO API URL USB'.split(
    ' '
  )
);

/** How formal each content type is expected to be, 0–1; 0.5 for the rest. */
const FORMAL_CT: Readonly<Record<string, number>> = {
  cv_resume: 0.7,
  sales_proposal: 0.7,
  exec_briefing: 0.7,
  press_release: 0.7,
  cover_letter: 0.7,
  social_post: 0.3,
  sales_email: 0.45,
};

const CONN =
  "\\b(however|therefore|because|so|also|first|then|finally|for example|as a result|this means|in contrast|meanwhile|next|but|instead|which means|that'?s why|in short|for instance|similarly|still|yet)\\b";
const JARGON =
  '\\b(synerg\\w*|leverag\\w*|holistic|paradigm|ecosystem|end-to-end|best-of-breed|value-add\\w*|operationali[sz]\\w*|ideat\\w*|actionable|learnings|deliverables|stakeholder alignment|bandwidth|scalab\\w*)\\b';
const INCLUSIVITY =
  '\\b(guys|chairman|chairmen|manpower|mankind|man-hours|businessman|businessmen|salesman|salesmen|foreman|crazy|insane|lame|dumb|tone-deaf|crippl\\w*|psycho|spaz|retard\\w*|wheelchair-bound|suffers from|digital natives|young and dynamic)\\b';

interface ScanPart {
  scores: Record<string, number>;
  notes: Record<string, string>;
  highlights: Highlight[];
}

/** The extra groups' dimensions: craft, audience and (with culture on) culture. */
function extraScan(
  m: EngineModel,
  text: string,
  S: readonly Sentence[],
  ctx: EngineContext,
  c: CraftMetrics,
  base: Readonly<Record<string, number>>,
  prof: CultureProfile,
  pos: Readonly<Record<string, number>>,
  opts: EngineOptions
): ScanPart {
  const scores: Record<string, number> = {};
  const notes: Record<string, string> = {};
  const hl: Highlight[] = [];
  const W = Math.max(1, wordCount(text));
  const add = (s: Sentence, dim: string, pol: Polarity, note: string) =>
    hl.push({
      start: s.start,
      end: s.end,
      quote: s.text,
      dimension: dim,
      appeal: must(m.DIM, dim, 'dimension').group ?? null,
      polarity: pol,
      note,
      source: 'quick',
    });
  const paras = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  // structure
  let st = 0;
  const first2 = S.slice(0, 2)
    .map((s) => s.text)
    .join(' ');
  if (
    /\b(recommend|propose|we can|you can|ask|decision|the point|in short|here'?s|what if)\b|\?/i.test(
      first2
    ) ||
    (S[0] && S[0].words <= 18 && /\byou(r)?\b/i.test(S[0].text))
  ) {
    st++;
  }
  const spp = S.length / Math.max(1, paras.length);
  if (spp <= 4) st++;
  if (
    W < 300 ||
    /^\s*([-•*]|\d+[.)])\s/m.test(text) ||
    paras.some((p) => p.length < 70 && !/[.!?]$/.test(p))
  ) {
    st++;
  }
  if ((base.kai_call ?? 0) >= 3) st++;
  scores.craft_structure = clamp(st);
  notes.craft_structure = `${paras.length} paragraphs, about ${spp.toFixed(1)} sentences each.`;

  // length
  const [lo, hi] = m.LEN_TARGET[ctx.contentType] ?? [80, 900];
  let ls = 4;
  if (W > hi) {
    const r = W / hi;
    ls = r < 1.3 ? 3 : r < 1.7 ? 2 : r < 2.5 ? 1 : 0;
  } else if (W < lo) {
    const r = W / lo;
    ls = r > 0.75 ? 3 : r > 0.5 ? 2 : r > 0.3 ? 1 : 0;
  }
  scores.craft_length = ls;
  notes.craft_length = `${W} words; typical range for this content type is ${lo} to ${hi}.`;

  // clarity
  const exp = ctx.audience.expertise || 'informed';
  const fogT =
    ctx.contentType === 'social_post'
      ? 8
      : exp === 'novice'
        ? 9
        : exp === 'expert'
          ? 14
          : isExec(ctx)
            ? 12
            : 11;
  let cs = 4 - Math.max(0, (c.gunning_fog - fogT) / 2);
  if (c.passive_pct > 15) cs -= 1;
  const longS = S.filter((s) => s.words > 28);
  if (S.length > 3 && longS.length / S.length > 0.2) cs -= 1;
  const nom = countIn(text, '\\b\\w{4,}(tion|ment|ness|ity|ance|ence)s?\\b');
  if ((nom / W) * 100 > 4) cs -= 1;
  scores.craft_clarity = clamp(cs);
  notes.craft_clarity = `Fog ${c.gunning_fog} (aim under ${fogT}), ${c.passive_pct}% passive, ${longS.length} long sentences.`;
  for (const s of longS.slice(0, 4))
    add(s, 'craft_clarity', 'weakness', `${s.words} words. Split it.`);

  // cohesion
  const conn = S.filter((s) => countIn(s.text, CONN) > 0).length / Math.max(1, S.length);
  const cw = (s: Sentence) =>
    new Set((s.text.toLowerCase().match(/[a-z]{5,}/g) ?? []).filter((w) => !STOP.has(w)));
  let ov = 0;
  for (let k = 1; k < S.length; k++) {
    const a = cw(S[k - 1]);
    const b = cw(S[k]);
    if ([...b].some((w) => a.has(w))) ov++;
  }
  const ovr = ov / Math.max(1, S.length - 1);
  scores.craft_cohesion =
    S.length < 4
      ? 3
      : clamp(
          (conn >= 0.35 ? 2 : conn >= 0.2 ? 1.5 : conn >= 0.1 ? 1 : 0.5) +
            (ovr >= 0.45 ? 2 : ovr >= 0.3 ? 1.5 : ovr >= 0.15 ? 1 : 0.5)
        );
  notes.craft_cohesion = `${Math.round(conn * 100)}% of sentences use a linking word; ${Math.round(ovr * 100)}% pick up a word from the sentence before.`;

  // tone
  // A model without culture scales has no formality target: the middle, as
  // for a global reader, rather than NaN.
  const want = 0.5 * (FORMAL_CT[ctx.contentType] ?? 0.5) + 0.5 * (prof.targets.formality ?? 0.5);
  const pf = paras.map((p) => share(countIn(p, CUE.formal) * 1.5, countIn(p, CUE.informal) * 0.6));
  const spread = pf.length > 1 ? Math.max(...pf) - Math.min(...pf) : 0;
  const ts =
    4 -
    Math.max(0, Math.abs(pos.formality - want) - 0.15) * 8 -
    (spread > 0.45 ? 1 : 0) -
    ((text.match(/!/g) ?? []).length > 2 ? 1 : 0);
  scores.craft_tone = clamp(ts);
  notes.craft_tone = `Formality ${Math.round(pos.formality * 100)} of 100; this reader and form expect about ${Math.round(want * 100)}.`;

  // claims
  let pen = 0;
  for (const s of S) {
    if (
      /\d+(\.\d+)?\s?%|\b\d+x\b|\btimes (more|faster|better)\b/i.test(s.text) &&
      !/\b(according|source|survey|study|research|n=|report|data from)\b|\(\d{4}\)/i.test(s.text)
    ) {
      pen += 0.5;
      add(s, 'craft_claims', 'weakness', 'A figure with no source. Say where it comes from.');
    }
    if (
      /\b(the best|leading|number one|#1|unrivall?ed|world-?class|guarantee[ds]?|proven|never fails|always works|better than)\b/i.test(
        s.text
      )
    ) {
      pen += 0.75;
      add(s, 'craft_claims', 'weakness', 'A claim you may be asked to prove.');
    }
  }
  scores.craft_claims = clamp(4 - pen);
  notes.craft_claims = pen
    ? 'Some claims would need support if challenged.'
    : 'No obviously unsupported claims found.';

  // audience: suitability
  const fogAud = exp === 'novice' ? 9 : exp === 'expert' ? 14 : 12;
  const dd = c.gunning_fog - fogAud;
  const fs = dd <= 0 ? 4 : dd <= 2 ? 3 : dd <= 4 ? 2 : dd <= 6 ? 1 : 0;
  let roleHit = 0;
  const role = ctx.role ? m.ROLE.get(ctx.role) : undefined;
  if (role) {
    const words =
      role.cares_about
        .join(' ')
        .toLowerCase()
        .match(/[a-z]{4,}/g) ?? [];
    roleHit = words.some((w) => text.toLowerCase().includes(w)) ? 0.5 : 0;
  }
  scores.aud_suitability = clamp(0.6 * fs + 0.4 * (base.eth_goodwill ?? 2) + roleHit);
  notes.aud_suitability = `Reading level Fog ${c.gunning_fog} for a ${exp} reader (aim ${fogAud} or under).`;

  // hook
  const opening =
    S.find((s) => !/^(subject:|hi\b|hello\b|dear\b|hey\b)/i.test(s.text) && s.words > 2) ?? S[0];
  let hk = 2;
  if (opening) {
    if (/\byou(r)?\b/i.test(opening.text)) hk++;
    if (/\d|\?|what if|\b[A-Z][a-z]+ [A-Z][a-z]+/.test(opening.text.slice(1))) hk++;
    if (
      /\b(hope (this|you)|my name is|i am writing|i'?m writing|welcome to|we are a|allow me|just wanted|i wanted to reach out|i'?m reaching out|as you (may )?know)\b/i.test(
        opening.text
      )
    ) {
      hk -= 2;
      add(
        opening,
        'aud_hook',
        'weakness',
        "Throat-clearing. Open with the reader's situation instead."
      );
    }
    if (opening.words > 25) hk--;
  }
  scores.aud_hook = clamp(hk);
  notes.aud_hook = opening ? `Opening line: ${opening.words} words.` : '';

  // knowledge
  const acr = [
    ...new Set((text.match(/\b[A-Z]{2,6}s?\b/g) ?? []).map((a) => a.replace(/s$/, ''))),
  ].filter((a) => !ACRO_OK.has(a) && !new RegExp(`\\(${a}\\)|${a}\\s*\\(`).test(text));
  const jar = countIn(text, JARGON);
  const half = exp === 'expert' ? 0.5 : 1;
  scores.aud_knowledge = clamp(4 - acr.length * 0.75 * half - (((jar / W) * 1000) / 6) * half);
  notes.aud_knowledge = acr.length
    ? `Undefined acronyms: ${acr.slice(0, 6).join(', ')}.`
    : 'No undefined acronyms found.';

  // inclusivity
  let inc = 0;
  for (const s of S) {
    const k = countIn(s.text, INCLUSIVITY);
    if (k) {
      inc += k;
      add(s, 'aud_inclusivity', 'weakness', 'Language some readers may find exclusionary.');
    }
  }
  scores.aud_inclusivity = clamp(4 - inc * 0.75);
  notes.aud_inclusivity = inc
    ? `${inc} term${inc > 1 ? 's' : ''} to reconsider.`
    : 'No exclusionary terms found.';

  if (!opts.culture) return { scores, notes, highlights: hl };

  // culture scales
  for (const scale of m.SCALES) {
    const sid = scale.id;
    const d = Math.max(0, Math.abs(pos[sid] - prof.targets[sid]) - prof.tolerance);
    scores['cul_' + sid] = clamp(4 - d * 13);
    notes['cul_' + sid] =
      `Text ${Math.round(pos[sid] * 100)}, reader expects about ${Math.round(prof.targets[sid] * 100)} ` +
      `(0 = ${scale.low.split(':')[0].toLowerCase()}, 100 = ${scale.high.split(':')[0].toLowerCase()}).`;
  }
  let idi = 0;
  for (const s of S) {
    const k = countIn(s.text, IDIOMS);
    if (k) {
      idi += k;
      add(s, 'cul_idiom', 'weakness', 'An idiom that may not travel or translate.');
    }
  }
  const idw = prof.global || ctx.culture?.writer !== ctx.culture?.reader ? 1 : 0.5;
  scores.cul_idiom = clamp(4 - idi * idw * (idi > 3 ? 1 : 0.8));
  notes.cul_idiom = idi
    ? `${idi} idiom${idi > 1 ? 's' : ''} that may not travel.`
    : 'No culture-bound idioms found.';
  return { scores, notes, highlights: hl };
}

export function quickScan(
  m: EngineModel,
  text: string,
  ctx: EngineContext,
  opts: EngineOptions
): QuickScan {
  const S = splitSentences(text);
  const W = Math.max(1, wordCount(text));
  const per = (n: number) => (n * 1000) / W;
  const scores: Record<string, number> = {};
  const notes: Record<string, string> = {};
  const hl: Highlight[] = [];
  const addHl = (s: Sentence, dim: string, pol: Polarity, note: string) =>
    hl.push({
      start: s.start,
      end: s.end,
      quote: s.text,
      dimension: dim,
      appeal: appealOf(m, dim),
      polarity: pol,
      note,
      source: 'quick',
    });
  const avgLen = S.length ? S.reduce((a, s) => a + s.words, 0) / S.length : 0;
  const longS = S.filter((s) => s.words > 30);
  const c = craft(text, S);

  for (const d of [...m.DIMS, ...m.LENSES]) {
    const h = d.heuristic ?? {};
    if (h.ratio) {
      const you = countIn(text, h.ratio.num);
      const we = countIn(text, h.ratio.den);
      const r = you / (we + 1);
      scores[d.id] = r >= h.ratio.ideal ? 4 : r >= 1 ? 3 : r >= 0.5 ? 2 : r >= 0.2 ? 1 : 0;
      notes[d.id] = `About the reader ${you} times, about the author ${we} times.`;
      let k = 0;
      for (const s of S) {
        if (/^(we|our|i|my)\b/i.test(s.text) && k < 6) {
          addHl(s, d.id, 'weakness', 'Starts with the author, not the reader.');
          k++;
        }
      }
      continue;
    }
    if (h.readability) {
      let sc = avgLen <= 15 ? 4 : avgLen <= 20 ? 3 : avgLen <= 25 ? 2 : avgLen <= 32 ? 1 : 0;
      if (S.length > 3 && longS.length / S.length > 0.25) sc -= 1;
      if (d.id === 'lens_prepon') {
        if (isExec(ctx) && c.gunning_fog > 12) sc -= 1;
        if (['social_post', 'sales_email'].includes(ctx.contentType) && (avgLen > 18 || W > 400))
          sc -= 1;
        if (
          ['cv_resume', 'exec_briefing', 'press_release', 'cover_letter'].includes(
            ctx.contentType
          ) &&
          countIn(text, must(m.FLAG, 'rf_false_urgency', 'red flag').pattern)
        ) {
          sc -= 1;
        }
        notes[d.id] =
          `Gunning Fog ${c.gunning_fog}${isExec(ctx) ? ' (aim under 12 for executives)' : ''}; average sentence ${avgLen.toFixed(0)} words.`;
      } else {
        notes[d.id] = `Average sentence ${avgLen.toFixed(0)} words; ${longS.length} over 30 words.`;
      }
      scores[d.id] = clamp(sc);
      if (d.id === 'log_clarity') {
        for (const s of longS.slice(0, 6))
          addHl(s, d.id, 'weakness', `${s.words} words. Split it.`);
      }
      continue;
    }
    let pos = 0;
    let neg = 0;
    const posS: Sentence[] = [];
    const negS: Sentence[] = [];
    for (const s of S) {
      let p = 0;
      let n = 0;
      for (const pat of h.pos ?? []) p += countIn(s.text, pat);
      for (const pat of h.neg ?? []) n += countIn(s.text, pat);
      if (p) posS.push(s);
      if (n) negS.push(s);
      pos += p;
      neg += n;
    }
    const base = h.base ?? 1;
    const target = h.target_per_k || 5;
    let sc: number;
    if (h.cta) {
      const tail = text.length * 0.7;
      sc = posS.length ? 2 : negS.length ? 1 : 0;
      if (posS.some((s) => s.start >= tail)) sc = 3;
      if (
        posS.some(
          (s) =>
            s.start >= tail &&
            /\b(\d+|minute|minutes|today|tomorrow|this week|next week|by \w+day|free)\b/i.test(
              s.text
            )
        )
      ) {
        sc = 4;
      }
      if (negS.length && !posS.some((s) => s.start >= tail)) sc = Math.min(sc, 1);
      notes[d.id] = posS.length
        ? `${posS.length} call${posS.length > 1 ? 's' : ''} to action found.`
        : 'No clear call to action found.';
    } else {
      sc = base + (4 - base) * Math.min(1, per(pos) / target) * Math.min(1, pos / 2);
      if (h.structure) {
        const lines = text.split('\n').map((l) => l.trim());
        const heads = lines.filter(
          (l, i) =>
            l &&
            l.length < 70 &&
            !/[.!?:,;]$/.test(l) &&
            l.split(/\s+/).length <= 9 &&
            lines[i + 1] !== undefined
        ).length;
        sc += Math.min(1, heads * 0.34);
        if (W < 150) sc = Math.max(sc, 2);
      }
      sc -= Math.min(3, (per(neg) * (h.neg_weight || 1)) / 4);
      notes[d.id] =
        `${pos} supporting signal${pos === 1 ? '' : 's'}${(h.neg ?? []).length ? `, ${neg} weakening` : ''}.`;
    }
    scores[d.id] = clamp(sc);
    for (const s of posS.slice(0, 8)) addHl(s, d.id, 'strength', d.name);
    for (const s of negS.slice(0, 6)) {
      addHl(
        s,
        d.id,
        'weakness',
        (d.negative_signals ?? [])[0] || 'Weakens ' + d.name.toLowerCase()
      );
    }
  }

  const flags: RedFlag[] = [];
  for (const f of m.data.red_flags) {
    // A fresh RegExp per flag: `exec` with `g` walks `lastIndex`.
    const re = new RegExp(f.pattern, 'gimu');
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) && flags.length < 40) {
      // A pattern that can match nothing would otherwise loop here for ever.
      if (match[0] === '') {
        re.lastIndex++;
        continue;
      }
      const start = match.index;
      const end = match.index + match[0].length;
      flags.push({
        id: f.id,
        quote: match[0],
        start,
        end,
        severity: f.severity,
        note: f.description,
        source: 'quick',
      });
      hl.push({
        start,
        end,
        quote: match[0],
        dimension: f.dimension,
        appeal: appealOf(m, f.dimension),
        polarity: 'weakness',
        flag: f.id,
        note: f.name + ': ' + f.description,
        source: 'quick',
      });
    }
  }
  // The prototype follows this with a per-dimension red-flag penalty that never
  // applies: it keys the penalty on `f.dimension`, which a found flag does not
  // carry, so every penalty lands on a score named "undefined" (NaN) and no
  // real score moves. That matches the model's own rule for v1 (`scoring.red_flags`:
  // flags "do not reduce scores"), so the port keeps the scores and drops the
  // stray "undefined" score and note. See the listed baseline differences.

  const fnRaw: Record<string, number> = Object.fromEntries(m.FN.map((f) => [f.id, 0]));
  for (const s of S) {
    for (const f of m.FN) {
      let n = 0;
      for (const p of f.pos) n += countIn(s.text, p);
      if (n) fnRaw[f.id] += Math.min(2, n) * Math.max(1, s.words / 12);
    }
  }
  const ft = Object.values(fnRaw).reduce((a, b) => a + b, 0);
  const fns: Record<string, number> = Object.fromEntries(
    m.FN.map((f) => [
      f.id,
      ft ? Math.round((100 * fnRaw[f.id]) / ft) : Math.round(100 / m.FN.length),
    ])
  );

  const levers: Record<string, LeverState> = {};
  for (const p of m.data.perspectives) {
    for (const l of p.levers) {
      if (!l.quick) {
        levers[l.id] = { status: 'unknown' };
        continue;
      }
      let hit: string | null = null;
      for (const s of S) {
        for (const pat of l.quick) {
          if (countIn(s.text, pat)) {
            hit = s.text;
            break;
          }
        }
        if (hit) break;
      }
      levers[l.id] = hit ? { status: 'present', quote: hit.slice(0, 140) } : { status: 'absent' };
    }
  }
  for (const f of flags) {
    const lv = FLAG_LEVER[f.id];
    if (lv)
      levers[lv] = { status: 'misused', quote: f.quote, note: must(m.FLAG, f.id, 'red flag').name };
  }
  const pvScores: Record<string, number | null> = {};
  for (const p of m.data.perspectives) {
    const q = p.levers.filter((l) => l.quick || levers[l.id].status === 'misused');
    const present = q.filter((l) => levers[l.id].status === 'present').length;
    const mis = p.levers.filter((l) => levers[l.id].status === 'misused').length;
    pvScores[p.id] = q.length ? clamp((4 * present) / Math.max(2, q.length) - mis) : null;
  }

  const prof = opts.culture ? cultureProfile(m, ctx.culture?.reader) : globalProfile(m);
  const writer = opts.culture && ctx.culture?.writer ? cultureProfile(m, ctx.culture.writer) : null;
  const cpos = culturePositions(text);
  const ex = extraScan(m, text, S, ctx, c, scores, prof, cpos, opts);
  Object.assign(scores, ex.scores);
  Object.assign(notes, ex.notes);
  hl.push(...ex.highlights);
  return {
    scores,
    notes,
    highlights: hl,
    flags,
    fns,
    levers,
    pvScores,
    craft: c,
    sentences: S,
    words: W,
    culture: opts.culture ? { reader: prof, writer, positions: cpos } : null,
  };
}
