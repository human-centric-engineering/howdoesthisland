// HowDoesThisLand engine: pure functions over the model. No DOM, no framework.
// The same module can run in the browser prototype and in the API service.

export const APPEALS = ["ethos", "pathos", "logos", "kairos"];
export const JUDGE_GROUPS = ["ethos", "pathos", "logos", "kairos", "lenses", "influence"];
export const DEFAULT_CTX = { contentType: "general", archetype: "general", role: "", audience: { involvement: "medium", awareness: "problem_aware", relationship: "warm", decision_unit: "individual", focus: "unknown", expertise: "informed" }, culture: { reader: "global", writer: "" } };
export const ALL_JUDGES = ["ethos", "pathos", "logos", "kairos", "craft", "audience", "culture", "lenses", "influence"];

const FLAG_LEVER = { rf_false_urgency: "lv_scarcity", rf_confirmshaming: "lv_respect", rf_controlling: "lv_freedom", rf_fear: "lv_efficacy", rf_hype: "lv_tactic_visibility", rf_absolute_promise: "lv_truthful", rf_weasel: "lv_truthful", rf_buzzword_cluster: "lv_fluency", rf_status_threat: "lv_no_status_threat" };
const POS = "achieve|achievement|amazing|benefit|best|better|bold|brave|bright|calm|celebrate|clear|confident|courage|delight|easy|energy|enjoy|excellent|excited|exciting|freedom|fun|gift|glad|good|great|grow|growth|happy|hope|hopeful|improve|inspire|joy|kind|laugh|love|lucky|opportunity|optimism|optimistic|peace|pleased|positive|possible|pride|proud|relief|safe|smile|strong|success|succeed|thank|thrive|together|trust|warm|welcome|win|wonder|wonderful";
const NEG = "afraid|anger|angry|anxious|anxiety|awful|bad|broken|burden|catastrophe|crisis|danger|dangerous|dead|destroy|destroyed|devastating|difficult|disaster|doubt|dying|fail|failure|fear|frustrated|frustrating|grief|guilt|hard|harm|hate|hopeless|hurt|lose|losing|loss|mess|nightmare|pain|painful|panic|problem|risk|ruin|sad|scared|shame|stress|stressed|struggle|struggling|suffer|terrible|threat|tired|worried|worry|worse|worst|wrong";
const STOP = new Set("the a an and or but of to in on for with at by from is are was were be been it this that we you i our your my they their he she as".split(" "));

export const wordCount = t => (t.match(/[\p{L}\p{N}'’-]+/gu) || []).length;
export const clamp = v => Math.max(0, Math.min(4, Math.round(v)));
export const band3 = v => (v < 45 ? "low" : v <= 70 ? "mid" : "high");

const RX = {};
const rx = p => RX[p] || (RX[p] = p.startsWith("(?c)") ? new RegExp(p.slice(4), "gmu") : new RegExp(p, "gimu"));
const countIn = (s, p) => (s.match(rx(p)) || []).length;

export function splitSentences(text) {
  const out = []; const re = /(?:[^.!?\n]|\.(?=\d))+(?:[.!?]+["'”’)]*)?/g; let m;
  while ((m = re.exec(text))) {
    const raw = m[0], lead = raw.length - raw.trimStart().length, t = raw.trim();
    if (t.length < 2) continue;
    out.push({ start: m.index + lead, end: m.index + lead + t.length, text: t, words: wordCount(t) });
  }
  return out;
}

function syllables(w) {
  w = w.toLowerCase().replace(/[^a-z]/g, ""); if (!w) return 0; if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const m = w.match(/[aeiouy]{1,2}/g); return Math.max(1, m ? m.length : 1);
}

export function craft(text, S = splitSentences(text)) {
  const words = text.match(/[\p{L}\p{N}'’-]+/gu) || []; const W = Math.max(1, words.length), SN = Math.max(1, S.length);
  let syl = 0, complex = 0; for (const w of words) { const s = syllables(w); syl += s; if (s >= 3) complex++; }
  const passive = S.filter(s => /\b(am|is|are|was|were|be|been|being)\s+(\w+ly\s+)?\w+(ed|en|wn|lt|ught)\b/i.test(s.text)).length;
  const pos = countIn(text, `\\b(${POS})\\b`), neg = countIn(text, `\\b(${NEG})\\b`);
  let anaphora = 0;
  const first = x => (x.text.split(/\s+/)[0] || "").toLowerCase().replace(/[^a-z']/g, "");
  for (let k = 2; k < S.length; k++) { const a = first(S[k]); if (a && a.length > 1 && a === first(S[k - 1]) && a === first(S[k - 2])) anaphora++; }
  let allit = 0; const ws = words.map(w => w.toLowerCase()).filter(w => !STOP.has(w) && /^[b-df-hj-np-tv-z]/.test(w));
  for (let k = 2; k < ws.length; k++) if (ws[k][0] === ws[k - 1][0] && ws[k][0] === ws[k - 2][0]) allit++;
  return {
    words: W, sentences: S.length, speaking_sec: Math.round((W / 130) * 60),
    gunning_fog: +(0.4 * (W / SN + (100 * complex) / W)).toFixed(1),
    fk_grade: +(0.39 * (W / SN) + 11.8 * (syl / W) - 15.59).toFixed(1),
    passive_pct: Math.round((100 * passive) / SN), emotional_pct: +((100 * (pos + neg)) / W).toFixed(1),
    positivity: pos + neg ? Math.round((100 * (pos - neg)) / (pos + neg)) : 0, avg_sentence: +(W / SN).toFixed(1),
    you: countIn(text, "\\b(you|your|yours)\\b"), we: countIn(text, "\\b(we|our|us|ours)\\b"), i: countIn(text, "\\b(i|my|me|mine)\\b"),
    devices: {
      tricolon: countIn(text, "\\b[\\w'’-]+(?: [\\w'’-]+)?, [\\w'’-]+(?: [\\w'’-]+)?,? and [\\w'’-]+\\b"),
      antithesis: countIn(text, "\\bnot\\b[^.?!\\n]{1,60}\\bbut\\b") + countIn(text, "\\b(rather than|instead of)\\b"),
      anaphora, questions: (text.match(/\?/g) || []).length, alliteration: allit,
    },
  };
}

export function locate(text, quote) {
  if (!quote) return null;
  let i = text.indexOf(quote); if (i >= 0) return [i, i + quote.length];
  const lo = text.toLowerCase(), q = quote.toLowerCase().trim(); i = lo.indexOf(q); if (i >= 0) return [i, i + q.length];
  const norm = q.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, " "); const map = []; let flat = "";
  for (let k = 0; k < lo.length; k++) { let c = lo[k].replace(/[“”]/, '"').replace(/[‘’]/, "'"); if (/\s/.test(c)) { if (flat.endsWith(" ")) continue; c = " "; } flat += c; map.push(k); }
  i = flat.indexOf(norm); if (i >= 0) return [map[i], map[Math.min(map.length - 1, i + norm.length - 1)] + 1];
  const head = norm.split(" ").slice(0, 6).join(" ");
  if (head.length > 15) { i = flat.indexOf(head); if (i >= 0) return [map[i], map[Math.min(map.length - 1, i + head.length - 1)] + 1]; }
  return null;
}

export function createEngine(MODEL) {
  const DIMS = MODEL.dimensions, LENSES = MODEL.lenses;
  const DIM = Object.fromEntries([...DIMS, ...LENSES].map(d => [d.id, d]));
  const MOVE = Object.fromEntries(MODEL.moves.map(m => [m.id, m]));
  const CT = Object.fromEntries(MODEL.content_types.map(c => [c.id, c]));
  const APP = Object.fromEntries(MODEL.appeals.map(a => [a.id, a]));
  const PV = Object.fromEntries(MODEL.perspectives.map(p => [p.id, p]));
  const LEVER = {}; for (const p of MODEL.perspectives) for (const l of p.levers) LEVER[l.id] = { ...l, perspective: p.id };
  const ARCH = Object.fromEntries(MODEL.archetypes.map(a => [a.id, a]));
  const ROLE = Object.fromEntries(MODEL.exec_roles.map(r => [r.id, r]));
  const FN = MODEL.duties;
  const FLAG = Object.fromEntries(MODEL.red_flags.map(f => [f.id, f]));
  const REF = {}; for (const k of Object.keys(MODEL.knowledge_refs)) for (const r of MODEL.knowledge_refs[k]) REF[r.id] = r;
  const MODS = MODEL.audience_modifiers.filter(m => m.id !== "archetype");
  /* ---------------- extra groups: craft, audience, culture ---------------- */
  const EXTRA = MODEL.extra_dimensions || [];
  const GROUPS = MODEL.groups || [];
  const GROUP = Object.fromEntries(GROUPS.map(g => [g.id, g]));
  for (const d of EXTRA) DIM[d.id] = d;
  const CUL = MODEL.culture || { countries: [], scales: [] };
  const COUNTRY = Object.fromEntries(CUL.countries.map(c => [c.id, c]));
  const SCALE_IDS = CUL.scales.map(s => s.id);
  const cl01 = v => Math.max(0, Math.min(1, v));

  function cultureProfile(id) {
    const c = COUNTRY[id];
    if (!c) return { id: "global", name: "Global or mixed audience", global: true, lewis: { linear: 1 / 3, multi: 1 / 3, reactive: 1 / 3 }, hofstede: null, targets: Object.fromEntries(SCALE_IDS.map(s => [s, 0.5])), tolerance: 0.3 };
    const { linear: L, multi: Mu, reactive: R } = c.lewis;
    const h = k => (c.hofstede[k] == null ? 0.5 : c.hofstede[k] / 100);
    const t = {
      context: cl01(0.6 * (0.85 * R + 0.45 * Mu + 0.05 * L) + 0.4 * (1 - h("idv"))),
      directness: cl01(0.75 * (0.9 * R + 0.35 * Mu + 0.05 * L) + 0.25 * (1 - h("idv"))),
      persuading: cl01(c.persuading),
      formality: cl01(0.65 * h("pdi") + 0.35 * (0.6 * R + 0.35 * Mu + 0.1 * L)),
      trust: cl01(0.6 * (0.9 * Mu + 0.8 * R + 0.1 * L) + 0.4 * (1 - h("idv"))),
      collective: cl01(1 - h("idv")),
      time: cl01(0.5 * (0.8 * Mu + 0.6 * R) + 0.5 * h("lto")),
      uncertainty: cl01(h("uai")),
      expressiveness: cl01(0.12 + 0.75 * Mu - 0.05 * R + 0.15 * (h("ivr") - 0.5)),
    };
    return { ...c, global: false, targets: t, tolerance: 0.14 };
  }
  function lewisLabel(l) {
    const names = { linear: "linear-active", multi: "multi-active", reactive: "reactive" };
    const s = Object.entries(l).sort((a, b) => b[1] - a[1]);
    if (s[0][1] < 0.45) return "A balanced blend of all three";
    return `Mostly ${names[s[0][0]]}` + (s[1][1] >= 0.2 ? `, with ${names[s[1][0]]} traits` : "");
  }
  const share = (hi, lo, a = 1) => (hi + a) / (hi + lo + 2 * a);
  const CUE = {
    explicit: "\\b(to be clear|in short|in summary|the point is|specifically|this means|that is|i\\.e\\.|we recommend|my (ask|recommendation)|in other words|to summarise|to summarize)\\b",
    implicit: "\\b(perhaps|it may be|one might|it seems|we wonder|it could be|as you (may|might) know|as you know|needless to say|you will appreciate)\\b",
    direct: "\\b(you must|you need to|you should|we need|wrong|fail(ed|ure)?|problem|unacceptable|immediately|do not|don'?t|no\\b)",
    indirect: "\\b(perhaps|might|would you|could we|could you|may i|i wonder|if possible|kindly|we would be grateful|it would be helpful|would it be possible|if convenient|when you have a moment)\\b",
    principle: "\\b(because|why|principle|theory|research|evidence|framework|concept|the reason|fundamental|logic|in principle)\\b",
    application: "\\b(for example|for instance|here'?s how|step|case|in practice|we did|results|tried|practical|how to|example)\\b",
    informal: "\\b(hi|hey|thanks|cheers|guys|awesome|super|cool|great|stuff|gonna|wanna|folks)\\b|[a-z]'(ll|re|ve|d|s)\\b|n't\\b|!",
    formal: "\\b(dear|mr|ms|mrs|dr|professor|respectfully|kindly|sincerely|regards|esteemed|honoured|honored|we would be grateful|please find|i remain|yours faithfully|yours sincerely)\\b",
    task: "\\b(results|deliverables?|roi|deadline|efficien\\w*|cost|scope|data|kpis?|metrics?|output|performance|budget)\\b|\\d+\\s?%",
    relationship: "\\b(relationship|partnership|partner|long-term|together|trust|meet|coffee|lunch|dinner|family|personally|get to know|honoured|honored|introduce|friend|our people|community)\\b",
    individual: "\\b(you|your|yours|i|my|me|individual|personal|own|stand out|achieve|your career|yourself)\\b",
    collective: "\\b(we|our|us|team|together|community|everyone|group|colleagues|family|society|all of us|shared)\\b",
    urgent: "\\b(now|today|deadline|immediately|asap|this week|by (monday|tuesday|wednesday|thursday|friday)|limited|quick(ly)?|fast|don'?t wait|hurry|right away)\\b",
    longterm: "\\b(long-term|long term|over time|future|years|generations|patient|patience|sustainable|lasting|journey|legacy|for decades)\\b",
    detail: "\\b(guarantee\\w*|step|process|plan|risk|specifically|exactly|detailed|ensure|proven|certified|warranty|contract|terms|procedure|timeline|milestone|schedule)\\b",
    intens: "\\b(really|so|incredibly|amazing|absolutely|totally|fantastic|wonderful|love|thrilled|delighted|passionate|exciting|excited)\\b",
  };
  const IDIOMS = "\\b(touch base|circle back|ballpark|home run|out of the park|slam dunk|move the needle|low-hanging fruit|piece of cake|on the same page|ducks in a row|run it up the flagpole|boil the ocean|drink(ing)? from (a|the) fire ?hose|bite the bullet|back to square one|ball is in your court|par for the course|go the extra mile|think outside the box|game-?changer|deep dive|wheelhouse|bandwidth|knock it out|quick win|level the playing field|the whole nine yards|hail mary|curveball|step up to the plate|cover all the bases|cost an arm and a leg|once in a blue moon|cut corners|hit the ground running|ahead of the curve|since sliced bread|elephant in the room|get the ball rolling|on the ball|pull out all the stops|pinch of salt|no-brainer|ballgame|level up|crush it|nail it|full-court press|monday morning quarterback|punt)\\b";

  function culturePositions(text, S) {
    const W = Math.max(1, wordCount(text)), cut = Math.floor(text.length * 0.4), head = text.slice(0, cut);
    const n = p => countIn(text, p);
    const emo = countIn(text, `\\b(${POS}|${NEG})\\b`);
    return {
      context: share(n(CUE.implicit), n(CUE.explicit) + (text.match(/^\s*([-•*]|\d+[.)])\s/gm) || []).length * 0.5),
      directness: share(n(CUE.indirect), n(CUE.direct)),
      persuading: share(countIn(head, CUE.principle), countIn(head, CUE.application)),
      formality: share(n(CUE.formal) * 1.5, n(CUE.informal) * 0.6),
      trust: share(n(CUE.relationship), n(CUE.task)),
      collective: share(n(CUE.collective), n(CUE.individual) * 0.7),
      time: share(n(CUE.longterm), n(CUE.urgent)),
      uncertainty: cl01(((n(CUE.detail) + (text.match(/\d/g) || []).length * 0.15) / W) * 100 / 4),
      expressiveness: cl01((((text.match(/!/g) || []).length * 2 + emo + n(CUE.intens)) / W) * 100 / 10),
    };
  }
  const ACRO_OK = new Set("UK US USA EU UN CEO CFO COO CTO CIO CMO CHRO CRO HR AI OK PDF FAQ NHS BBC TV PM AM ID IT CV PR ROI GDP NGO UAE SME B2B B2C AM PM Q1 Q2 Q3 Q4 FY HQ IPO API URL USB".split(" "));
  const LEN_TARGET = MODEL.length_targets || {};
  function extraScan(text, S, ctx, c, base, flags, prof, pos) {
    const scores = {}, notes = {}, hl = [];
    const W = Math.max(1, wordCount(text));
    const add = (s, dim, pol, note) => hl.push({ start: s.start, end: s.end, quote: s.text, dimension: dim, appeal: DIM[dim].group, polarity: pol, note, source: "quick" });
    const paras = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    // structure
    let st = 0; const first2 = S.slice(0, 2).map(s => s.text).join(" ");
    if (/\b(recommend|propose|we can|you can|ask|decision|the point|in short|here'?s|what if)\b|\?/i.test(first2) || (S[0] && S[0].words <= 18 && /\byou(r)?\b/i.test(S[0].text))) st++;
    const spp = S.length / Math.max(1, paras.length); if (spp <= 4) st++;
    if (W < 300 || /^\s*([-•*]|\d+[.)])\s/m.test(text) || paras.some(p => p.length < 70 && !/[.!?]$/.test(p))) st++;
    if ((base.kai_call ?? 0) >= 3) st++;
    scores.craft_structure = clamp(st); notes.craft_structure = `${paras.length} paragraphs, about ${spp.toFixed(1)} sentences each.`;
    // length
    const [lo, hi] = LEN_TARGET[ctx.contentType] || [80, 900]; let ls = 4;
    if (W > hi) { const r = W / hi; ls = r < 1.3 ? 3 : r < 1.7 ? 2 : r < 2.5 ? 1 : 0; }
    else if (W < lo) { const r = W / lo; ls = r > 0.75 ? 3 : r > 0.5 ? 2 : r > 0.3 ? 1 : 0; }
    scores.craft_length = ls; notes.craft_length = `${W} words; typical range for this content type is ${lo} to ${hi}.`;
    // clarity
    const exp = ctx.audience.expertise || "informed";
    const fogT = ctx.contentType === "social_post" ? 8 : exp === "novice" ? 9 : exp === "expert" ? 14 : isExec(ctx) ? 12 : 11;
    let cs = 4 - Math.max(0, (c.gunning_fog - fogT) / 2);
    if (c.passive_pct > 15) cs -= 1;
    const longS = S.filter(s => s.words > 28); if (S.length > 3 && longS.length / S.length > 0.2) cs -= 1;
    const nom = countIn(text, "\\b\\w{4,}(tion|ment|ness|ity|ance|ence)s?\\b"); if ((nom / W) * 100 > 4) cs -= 1;
    scores.craft_clarity = clamp(cs); notes.craft_clarity = `Fog ${c.gunning_fog} (aim under ${fogT}), ${c.passive_pct}% passive, ${longS.length} long sentences.`;
    for (const s of longS.slice(0, 4)) add(s, "craft_clarity", "weakness", `${s.words} words. Split it.`);
    // cohesion
    const CONN = "\\b(however|therefore|because|so|also|first|then|finally|for example|as a result|this means|in contrast|meanwhile|next|but|instead|which means|that'?s why|in short|for instance|similarly|still|yet)\\b";
    const conn = S.filter(s => countIn(s.text, CONN) > 0).length / Math.max(1, S.length);
    const cw = s => new Set((s.text.toLowerCase().match(/[a-z]{5,}/g) || []).filter(w => !STOP.has(w)));
    let ov = 0; for (let k = 1; k < S.length; k++) { const a = cw(S[k - 1]), b = cw(S[k]); if ([...b].some(w => a.has(w))) ov++; }
    const ovr = ov / Math.max(1, S.length - 1);
    scores.craft_cohesion = S.length < 4 ? 3 : clamp((conn >= 0.35 ? 2 : conn >= 0.2 ? 1.5 : conn >= 0.1 ? 1 : 0.5) + (ovr >= 0.45 ? 2 : ovr >= 0.3 ? 1.5 : ovr >= 0.15 ? 1 : 0.5));
    notes.craft_cohesion = `${Math.round(conn * 100)}% of sentences use a linking word; ${Math.round(ovr * 100)}% pick up a word from the sentence before.`;
    // tone
    const FORMAL_CT = { cv_resume: 0.7, sales_proposal: 0.7, exec_briefing: 0.7, press_release: 0.7, cover_letter: 0.7, social_post: 0.3, sales_email: 0.45 };
    const want = 0.5 * (FORMAL_CT[ctx.contentType] ?? 0.5) + 0.5 * prof.targets.formality;
    const pf = paras.map(p => share(countIn(p, CUE.formal) * 1.5, countIn(p, CUE.informal) * 0.6));
    const spread = pf.length > 1 ? Math.max(...pf) - Math.min(...pf) : 0;
    let ts = 4 - Math.max(0, Math.abs(pos.formality - want) - 0.15) * 8 - (spread > 0.45 ? 1 : 0) - ((text.match(/!/g) || []).length > 2 ? 1 : 0);
    scores.craft_tone = clamp(ts); notes.craft_tone = `Formality ${Math.round(pos.formality * 100)} of 100; this reader and form expect about ${Math.round(want * 100)}.`;
    // claims
    let pen = 0;
    for (const s of S) {
      if (/\d+(\.\d+)?\s?%|\b\d+x\b|\btimes (more|faster|better)\b/i.test(s.text) && !/\b(according|source|survey|study|research|n=|report|data from)\b|\(\d{4}\)/i.test(s.text)) { pen += 0.5; add(s, "craft_claims", "weakness", "A figure with no source. Say where it comes from."); }
      if (/\b(the best|leading|number one|#1|unrivall?ed|world-?class|guarantee[ds]?|proven|never fails|always works|better than)\b/i.test(s.text)) { pen += 0.75; add(s, "craft_claims", "weakness", "A claim you may be asked to prove."); }
    }
    scores.craft_claims = clamp(4 - pen); notes.craft_claims = pen ? "Some claims would need support if challenged." : "No obviously unsupported claims found.";
    // audience: suitability
    const fogAud = exp === "novice" ? 9 : exp === "expert" ? 14 : 12, dd = c.gunning_fog - fogAud;
    let fs = dd <= 0 ? 4 : dd <= 2 ? 3 : dd <= 4 ? 2 : dd <= 6 ? 1 : 0;
    let roleHit = 0; if (ctx.role && ROLE[ctx.role]) { const words = ROLE[ctx.role].cares_about.join(" ").toLowerCase().match(/[a-z]{4,}/g) || []; roleHit = words.some(w => text.toLowerCase().includes(w)) ? 0.5 : 0; }
    scores.aud_suitability = clamp(0.6 * fs + 0.4 * (base.eth_goodwill ?? 2) + roleHit);
    notes.aud_suitability = `Reading level Fog ${c.gunning_fog} for a ${exp} reader (aim ${fogAud} or under).`;
    // hook
    const opening = S.find(s => !/^(subject:|hi\b|hello\b|dear\b|hey\b)/i.test(s.text) && s.words > 2) || S[0];
    let hk = 2;
    if (opening) {
      if (/\byou(r)?\b/i.test(opening.text)) hk++;
      if (/\d|\?|what if|\b[A-Z][a-z]+ [A-Z][a-z]+/.test(opening.text.slice(1))) hk++;
      if (/\b(hope (this|you)|my name is|i am writing|i'?m writing|welcome to|we are a|allow me|just wanted|i wanted to reach out|i'?m reaching out|as you (may )?know)\b/i.test(opening.text)) { hk -= 2; add(opening, "aud_hook", "weakness", "Throat-clearing. Open with the reader's situation instead."); }
      if (opening.words > 25) hk--;
    }
    scores.aud_hook = clamp(hk); notes.aud_hook = opening ? `Opening line: ${opening.words} words.` : "";
    // knowledge
    const acr = [...new Set((text.match(/\b[A-Z]{2,6}s?\b/g) || []).map(a => a.replace(/s$/, "")))].filter(a => !ACRO_OK.has(a) && !new RegExp(`\\(${a}\\)|${a}\\s*\\(`).test(text));
    const jar = countIn(text, "\\b(synerg\\w*|leverag\\w*|holistic|paradigm|ecosystem|end-to-end|best-of-breed|value-add\\w*|operationali[sz]\\w*|ideat\\w*|actionable|learnings|deliverables|stakeholder alignment|bandwidth|scalab\\w*)\\b");
    const half = exp === "expert" ? 0.5 : 1;
    scores.aud_knowledge = clamp(4 - acr.length * 0.75 * half - (jar / W) * 1000 / 6 * half);
    notes.aud_knowledge = acr.length ? `Undefined acronyms: ${acr.slice(0, 6).join(", ")}.` : "No undefined acronyms found.";
    // inclusivity
    const INC = "\\b(guys|chairman|chairmen|manpower|mankind|man-hours|businessman|businessmen|salesman|salesmen|foreman|crazy|insane|lame|dumb|tone-deaf|crippl\\w*|psycho|spaz|retard\\w*|wheelchair-bound|suffers from|digital natives|young and dynamic)\\b";
    let inc = 0; for (const s of S) { const k = countIn(s.text, INC); if (k) { inc += k; add(s, "aud_inclusivity", "weakness", "Language some readers may find exclusionary."); } }
    scores.aud_inclusivity = clamp(4 - inc * 0.75); notes.aud_inclusivity = inc ? `${inc} term${inc > 1 ? "s" : ""} to reconsider.` : "No exclusionary terms found.";
    // culture scales
    for (const sid of SCALE_IDS) {
      const d = Math.max(0, Math.abs(pos[sid] - prof.targets[sid]) - prof.tolerance);
      scores["cul_" + sid] = clamp(4 - d * 13);
      notes["cul_" + sid] = `Text ${Math.round(pos[sid] * 100)}, reader expects about ${Math.round(prof.targets[sid] * 100)} (0 = ${CUL.scales.find(s => s.id === sid).low.split(":")[0].toLowerCase()}, 100 = ${CUL.scales.find(s => s.id === sid).high.split(":")[0].toLowerCase()}).`;
    }
    let idi = 0; for (const s of S) { const k = countIn(s.text, IDIOMS); if (k) { idi += k; add(s, "cul_idiom", "weakness", "An idiom that may not travel or translate."); } }
    const idw = prof.global || ctx.culture?.writer !== ctx.culture?.reader ? 1 : 0.5;
    scores.cul_idiom = clamp(4 - idi * idw * (idi > 3 ? 1 : 0.8)); notes.cul_idiom = idi ? `${idi} idiom${idi > 1 ? "s" : ""} that may not travel.` : "No culture-bound idioms found.";
    return { scores, notes, highlights: hl };
  }
  const appealOf = id => (DIM[id] ? DIM[id].appeal || "lenses" : null);
  const thinkers = g => ((g && g.thinkers) || []).map(id => (REF[id] ? REF[id].name : id));
  const isExec = ctx => ["exec_briefing", "sales_proposal", "pitch_deck"].includes(ctx.contentType) || !!ctx.role;

  function effectiveWeights(ctx) {
    const w = { ...CT[ctx.contentType].weights };
    const add = d => { for (const a of APPEALS) w[a] += (d && d[a]) || 0; };
    for (const m of MODS) add(m.options.find(o => o.id === ctx.audience[m.id])?.weight_delta);
    add(ARCH[ctx.archetype]?.weight_delta);
    const cp = cultureProfile(ctx.culture?.reader);
    if (!cp.global) {
      const d = { linear: [-0.02, -0.04, 0.08, 0], multi: [0, 0.08, -0.05, -0.02], reactive: [0.08, -0.05, 0, -0.05] };
      for (const pole of ["linear", "multi", "reactive"]) { const k = (cp.lewis[pole] - 1 / 3) * 0.6; APPEALS.forEach((a, i) => (w[a] += k * d[pole][i])); }
    }
    for (const a of APPEALS) w[a] = Math.max(0.04, w[a]);
    const t = APPEALS.reduce((s, a) => s + w[a], 0);
    for (const a of APPEALS) w[a] = +(w[a] / t).toFixed(3);
    return w;
  }

  function fnTarget(ctx) {
    const a = ARCH[ctx.archetype], r = ctx.role ? ROLE[ctx.role] : null;
    const p = r ? r.primary : a?.primary, s = r ? r.secondary : a?.secondary;
    if (!p) return null;
    return Object.fromEntries(FN.map(f => [f.id, f.id === p ? 40 : f.id === s ? 25 : 12]));
  }

  function quickScan(text, ctx) {
    const S = splitSentences(text), W = Math.max(1, wordCount(text)), per = n => (n * 1000) / W;
    const scores = {}, notes = {}, hl = [];
    const addHl = (s, dim, pol, note) => hl.push({ start: s.start, end: s.end, quote: s.text, dimension: dim, appeal: appealOf(dim), polarity: pol, note, source: "quick" });
    const avgLen = S.length ? S.reduce((a, s) => a + s.words, 0) / S.length : 0;
    const longS = S.filter(s => s.words > 30);
    const c = craft(text, S);

    for (const d of [...DIMS, ...LENSES]) {
      const h = d.heuristic || {};
      if (h.ratio) {
        const you = countIn(text, h.ratio.num), we = countIn(text, h.ratio.den), r = you / (we + 1);
        scores[d.id] = r >= h.ratio.ideal ? 4 : r >= 1 ? 3 : r >= 0.5 ? 2 : r >= 0.2 ? 1 : 0;
        notes[d.id] = `About the reader ${you} times, about the author ${we} times.`;
        let k = 0; for (const s of S) if (/^(we|our|i|my)\b/i.test(s.text) && k < 6) { addHl(s, d.id, "weakness", "Starts with the author, not the reader."); k++; }
        continue;
      }
      if (h.readability) {
        let sc = avgLen <= 15 ? 4 : avgLen <= 20 ? 3 : avgLen <= 25 ? 2 : avgLen <= 32 ? 1 : 0;
        if (S.length > 3 && longS.length / S.length > 0.25) sc -= 1;
        if (d.id === "lens_prepon") {
          if (isExec(ctx) && c.gunning_fog > 12) sc -= 1;
          if (["social_post", "sales_email"].includes(ctx.contentType) && (avgLen > 18 || W > 400)) sc -= 1;
          if (["cv_resume", "exec_briefing", "press_release", "cover_letter"].includes(ctx.contentType) && countIn(text, FLAG.rf_false_urgency.pattern)) sc -= 1;
          notes[d.id] = `Gunning Fog ${c.gunning_fog}${isExec(ctx) ? " (aim under 12 for executives)" : ""}; average sentence ${avgLen.toFixed(0)} words.`;
        } else notes[d.id] = `Average sentence ${avgLen.toFixed(0)} words; ${longS.length} over 30 words.`;
        scores[d.id] = clamp(sc);
        if (d.id === "log_clarity") for (const s of longS.slice(0, 6)) addHl(s, d.id, "weakness", `${s.words} words. Split it.`);
        continue;
      }
      let pos = 0, neg = 0; const posS = [], negS = [];
      for (const s of S) {
        let p = 0, n = 0;
        for (const pat of h.pos || []) p += countIn(s.text, pat);
        for (const pat of h.neg || []) n += countIn(s.text, pat);
        if (p) posS.push(s); if (n) negS.push(s); pos += p; neg += n;
      }
      const base = h.base ?? 1, target = h.target_per_k || 5; let sc;
      if (h.cta) {
        const tail = text.length * 0.7;
        sc = posS.length ? 2 : negS.length ? 1 : 0;
        if (posS.some(s => s.start >= tail)) sc = 3;
        if (posS.some(s => s.start >= tail && /\b(\d+|minute|minutes|today|tomorrow|this week|next week|by \w+day|free)\b/i.test(s.text))) sc = 4;
        if (negS.length && !posS.some(s => s.start >= tail)) sc = Math.min(sc, 1);
        notes[d.id] = posS.length ? `${posS.length} call${posS.length > 1 ? "s" : ""} to action found.` : "No clear call to action found.";
      } else {
        sc = base + (4 - base) * Math.min(1, per(pos) / target) * Math.min(1, pos / 2);
        if (h.structure) {
          const lines = text.split("\n").map(l => l.trim());
          const heads = lines.filter((l, i) => l && l.length < 70 && !/[.!?:,;]$/.test(l) && l.split(/\s+/).length <= 9 && lines[i + 1] !== undefined).length;
          sc += Math.min(1, heads * 0.34); if (W < 150) sc = Math.max(sc, 2);
        }
        sc -= Math.min(3, (per(neg) * (h.neg_weight || 1)) / 4);
        notes[d.id] = `${pos} supporting signal${pos === 1 ? "" : "s"}${(h.neg || []).length ? `, ${neg} weakening` : ""}.`;
      }
      scores[d.id] = clamp(sc);
      for (const s of posS.slice(0, 8)) addHl(s, d.id, "strength", d.name);
      for (const s of negS.slice(0, 6)) addHl(s, d.id, "weakness", (d.negative_signals || [])[0] || "Weakens " + d.name.toLowerCase());
    }

    const flags = [];
    for (const f of MODEL.red_flags) {
      const re = new RegExp(f.pattern, "gimu"); let m;
      while ((m = re.exec(text)) && flags.length < 40) {
        flags.push({ id: f.id, quote: m[0], start: m.index, end: m.index + m[0].length, severity: f.severity, note: f.description, source: "quick" });
        hl.push({ start: m.index, end: m.index + m[0].length, quote: m[0], dimension: f.dimension, appeal: appealOf(f.dimension), polarity: "weakness", flag: f.id, note: f.name + ": " + f.description, source: "quick" });
      }
    }
    const pen = {}; for (const f of flags) pen[f.dimension] = (pen[f.dimension] || 0) + (f.severity === "high" ? 2 : 1);
    for (const [d, p] of Object.entries(pen)) { scores[d] = Math.max(0, scores[d] - Math.min(3, p)); notes[d] = (notes[d] || "") + ` Lowered by ${p > 1 ? "red flags" : "a red flag"}.`; }

    const fnRaw = Object.fromEntries(FN.map(f => [f.id, 0]));
    for (const s of S) for (const f of FN) { let n = 0; for (const p of f.pos) n += countIn(s.text, p); if (n) fnRaw[f.id] += Math.min(2, n) * Math.max(1, s.words / 12); }
    const ft = Object.values(fnRaw).reduce((a, b) => a + b, 0);
    const fns = Object.fromEntries(FN.map(f => [f.id, ft ? Math.round((100 * fnRaw[f.id]) / ft) : Math.round(100 / FN.length)]));

    const levers = {};
    for (const p of MODEL.perspectives) for (const l of p.levers) {
      if (!l.quick) { levers[l.id] = { status: "unknown" }; continue; }
      let hit = null; for (const s of S) { for (const pat of l.quick) if (countIn(s.text, pat)) { hit = s.text; break; } if (hit) break; }
      levers[l.id] = hit ? { status: "present", quote: hit.slice(0, 140) } : { status: "absent" };
    }
    for (const f of flags) { const lv = FLAG_LEVER[f.id]; if (lv) levers[lv] = { status: "misused", quote: f.quote, note: FLAG[f.id].name }; }
    const pvScores = {};
    for (const p of MODEL.perspectives) {
      const q = p.levers.filter(l => l.quick || levers[l.id].status === "misused");
      const present = q.filter(l => levers[l.id].status === "present").length, mis = p.levers.filter(l => levers[l.id].status === "misused").length;
      pvScores[p.id] = q.length ? clamp((4 * present) / Math.max(2, q.length) - mis) : null;
    }
    const prof = cultureProfile(ctx.culture?.reader), writer = ctx.culture?.writer ? cultureProfile(ctx.culture.writer) : null;
    const cpos = culturePositions(text, S);
    const ex = extraScan(text, S, ctx, c, scores, flags, prof, cpos);
    Object.assign(scores, ex.scores); Object.assign(notes, ex.notes); hl.push(...ex.highlights);
    return { scores, notes, highlights: hl, flags, fns, levers, pvScores, craft: c, sentences: S, words: W, culture: { reader: prof, writer, positions: cpos } };
  }

  function libraryRecs(scores, hl, ctx) {
    const recs = [], prio = CT[ctx.contentType].priority_dimensions;
    const groups = { ethos: [], pathos: [], logos: [], kairos: [], lenses: LENSES };
    for (const d of DIMS) groups[d.appeal].push(d);
    for (const g of GROUPS) groups[g.id] = EXTRA.filter(d => d.group === g.id);
    for (const [ap, ds] of Object.entries(groups)) {
      const rank = d => scores[d.id] - (prio.includes(d.id) ? 1 : 0);
      const weak = ds.filter(d => scores[d.id] <= 2).sort((a, b) => rank(a) - rank(b)).slice(0, ap === "lenses" ? 2 : 3);
      for (const d of weak) {
        const w = hl.find(h => h.dimension === d.id && h.polarity === "weakness");
        if (!d.moves || !d.moves.length) {
          if (!d.advice) continue;
          recs.push({ appeal: ap, dimension: d.id, move: null, issue: `${d.name} scores ${scores[d.id]} of 4. ${d.advice}`, original: w ? w.quote : d.example?.before || "", rewrite: d.example?.after || "", impact: prio.includes(d.id) ? "high" : scores[d.id] <= 1 ? "medium" : "low", source: "library", example: !w });
          continue;
        }
        const m = MOVE[d.moves[0]];
        recs.push({ appeal: ap, dimension: d.id, move: m.id, issue: `${d.name} scores ${scores[d.id]} of 4. ${m.how}`, original: w ? w.quote : m.example.before, rewrite: m.example.after, impact: prio.includes(d.id) ? "high" : scores[d.id] <= 1 ? "medium" : "low", source: "library", example: !w });
      }
    }
    return recs;
  }

  function appealScore(ap, sc, ctx) {
    const prio = CT[ctx.contentType].priority_dimensions; let n = 0, d = 0;
    for (const dim of DIMS.filter(x => x.appeal === ap)) { const w = dim.weight * (prio.includes(dim.id) ? 1.5 : 1); n += (sc[dim.id] ?? 0) * w; d += 4 * w; }
    let v = Math.round((100 * n) / d);
    for (const c of MODEL.scoring.integrity_caps || []) if (c.appeal === ap && (sc[c.dimension] ?? 4) <= c.if_at_most) v = Math.min(v, c.cap);
    return v;
  }
  const bandOf = v => MODEL.scoring.bands.find(b => v >= b.min && v <= b.max)?.label || "";

  function balanceFindings(s, sc) {
    const R = Object.fromEntries(MODEL.balance_rules.map(r => [r.id, r])), out = [];
    if (s.pathos - s.logos > 25) out.push(R.br_hype);
    if (s.logos - s.pathos > 30) out.push(R.br_dry);
    if (s.ethos < 40 && (s.pathos > 60 || s.logos > 60)) out.push(R.br_credibility_gap);
    if ((sc.eth_goodwill ?? 4) <= 1) out.push(R.br_all_about_me);
    if ((sc.kai_call ?? 4) <= 1) out.push(R.br_no_ask);
    if ((sc.kai_stakes ?? 0) >= 3 && (sc.kai_efficacy ?? 4) <= 1) out.push(R.br_doom);
    if (s.kairos < 35) out.push(R.br_timeless);
    return out.filter(Boolean).map(r => ({ id: r.id, name: r.name, message: r.message }));
  }

  function appealShare(S, hl) {
    const words = { ethos: 0, pathos: 0, logos: 0, kairos: 0, neutral: 0 };
    for (const s of S) {
      const c = { ethos: 0, pathos: 0, logos: 0, kairos: 0 };
      for (const h of hl) if (h.polarity === "strength" && c[h.appeal] !== undefined && h.start < s.end && h.end > s.start) c[h.appeal]++;
      const best = APPEALS.reduce((b, a) => (c[a] > c[b] ? a : b), "ethos");
      words[c[best] ? best : "neutral"] += s.words;
    }
    const t = Object.values(words).reduce((a, b) => a + b, 0) || 1;
    return Object.fromEntries(Object.entries(words).map(([k, v]) => [k, Math.round((100 * v) / t)]));
  }

  function dedupeFlags(f) {
    const seen = new Set();
    return f.filter(x => { const k = x.id + "|" + (x.quote || "").toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  }

  // Combine the quick scan with whatever AI judge outputs have arrived.
  function assemble(text, ctx, q, ai = {}, source = null) {
    const sc = { ...q.scores }, why = { ...q.notes }, src = Object.fromEntries(Object.keys(sc).map(k => [k, "quick"]));
    let hl = [], recs = []; const flags = [...q.flags], summaries = {};
    const lib = libraryRecs(sc, q.highlights, ctx);
    for (const g of ["ethos", "pathos", "logos", "kairos", "lenses", ...GROUPS.map(x => x.id)]) {
      const out = ai[g];
      if (out) {
        summaries[g] = out.summary || "";
        for (const d of out.dimension_scores || []) if (DIM[d.id]) { sc[d.id] = clamp(+d.score || 0); why[d.id] = d.rationale; src[d.id] = "ai"; }
        for (const h of out.highlights || []) { const at = locate(text, h.quote); if (at && DIM[h.dimension]) hl.push({ start: at[0], end: at[1], quote: h.quote, dimension: h.dimension, appeal: appealOf(h.dimension), polarity: h.polarity === "weakness" ? "weakness" : "strength", note: h.note || "", source: "ai" }); }
        for (const r of out.recommendations || []) if (DIM[r.dimension]) recs.push({ appeal: g, dimension: r.dimension, move: MOVE[r.move] ? r.move : null, issue: r.issue, original: r.original || "", rewrite: r.rewrite, impact: r.impact || "medium", source: "ai" });
        for (const f of out.red_flags || []) if (FLAG[f.id]) { const at = locate(text, f.quote); flags.push({ id: f.id, quote: f.quote, start: at?.[0], end: at?.[1], severity: FLAG[f.id].severity, note: f.note, source: "ai" }); }
      } else {
        hl.push(...q.highlights.filter(h => (h.appeal || "lenses") === g && !h.flag));
        recs.push(...lib.filter(r => r.appeal === g));
      }
    }
    hl.push(...q.highlights.filter(h => h.flag));

    let fns = q.fns, fnSource = "quick";
    const sf = ai.lenses?.duties;
    if (sf) { const t = FN.reduce((a, f) => a + (+sf[f.id] || 0), 0); if (t > 0) { fns = Object.fromEntries(FN.map(f => [f.id, Math.round((100 * (+sf[f.id] || 0)) / t)])); fnSource = "ai"; } }

    let levers = q.levers, pvScores = q.pvScores; const pvSummaries = {}; let pvSource = "quick";
    if (ai.influence && Array.isArray(ai.influence.perspectives)) {
      levers = { ...q.levers }; pvScores = { ...q.pvScores }; pvSource = "ai";
      for (const p of ai.influence.perspectives) if (PV[p.id]) {
        pvScores[p.id] = clamp(+p.score || 0); pvSummaries[p.id] = p.summary || "";
        for (const l of p.levers || []) if (LEVER[l.id]) levers[l.id] = { status: ["present", "absent", "misused", "not_applicable"].includes(l.status) ? l.status : "absent", quote: l.quote || "", note: l.note || "" };
      }
      for (const r of ai.influence.recommendations || []) if (DIM[r.dimension]) recs.push({ appeal: "influence", dimension: r.dimension, move: MOVE[r.move] ? r.move : null, issue: r.issue, original: r.original || "", rewrite: r.rewrite, impact: r.impact || "medium", source: "ai" });
    }

    const groupScores = {};
    for (const g of GROUPS) { const ds = EXTRA.filter(d => d.group === g.id); groupScores[g.id] = Math.round((100 * ds.reduce((t, d) => t + (sc[d.id] ?? 0), 0)) / (4 * ds.length)); }
    const cq = q.culture, aiPos = ai.culture?.text_positions;
    const positions = { ...cq.positions }; if (aiPos) for (const k of SCALE_IDS) if (typeof aiPos[k] === "number") positions[k] = cl01(aiPos[k]);
    const gaps = cq.writer && !cq.writer.global && !cq.reader.global && cq.writer.id !== cq.reader.id
      ? SCALE_IDS.map(k => ({ scale: k, writer: cq.writer.targets[k], reader: cq.reader.targets[k], diff: cq.reader.targets[k] - cq.writer.targets[k] })).filter(x => Math.abs(x.diff) >= 0.2).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
      : [];
    const culture = { reader: { id: cq.reader.id, name: cq.reader.name, global: cq.reader.global, lewis: cq.reader.lewis, lewis_label: lewisLabel(cq.reader.lewis), hofstede: cq.reader.hofstede, targets: cq.reader.targets, tolerance: cq.reader.tolerance },
      writer: cq.writer ? { id: cq.writer.id, name: cq.writer.name, lewis: cq.writer.lewis, targets: cq.writer.targets } : null, positions, gaps, source: aiPos ? "ai" : "quick" };
    const s = {}; for (const a of APPEALS) s[a] = appealScore(a, sc, ctx);
    const w = effectiveWeights(ctx);
    const overall = Math.round(APPEALS.reduce((t, a) => t + s[a] * w[a], 0));
    const tot = APPEALS.reduce((t, a) => t + s[a], 0) || 1;
    const balance = Math.round(100 - 100 * 0.5 * APPEALS.reduce((t, a) => t + Math.abs(s[a] / tot - w[a]), 0));
    const target = fnTarget(ctx);
    const fit = target ? Math.round(100 - (50 * FN.reduce((t, f) => t + Math.abs(fns[f.id] - target[f.id]), 0)) / 100) : null;
    const primary = FN.reduce((b, f) => (fns[f.id] > fns[b] ? f.id : b), FN[0].id);
    hl.sort((a, b) => a.start - b.start);
    return {
      model_version: MODEL.meta.version, mode: Object.keys(ai).length ? "full" : "quick", content_type: ctx.contentType,
      audience: { archetype: ctx.archetype, role: ctx.role || null, ...ctx.audience }, effective_weights: w,
      scores: { overall, band: bandOf(overall), balance_index: balance, ...s },
      lenses: Object.fromEntries(LENSES.map(l => [l.id, sc[l.id] * 25])),
      duties: { profile: fns, primary, target, fit, source: fnSource },
      appeal_share: appealShare(q.sentences, hl), craft: q.craft,
      group_scores: groupScores, culture,
      dimensions: [...DIMS, ...LENSES, ...EXTRA].map(d => ({ id: d.id, appeal: appealOf(d.id), score: sc[d.id], rationale: why[d.id], source: src[d.id] })),
      perspectives: MODEL.perspectives.map(p => ({ id: p.id, score: pvScores[p.id], summary: pvSummaries[p.id] || "", levers: p.levers.map(l => ({ id: l.id, ...levers[l.id] })) })),
      perspectives_source: pvSource, highlights: hl, recommendations: recs,
      balance_findings: balanceFindings(s, sc), red_flags: dedupeFlags(flags), judges: summaries, source,
    };
  }

  function toApi(r) {
    if (!r) return null;
    return { ...r, highlights: r.highlights.map(({ source, ...h }) => h), recommendations: r.recommendations.map(({ source, example, ...x }) => x) };
  }

  function audienceText(ctx) {
    const lines = MODS.map(m => { const o = m.options.find(o => o.id === ctx.audience[m.id]); return `- ${m.name}: ${o.label}. ${o.guidance}`; });
    const a = ARCH[ctx.archetype];
    if (a && a.primary) lines.unshift(`- Archetype: ${a.name} ("${a.motto}"). ${a.basis}. Values: ${a.values}. Style: ${a.style}. Persuaded by: ${a.persuaded_by.join(", ")}. Put off by: ${a.backfires.join(", ")}. Key question: ${a.key_question}`);
    const cp = cultureProfile(ctx.culture?.reader);
    if (!cp.global) {
      const exp = SCALE_IDS.map(k => { const s = CUL.scales.find(x => x.id === k), v = cp.targets[k]; return v < 0.38 ? s.low.split(":")[0].toLowerCase() : v > 0.62 ? s.high.split(":")[0].toLowerCase() : null; }).filter(Boolean);
      lines.unshift(`- Reader culture: ${cp.name}. ${lewisLabel(cp.lewis)} (Lewis model). Expect: ${exp.join(", ") || "a balanced style"}. Treat this as a starting point, not a stereotype.`);
      if (ctx.culture?.writer && ctx.culture.writer !== cp.id) { const wp = cultureProfile(ctx.culture.writer); lines.unshift(`- Writer culture: ${wp.name}. Watch for habits from the writer's culture that read differently in ${cp.name}.`); }
    }
    if (ctx.role) { const r = ROLE[ctx.role]; lines.unshift(`- Role: ${r.name}. Their decision question: ${r.question} They care about: ${r.cares_about.join(", ")}. Red flags for them: ${r.red_flags.join(", ")}.`); }
    return lines.join("\n");
  }
  const contentBlock = text => (text.length > 40000 ? text.slice(0, 40000) + "\n[truncated]" : text);

  function judgePrompt(g, text, ctx) {
    const j = MODEL.judges.find(x => x.appeal === g), ct = CT[ctx.contentType], w = effectiveWeights(ctx);
    const name = g === "lenses" ? "lenses and rhetorical duties" : g === "influence" ? "influence panel" : g === "craft" ? "craft editor" : g;
    const head = `You are the ${name} judge in HowDoesThisLand, a persuasion assessment model based on Aristotle's Rhetoric (plus kairos) and modern influence research.
Persona: ${j.persona}
Task: ${j.instruction}

Rules:
${j.rules.map(r => "- " + r).join("\n")}
- Scores are guidance, not predictions: message design effects are usually small, so be calibrated and specific.
${j.max_recommendations ? `- Return at most ${j.max_highlights} highlights and ${j.max_recommendations} recommendations, most important first.` : ""}

Context
- Content type: ${ct.name}. Target appeal mix for this audience: ${APPEALS.map(a => `${a} ${Math.round(w[a] * 100)}%`).join(", ")}.
- Priority dimensions: ${ct.priority_dimensions.join(", ")}. Watch-outs: ${ct.watch_outs.join("; ") || "none"}.
Audience:
${audienceText(ctx)}
`;
    if (g === "influence") {
      const pvs = MODEL.perspectives.map(p => `### ${p.id}: ${p.name} (${p.school})\nQuestion: ${p.question}\n` + p.levers.map(l => `- ${l.id}: ${l.name}. Look for: ${l.look_for} Misuse: ${l.misuse}`).join("\n")).join("\n\n");
      return head + `
Influence perspectives and levers (use these ids exactly)
${pvs}

Score each perspective 0-4: 0 = levers absent or misused, 2 = some used adequately, 4 = levers used well, truthfully and fitted to this audience. Mark each lever present, absent, misused or not_applicable, with an exact short quote where present or misused.
Recommendations use dimension ids from the appeals model (e.g. eth_goodwill, kai_call, log_objections, pat_story) and move ids from: ${MODEL.moves.map(m => `${m.id} (${m.name})`).join("; ")}.

Output: reply with only one JSON object shaped like this:
{"appeal":"influence","summary":"two sentences","perspectives":[{"id":"pv_cialdini","score":2,"summary":"one sentence","levers":[{"id":"lv_social_proof","status":"present","quote":"exact words","note":"short"}]}],"recommendations":[{"dimension":"eth_borrowed","move":"mv_specific_testimonial","issue":"what is wrong","original":"exact words or empty","rewrite":"improved text in the author's voice","impact":"high|medium|low"}]}
Include all ${MODEL.perspectives.length} perspectives.

<content>
${contentBlock(text)}
</content>`;
    }
    if (GROUP[g]) {
      const xdims = EXTRA.filter(d => d.group === g);
      const [lo, hi] = LEN_TARGET[ctx.contentType] || [80, 900];
      const cp = cultureProfile(ctx.culture?.reader);
      const extraCtx = g === "craft" ? `\nLength: typical range for this content type is ${lo} to ${hi} words.\n`
        : g === "culture" ? `\nReader culture profile (${cp.name}; ${lewisLabel(cp.lewis)}). Expected position on each scale, 0 = left pole, 1 = right pole:\n${SCALE_IDS.map(k => { const s = CUL.scales.find(x => x.id === k); return `- ${k}: ${cp.targets[k].toFixed(2)} (${s.name}). Left: ${s.low} Right: ${s.high}`; }).join("\n")}\n${cp.global ? "The audience is global or mixed: favour clear, explicit, courteous writing that travels well and avoids idioms.\n" : ""}`
        : "";
      const dt = xdims.map(d => [`### ${d.id}: ${d.name}`, d.description, `Ask: ${d.judge_asks.join(" ")}`, "Rubric: " + Object.entries(d.rubric).map(([k, v]) => `${k} = ${v}`).join(" | "), d.advice ? `Typical fix: ${d.advice}` : ""].filter(Boolean).join("\n")).join("\n\n");
      const posOut = g === "culture" ? `,"text_positions":{${SCALE_IDS.map(k => `"${k}":0.5`).join(",")}}` : "";
      return head + extraCtx + `
Dimensions to score (use these ids exactly)
${dt}

Recommendations: use the dimension ids above; leave "move" empty.

Output: reply with only one JSON object shaped like this:
{"appeal":"${g}","summary":"two sentences","dimension_scores":[{"id":"${xdims[0].id}","score":2,"rationale":"one sentence citing the text"}],"highlights":[{"quote":"exact words from the content","dimension":"${xdims[0].id}","polarity":"strength|weakness","note":"why, briefly"}],"recommendations":[{"dimension":"${xdims[0].id}","move":"","issue":"what is wrong","original":"exact words being replaced, or empty","rewrite":"the improved text, in the author's voice","impact":"high|medium|low"}]${posOut}}
Score every dimension listed. Write in the same language and spelling conventions as the content.

<content>
${contentBlock(text)}
</content>`;
    }
    const dims = g === "lenses" ? LENSES : DIMS.filter(d => d.appeal === g);
    const ids = new Set(dims.map(d => d.id));
    const moves = MODEL.moves.filter(m => m.dimensions.some(d => ids.has(d)));
    const flags = MODEL.red_flags.filter(f => f.appeal === g);
    const dimText = dims.map(d => [
      `### ${d.id}: ${d.name}`, d.description, `Ask: ${d.judge_asks.join(" ")}`,
      d.rubric ? "Rubric: " + Object.entries(d.rubric).map(([k, v]) => `${k} = ${v}`).join(" | ") : "Rubric: 0 absent, 1 weak, 2 adequate, 3 strong, 4 exemplary.",
      d.positive_signals ? `Strong signals: ${d.positive_signals.join("; ")}.` : "",
      d.negative_signals ? `Weak signals: ${d.negative_signals.join("; ")}.` : "",
      `Grounded in: ${thinkers(d.grounded_in).join(", ")}.`,
    ].filter(Boolean).join("\n")).join("\n\n");
    const fnPart = g === "lenses" ? `\nRhetorical duties: estimate the relative emphasis of the text on each duty, as whole-number percentages summing to 100, and name the primary.\n${FN.map(f => `- ${f.id} (${f.latin}): ${f.verb}. ${f.description} Signals: ${f.signals}`).join("\n")}\n` : "";
    const fnOut = g === "lenses" ? `,"duties":{"teach":30,"delight":10,"move":20,"steer":30,"unsettle":10,"primary":"teach"}` : "";
    return head + `
Dimensions to score (use these ids exactly)
${dimText}
${fnPart}
Rewrite moves you may use (put the id in "move")
${moves.map(m => `- ${m.id}: ${m.name}. ${m.how}`).join("\n")}
${flags.length ? "\nRed flags to report if present (use these ids)\n" + flags.map(f => `- ${f.id}: ${f.name}. ${f.description}`).join("\n") : ""}

Output: reply with only one JSON object shaped like this:
{"appeal":"${g}","summary":"two sentences","dimension_scores":[{"id":"${dims[0].id}","score":2,"rationale":"one sentence citing the text"}],"highlights":[{"quote":"exact words from the content","dimension":"${dims[0].id}","polarity":"strength|weakness","note":"why, briefly"}],"recommendations":[{"dimension":"${dims[0].id}","move":"${moves[0] ? moves[0].id : ""}","issue":"what is wrong","original":"exact words being replaced, or empty","rewrite":"the improved text, in the author's voice","impact":"high|medium|low"}],"red_flags":[{"id":"rf_...","quote":"exact words","note":"why"}]${fnOut}}
Score every dimension listed. Write in the same language and spelling conventions as the content.

<content>
${contentBlock(text)}
</content>`;
  }

  function validJudgeOutput(g, out) {
    return !!out && (g === "influence" ? Array.isArray(out.perspectives) : Array.isArray(out.dimension_scores));
  }

  function rewritePrompt(text, ctx, r, focus = "balanced") {
    const ct = CT[ctx.contentType];
    const recs = r.recommendations.filter(x => focus === "balanced" || x.appeal === focus || (x.appeal === "influence" && appealOf(x.dimension) === focus)).slice(0, 16).map(x => {
      const d = DIM[x.dimension], m = x.move ? MOVE[x.move] : null;
      return `- [${d ? d.name : x.dimension}] ${x.issue}${m ? ` (Move: ${m.name}: ${m.how})` : ""}${x.original && !x.example ? `\n  Original: "${x.original}"` : ""}${x.source === "ai" ? `\n  Suggested: "${x.rewrite}"` : ""}`;
    }).join("\n");
    const weakest = APPEALS.slice().sort((a, b) => r.scores[a] - r.scores[b])[0];
    const misused = r.perspectives.flatMap(p => p.levers.filter(l => l.status === "misused").map(l => LEVER[l.id].name));
    const need = r.duties.target ? FN.find(f => r.duties.target[f.id] === 40)?.name : null;
    return `Rewrite the content below to be more persuasive, using the HowDoesThisLand model (Aristotle's appeals plus kairos, and modern influence research).

Content type: ${ct.name}. Target mix for this audience: ${APPEALS.map(a => `${a} ${Math.round(r.effective_weights[a] * 100)}%`).join(", ")}.
Current scores: ${APPEALS.map(a => `${a} ${r.scores[a]}`).join(", ")}. ${focus === "balanced" ? `Weakest appeal: ${weakest}.` : `Focus on raising ${focus} without damaging the others.`}
Audience:
${audienceText(ctx)}
${need ? `Rhetorical duty this audience needs most: ${need}.` : ""}
Watch-outs: ${ct.watch_outs.join("; ") || "none"}.
${r.balance_findings.length ? "Balance issues: " + r.balance_findings.map(b => b.name + ": " + b.message).join(" ") : ""}
${misused.length ? "Levers currently misused (fix or remove): " + misused.join(", ") + "." : ""}

Apply these recommendations:
${recs || "- Improve the weakest dimensions."}

Rules:
- Keep the author's voice, language and spelling conventions. Keep roughly the same length and format unless a recommendation says otherwise.
- Never invent facts, numbers, names, clients or testimonials. Where a stronger version needs a fact the author must supply, write a short [placeholder in square brackets].
- No manipulative techniques: no fake urgency, false scarcity, fabricated proof, confirmshaming or fear without a path. Pair any urgency with a feasible next step.
- Aim for persuasion that builds trust and examined conviction: where it fits the content, acknowledge the strongest counter-view and invite a response rather than demanding agreement.
- Output only the rewritten content. No preamble, no notes.

<content>
${text.slice(0, 40000)}
</content>`;
  }

  function calibrate(EVAL) {
    const step = { low: 0, mid: 1, high: 2 };
    const totals = { appealHits: 0, appealNear: 0, appealN: 0, flagHits: 0, flagN: 0, fnHits: 0, fnN: 0 };
    const rows = EVAL.cases.map(c => {
      const ctx = caseCtx(c);
      const r = assemble(c.text, ctx, quickScan(c.text, ctx), {});
      const appeals = APPEALS.map(a => {
        const got = band3(r.scores[a]), exp = c.expect.appeals[a], d = Math.abs(step[got] - step[exp]);
        totals.appealN++; if (!d) totals.appealHits++; else if (d === 1) totals.appealNear++;
        return { appeal: a, score: r.scores[a], expected: exp, result: d === 0 ? "ok" : d === 1 ? "near" : "miss" };
      });
      const ids = new Set(r.red_flags.map(f => f.id));
      const fp = c.expect.flags_present.filter(f => ids.has(f)).length, fa = c.expect.flags_absent.filter(f => !ids.has(f)).length;
      totals.flagHits += fp + fa; totals.flagN += c.expect.flags_present.length + c.expect.flags_absent.length;
      let fn = null;
      if (c.expect.primary_duty) { totals.fnN++; const ok = r.duties.primary === c.expect.primary_duty; if (ok) totals.fnHits++; fn = { got: r.duties.primary, expected: c.expect.primary_duty, ok }; }
      const od = Math.abs(step[band3(r.scores.overall)] - step[c.expect.overall]);
      return { case: c, appeals, overall: { score: r.scores.overall, expected: c.expect.overall, result: od === 0 ? "ok" : od === 1 ? "near" : "miss" }, flags: { found: fp, of: c.expect.flags_present.length, clear: fa, ofClear: c.expect.flags_absent.length }, fn };
    });
    return { rows, totals };
  }
  const caseCtx = c => ({ contentType: c.content_type, archetype: c.audience.archetype || "general", role: c.audience.role || "", audience: { ...DEFAULT_CTX.audience, ...c.audience }, culture: { ...DEFAULT_CTX.culture } });

  return { MODEL, DIMS, LENSES, EXTRA, GROUPS, GROUP, COUNTRY, CUL, SCALE_IDS, cultureProfile, lewisLabel, DIM, MOVE, CT, APP, PV, LEVER, ARCH, ROLE, FN, FLAG, REF, MODS, appealOf, thinkers, isExec,
    effectiveWeights, fnTarget, quickScan, assemble, toApi, judgePrompt, validJudgeOutput, rewritePrompt, calibrate, caseCtx, locate };
}
