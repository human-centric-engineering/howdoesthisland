
/* ================= shared chart bits ================= */
const EVID_ORDER = ["strong", "good", "mixed", "practitioner", "weak"];
const EVID_LABEL = { strong: "Strong", good: "Good", mixed: "Mixed", practitioner: "Practitioner", weak: "Weak" };
const EVID_TONE = { strong: "logos", good: "lenses", mixed: "kairos", practitioner: "neutral", weak: "pathos" };
function evidenceCounts(M) {
  const c = Object.fromEntries(EVID_ORDER.map(k => [k, { research: 0, levers: 0 }]));
  for (const r of M.research) if (c[r.evidence]) c[r.evidence].research++;
  for (const p of M.perspectives) for (const l of p.levers) if (c[l.evidence]) c[l.evidence].levers++;
  return c;
}
function EvidenceChart({ M, compact }) {
  const c = evidenceCounts(M);
  const max = Math.max(...EVID_ORDER.map(k => c[k].research + c[k].levers));
  return (
    <div className="grid gap-3">
      {EVID_ORDER.map(k => {
        const t = c[k].research + c[k].levers;
        return (
          <div key={k} className="grid grid-cols-[96px_1fr_36px] items-center gap-3 text-[13px]">
            <span className="font-medium">{EVID_LABEL[k]}</span>
            <div className="flex h-3 rounded-full bg-surface2 overflow-hidden">
              <span className={tone(EVID_TONE[k]).bg} style={{ width: (100 * c[k].research / max) + "%" }} title={`${c[k].research} studies`} />
              <span className={cx(tone(EVID_TONE[k]).bg, "opacity-45")} style={{ width: (100 * c[k].levers / max) + "%" }} title={`${c[k].levers} levers`} />
            </div>
            <span className="text-right tabular-nums text-muted">{t}</span>
          </div>
        );
      })}
      {!compact && <p className="text-xs text-muted mt-1">Solid bars are studies in the evidence register; lighter bars are influence levers rated at that strength.</p>}
    </div>
  );
}
function Stat({ n, label }) {
  return <div><b className="block font-display text-[44px] leading-none tabular-nums">{n}</b><span className="block text-[13px] text-muted mt-1.5">{label}</span></div>;
}

/* ================= sample report data ================= */
const SAMPLE_AFTER = `Subject: Keeping delivery on track after your cloud move

Hi Sarah,

Your Q3 update mentioned the cloud migration twice, and both times the worry was the same: teams slowing down in the month after the switch. You're right to flag it. That dip is common, and it's usually a change problem, not a technical one.

When we worked with [client in a similar sector], a firm about your size, delivery held steady through a similar move because we ran a two-week readiness check and gave each team a named coach. [Result, e.g. support tickets fell by X% in the first quarter.]

You might be wondering whether this means another big programme. It doesn't. The check takes two weeks, it fits around your existing plan, and if it finds nothing worth fixing, you've lost very little.

You're planning the cutover for the new year, so the next six weeks are when this is cheapest to fix.

If it's useful, I can send the one-page readiness checklist we use. Just reply "checklist". No call needed, and no hard feelings if the timing's wrong.

Tom`;
const SAMPLE_CTX = { contentType: "sales_email", archetype: "builder", role: "coo", audience: { involvement: "medium", awareness: "problem_aware", relationship: "cold", decision_unit: "individual", focus: "prevention" } };
const SAMPLE_NOTES = {
  verdict: "The original reads as a brochure sent to a stranger. It talks about the sender for four sentences before the reader appears, and asks a busy operations director for 45 minutes with nothing in return. The rewrite starts from a risk Sarah has already named, explains how it's handled, answers the obvious objection and asks for one word.",
  appeals: {
    ethos: "Credibility is claimed, not shown: 'leading provider', 'world's top companies' and 'outstanding results' with no names or numbers. To a Builder, unbacked claims read as risk.",
    pathos: "There is no reader in the email. Sarah's own problem never appears, so there is nothing for her to feel or recognise.",
    logos: "Services are listed but no mechanism is offered. Nothing explains how the work would reduce her risk.",
    kairos: "No reason to reply now, and the ask (45 minutes to 'walk through our capabilities') is far bigger than the trust built.",
  },
  changes: [
    { dim: "eth_goodwill", title: "Start with her problem, not your job title", why: "The Trust Equation puts self-orientation at the bottom of the fraction: the more a message is about the sender, the less it's trusted.", before: "My name is Tom and I am the Business Development Manager at BrightPath Consulting.", after: "Your Q3 update mentioned the cloud migration twice, and both times the worry was the same." },
    { dim: "log_mechanism", title: "Show how, not just what", why: "Builders ask 'who does what, by when?'. A named method makes a familiar promise believable.", before: "Our innovative approach delivers outstanding results for our clients.", after: "We ran a two-week readiness check and gave each team a named coach." },
    { dim: "log_objections", title: "Answer the objection before she raises it", why: "Two-sided messages that raise and answer a counter-argument beat one-sided messages in meta-analyses.", before: "(No objection addressed)", after: "You might be wondering whether this means another big programme. It doesn't." },
    { dim: "kai_call", title: "Shrink the ask, and give a reason for now", why: "A small first step inside the reader's comfort zone is far more likely to be taken than a large one.", before: "I would love to set up a 45-minute call to walk you through our capabilities.", after: "Just reply \"checklist\". No call needed." },
  ],
  honesty: "The rewrite leaves two facts as placeholders: a comparable client and a result. HowDoesThisLand won't invent proof; Tom has to supply it, or cut the sentence.",
};

/* ================= Home ================= */
function useSampleScores(E, EVAL) {
  return useMemo(() => {
    const before = EVAL.cases.find(c => c.id === "ev05").text;
    const rb = E.assemble(before, SAMPLE_CTX, E.quickScan(before, SAMPLE_CTX), {});
    const ra = E.assemble(SAMPLE_AFTER, SAMPLE_CTX, E.quickScan(SAMPLE_AFTER, SAMPLE_CTX), {});
    return { before, rb, ra };
  }, [E, EVAL]);
}
const HOME_CTX = { contentType: "landing_page", archetype: "general", role: "", audience: { involvement: "medium", awareness: "problem_aware", relationship: "cold", decision_unit: "individual", focus: "unknown" } };
function homeCopy(E, s) {
  const M = E.MODEL;
  return {
    h1: "Find out why your words aren't landing, before your reader does.",
    sub: "HowDoesThisLand reads your CV, pitch or proposal the way your reader will. It scores credibility, emotion, logic and timing, shows you where each one works, and helps you rewrite the parts that don't. You can try it now, free, in under a minute.",
    story: "It's 11pm, the deadline is tomorrow, and you've reread your proposal so many times you can't tell if it's any good.",
    story2: "You're not alone: most people struggle to judge their own writing, because they already know what they meant. Psychologists call it the curse of knowledge, and it's why a second reader helps.",
    compare: "Unlike a grammar checker, which tells you whether a sentence is correct, or a colleague, who tells you whether they like it, HowDoesThisLand tells you whether it will persuade the person you're sending it to, and why.",
    example: `When we tested one cold email, it opened with the sender's job title and asked for a 45-minute call. HowDoesThisLand scored it ${s.rb.scores.overall}. After four changes, starting with the reader's own problem and ending with a smaller ask, it scored ${s.ra.scores.overall}.`,
    nowH: "Fluent writing is now free. Trust isn't.",
    now: "Since anyone can now produce polished text in seconds, polish no longer persuades. Readers have learned to spot the formula, and research on persuasion knowledge shows that when people notice a tactic, they push back. What wins now is what was always hardest to fake: real evidence, honest limits and a clear reason to act.",
    steps: [
      ["Paste or upload", "Text, Word, PDF or slides. Tell HowDoesThisLand who will read it, because a sceptical CTO reads differently from a time-poor board."],
      ["Six judges read it", `Separate judges for ethos, pathos, logos and kairos, one for purpose and fit, and an influence panel drawing on ${M.perspectives.length} schools of research. Every finding quotes your text, so you can check it.`],
      ["Rewrite, then check again", "Claude rewrites in your voice. Anything it can't know becomes a placeholder, never an invented fact. Assess the new version and see what changed."],
    ],
    honestH: "Built on evidence, and honest about its limits.",
    honest: `You might be wondering whether a score can capture something as human as persuasion. It can't, entirely. Most message tweaks make a small difference, and some popular advice doesn't replicate. That's why HowDoesThisLand shows how strong the evidence is behind every check, and caps the score of any text that relies on fake urgency or misleading claims. The model draws on ${M.knowledge_refs.thinkers.length} thinkers, from Aristotle and Cicero to Cialdini, Kahneman and Godin, and on ${M.research.length + M.knowledge_refs.studies.length} published studies, each marked by how well it has held up. In our test set, the quick scan caught all 27 planted red flags.`,
    good: "But what if your writing is already good? Then HowDoesThisLand will say so, and show you why it works, so you can do it again.",
    who: "Built for people who write things that matter: founders, consultants, job seekers and anyone with a pitch to make.",
    ctaH: "Your next important message deserves a second reader.",
    cta: "In short: every week you send important messages without a second reader, some of them miss. Try it now with the message that matters most this week. The quick scan takes 10 seconds and costs nothing; the AI judges take about a minute.",
  };
}
function HomeView({ E, EVAL, onAssessText }) {
  const s = useSampleScores(E, EVAL);
  const C = homeCopy(E, s);
  const pageText = [C.h1, C.sub, C.story + " " + C.story2, C.compare, C.example, C.nowH, C.now, ...C.steps.map(x => x.join(". ")), C.honest, C.good, C.who, C.cta].join("\n\n");
  const self = useMemo(() => E.assemble(pageText, HOME_CTX, E.quickScan(pageText, HOME_CTX), {}), [E, pageText]);
  const weakest = [...E.DIMS].map(d => ({ d, v: self.dimensions.find(x => x.id === d.id).score })).sort((a, b) => a.v - b.v)[0];
  const M = E.MODEL, nlev = M.perspectives.reduce((a, p) => a + p.levers.length, 0);
  return (
    <section className="-mt-2">
      {/* hero */}
      <div className="grid gap-10 items-center lg:grid-cols-[minmax(0,1.15fr)_minmax(0,.85fr)] pb-14 border-b border-line">
        <div>
          <h1 className="font-display text-[48px] sm:text-[68px] xl:text-[80px] leading-[.95] tracking-[-.02em] max-w-[13ch]">{C.h1}</h1>
          <p className="text-[17px] text-muted mt-6 max-w-[54ch] leading-relaxed">{C.sub}</p>
          <div className="flex flex-wrap gap-3 mt-8">
            <a href="#assess" className="no-underline"><Btn variant="primary" size="lg">Assess your text</Btn></a>
            <a href="#report" className="no-underline"><Btn size="lg">See a sample report</Btn></a>
          </div>
        </div>
        <Panel className="p-6 sm:p-7">
          <div className="flex items-baseline justify-between gap-3 mb-1">
            <h2 className="font-display text-[26px] leading-tight">We ran this page through HowDoesThisLand</h2>
          </div>
          <p className="text-[13px] text-muted mb-2">Quick scan, recalculated every time the page loads.</p>
          <VennScore E={E} r={self} />
          <div className="mt-4 p-4 rounded-xl bg-surface2 text-sm">
            <b>{self.scores.band}, not perfect.</b> Weakest point: {weakest.d.name.toLowerCase()}. We're new, so there are no customer quotes here yet, and we won't invent them.
          </div>
          <button onClick={() => onAssessText(pageText, HOME_CTX)} className="mt-4 text-sm font-semibold text-accent hover:underline underline-offset-4">Open this page in the assessor</button>
        </Panel>
      </div>

      {/* the problem */}
      <div className="grid gap-8 py-16 border-b border-line lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start">
        <p className="font-display italic text-[32px] sm:text-[40px] leading-[1.12] max-w-[22ch]">{C.story}</p>
        <div className="text-[16px] leading-relaxed text-muted max-w-[56ch] lg:pt-3">
          <p>{C.story2}</p>
          <p className="mt-4 text-ink">{C.compare}</p>
        </div>
      </div>

      {/* before / after */}
      <div className="py-16 border-b border-line">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)] items-center">
          <div>
            <h2 className="font-display text-[40px] leading-[1.05] max-w-[16ch]">One email, four changes, {s.ra.scores.overall - s.rb.scores.overall} points.</h2>
            <p className="text-muted mt-4 max-w-[52ch] leading-relaxed">{C.example}</p>
            <a href="#report" className="inline-block mt-6 no-underline"><Btn>Read the full report</Btn></a>
          </div>
          <Panel className="p-6">
            <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-4 mb-6">
              <div><span className="text-xs text-muted">Before</span><b className="block font-display text-[64px] leading-none tabular-nums text-muted">{s.rb.scores.overall}</b></div>
              <span className="pb-4 text-muted"><Icon name="chevron" className="-rotate-90" /></span>
              <div className="text-right"><span className="text-xs text-muted">After</span><b className="block font-display text-[64px] leading-none tabular-nums text-accent">{s.ra.scores.overall}</b></div>
            </div>
            <div className="grid gap-3.5">
              {APPEALS.map(a => (
                <div key={a} className="grid grid-cols-[64px_1fr_64px] items-center gap-3 text-[13px]">
                  <b className={tone(a).text}>{E.APP[a].name}</b>
                  <div className="relative h-2 rounded-full bg-surface2">
                    <span className="absolute inset-y-0 left-0 rounded-full bg-line" style={{ width: s.rb.scores[a] + "%" }} />
                    <span className={cx("absolute inset-y-0 left-0 rounded-full", tone(a).bg)} style={{ width: s.ra.scores[a] + "%", opacity: .9 }} />
                  </div>
                  <span className="text-right tabular-nums text-muted">{s.rb.scores[a]} to <b className="text-ink">{s.ra.scores[a]}</b></span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      {/* why now */}
      <div className="py-16 border-b border-line grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <h2 className="font-display text-[44px] sm:text-[56px] leading-[1] max-w-[12ch]">{C.nowH}</h2>
        <p className="text-[16px] leading-relaxed text-muted max-w-[56ch] lg:pt-2">{C.now}</p>
      </div>

      {/* how it works */}
      <div className="py-16 border-b border-line">
        <h2 className="font-display text-[40px] leading-tight mb-8">How it works</h2>
        <ol className="grid gap-5 md:grid-cols-3">
          {C.steps.map(([h, p], i) => (
            <li key={h} className="relative pl-14">
              <span className="absolute left-0 top-0 w-10 h-10 rounded-full border border-line grid place-items-center font-display text-[22px] tabular-nums">{i + 1}</span>
              <h3 className="font-semibold text-[16px] mb-1.5">{h}</h3>
              <p className="text-[14.5px] text-muted leading-relaxed">{p}</p>
            </li>
          ))}
        </ol>
      </div>

      {/* honest */}
      <div className="py-16 border-b border-line grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,.9fr)]">
        <div>
          <h2 className="font-display text-[40px] leading-[1.05] max-w-[18ch]">{C.honestH}</h2>
          <p className="text-[15.5px] leading-relaxed text-muted mt-5 max-w-[60ch]">{C.honest}</p>
          <p className="text-[15.5px] leading-relaxed mt-4 max-w-[60ch]">{C.good}</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 mt-9">
            <Stat n={E.DIMS.length} label="dimensions across four appeals" />
            <Stat n={M.perspectives.length} label="schools of influence" />
            <Stat n={nlev} label="levers checked" />
            <Stat n={M.moves.length} label="rewrite moves" />
          </div>
        </div>
        <Panel className="p-6 self-start">
          <h3 className="font-display text-[24px] mb-1">How strong is the evidence?</h3>
          <p className="text-[13px] text-muted mb-5">Every check is tagged. Most persuasion advice is practitioner wisdom; we say so.</p>
          <EvidenceChart M={M} />
        </Panel>
      </div>

      {/* who + cta */}
      <div className="py-16">
        <p className="text-[15px] text-muted mb-4">{C.who}</p>
        <div className="flex flex-wrap gap-2 mb-14">
          {["CVs and cover letters", "Landing pages", "Sales emails", "Proposals", "Board papers", "Pitch decks", "Fundraising appeals", "Speeches", "Change announcements"].map(t => (
            <span key={t} className="px-3.5 h-9 inline-flex items-center rounded-full border border-line bg-surface text-[13px] font-medium">{t}</span>
          ))}
        </div>
        <div className="rounded-3xl bg-ink text-surface p-8 sm:p-12 grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] items-end">
          <div>
            <h2 className="font-display text-[40px] sm:text-[52px] leading-[1] max-w-[16ch]">{C.ctaH}</h2>
            <p className="mt-5 max-w-[58ch] opacity-75 leading-relaxed">{C.cta}</p>
          </div>
          <a href="#assess" className="no-underline"><button className="h-12 px-6 rounded-xl bg-surface text-ink font-semibold hover:opacity-90">Assess your text</button></a>
        </div>
      </div>
    </section>
  );
}

/* ================= Sample report ================= */
function StaticDoc({ text, r, appeals = APPEALS }) {
  const hl = r.highlights.filter(h => appeals.includes(h.appeal) || h.flag);
  const pts = new Set([0, text.length]); for (const h of hl) { pts.add(h.start); pts.add(h.end); }
  const P = [...pts].sort((a, b) => a - b), out = [];
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1]; if (a >= b) continue;
    const act = hl.filter(h => h.start <= a && h.end >= b), seg = text.slice(a, b);
    if (!act.length) { out.push(<React.Fragment key={a}>{seg}</React.Fragment>); continue; }
    const strong = act.filter(h => h.polarity === "strength"), ap = (strong[0] || act[0]).appeal || "lenses";
    out.push(<span key={a} className={cx("rounded-[3px]", strong.length ? tone(ap).hl : cx("underline decoration-wavy decoration-[1.5px] underline-offset-[5px]", act.some(h => h.flag) ? "decoration-warn" : tone(ap).deco))}>{seg}</span>);
  }
  return <div className="font-read text-[15.5px] leading-[1.85] whitespace-pre-wrap">{out}</div>;
}
function ReportView({ E, EVAL, onAssessText }) {
  const s = useSampleScores(E, EVAL);
  const { rb, ra } = s, role = E.ROLE[SAMPLE_CTX.role], arch = E.ARCH[SAMPLE_CTX.archetype];
  const parts = SAMPLE_AFTER.split(/(\[[^\]\n]{1,120}\])/g);
  const flagsBefore = rb.red_flags.length, balB = rb.balance_findings;
  const SectionH = ({ n, children }) => <h2 className="font-display text-[32px] leading-tight mb-5 flex items-baseline gap-3"><span className="text-muted text-[20px] tabular-nums">{n}</span>{children}</h2>;
  return (
    <section className="max-w-[1080px]">
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <span className="h-7 px-3 inline-flex items-center rounded-full bg-accent-soft text-accent text-[13px] font-semibold">Sample report</span>
        <span className="text-[13px] text-muted">Scores from the quick scan; commentary shows what the AI judges write.</span>
      </div>
      <h1 className="font-display text-[44px] sm:text-[60px] leading-[1] tracking-[-.01em] max-w-[20ch]">A cold email to an operations director</h1>
      <div className="flex flex-wrap gap-2 mt-5">
        {[E.CT[SAMPLE_CTX.contentType].name, `${arch.name}: ${arch.motto}`, role.name, "Cold relationship", "Safety-minded reader"].map(t => <span key={t} className="h-8 px-3 inline-flex items-center rounded-full border border-line bg-surface text-[13px]">{t}</span>)}
      </div>

      {/* verdict */}
      <Panel className="mt-10 overflow-hidden">
        <div className="grid md:grid-cols-[1fr_1fr]">
          <div className="p-6 sm:p-8 border-b md:border-b-0 md:border-r border-line">
            <p className="text-[13px] text-muted mb-1">Before</p>
            <VennScore E={E} r={rb} />
          </div>
          <div className="p-6 sm:p-8">
            <p className="text-[13px] text-muted mb-1">After four changes</p>
            <VennScore E={E} r={ra} />
          </div>
        </div>
        <div className="p-6 sm:p-8 border-t border-line grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div>
            <h2 className="font-display text-[30px] leading-tight mb-3">The verdict</h2>
            <p className="text-[15.5px] leading-relaxed">{SAMPLE_NOTES.verdict}</p>
          </div>
          <div className="grid grid-cols-2 gap-5 content-start">
            <Stat n={`+${ra.scores.overall - rb.scores.overall}`} label="overall points" />
            <Stat n={`${rb.craft.gunning_fog} to ${ra.craft.gunning_fog}`} label="fog index (lower reads easier)" />
            <Stat n={balB.length} label="balance problems fixed" />
            <Stat n={`${rb.craft.you}/${rb.craft.we} to ${ra.craft.you}/${ra.craft.we}`} label="you / we mentions" />
          </div>
        </div>
      </Panel>

      {/* 1 how it read */}
      <div className="mt-16">
        <SectionH n="1">How the original reads</SectionH>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <Panel className="p-6 sm:p-8">
            <div className="flex flex-wrap gap-3 mb-4 text-xs text-muted">
              {APPEALS.map(a => <span key={a} className="inline-flex items-center gap-1.5"><Dot k={a} />{E.APP[a].name}</span>)}
              <span className="inline-flex items-center gap-1.5"><span className="w-4 border-b-2 border-dotted border-warn" />Weak spot</span>
            </div>
            <StaticDoc text={s.before} r={rb} />
          </Panel>
          <div className="grid gap-3 content-start">
            {APPEALS.map(a => (
              <div key={a} className="p-5 rounded-2xl border border-line bg-surface">
                <div className="flex items-baseline justify-between mb-1.5"><b className={cx("text-sm", tone(a).text)}>{E.APP[a].name}</b><span className="font-display text-[26px] leading-none tabular-nums">{rb.scores[a]}</span></div>
                <p className="text-[13.5px] text-muted leading-relaxed">{SAMPLE_NOTES.appeals[a]}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 2 changes */}
      <div className="mt-16">
        <SectionH n="2">Four changes that matter most</SectionH>
        <div className="grid gap-4">
          {SAMPLE_NOTES.changes.map((c, i) => {
            const d = E.DIM[c.dim], ap = d.appeal || "lenses";
            return (
              <Panel key={i} className="p-6 grid gap-5 lg:grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)]">
                <div>
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted mb-2"><Dot k={ap} />{E.APP[ap]?.name || "Lens"}, {d.name.toLowerCase()}</span>
                  <h3 className="font-display text-[26px] leading-tight mb-2">{c.title}</h3>
                  <p className="text-[13.5px] text-muted leading-relaxed">{c.why}</p>
                </div>
                <div className="grid gap-2.5 content-center">
                  <p className="text-[14.5px] text-muted pl-4 border-l-2 border-line line-through decoration-line">{c.before}</p>
                  <p className={cx("text-[14.5px] pl-4 border-l-2", tone(ap).border)}>{c.after}</p>
                </div>
              </Panel>
            );
          })}
        </div>
      </div>

      {/* 3 influence */}
      <div className="mt-16">
        <SectionH n="3">Through thirteen lenses of influence</SectionH>
        <Panel className="p-6 sm:p-8">
          <div className="flex gap-5 text-xs text-muted mb-5"><span className="inline-flex items-center gap-1.5"><span className="w-3 h-2 rounded-full bg-line" />Before</span><span className="inline-flex items-center gap-1.5"><span className="w-3 h-2 rounded-full bg-accent" />After</span></div>
          <div className="grid gap-x-10 gap-y-3 md:grid-cols-2">
            {rb.perspectives.map((p, i) => {
              const a = ra.perspectives[i], b0 = p.score ?? 0, a0 = a.score ?? 0;
              return (
                <div key={p.id} className="grid grid-cols-[150px_1fr] items-center gap-3 text-[13px]">
                  <span className="truncate">{E.PV[p.id].name}</span>
                  <div className="grid gap-1">
                    <div className="h-1.5 rounded-full bg-surface2"><div className="h-full rounded-full bg-line" style={{ width: b0 * 25 + "%" }} /></div>
                    <div className="h-1.5 rounded-full bg-surface2"><div className="h-full rounded-full bg-accent" style={{ width: a0 * 25 + "%" }} /></div>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted mt-5">Quick-scan estimates where the scan can see a lever. The AI panel scores all {E.MODEL.perspectives.length} perspectives in full.</p>
        </Panel>
      </div>

      {/* 4 rewrite */}
      <div className="mt-16">
        <SectionH n="4">The rewrite</SectionH>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <Panel className="p-6 sm:p-8">
            <div className="font-read text-[15.5px] leading-[1.85] whitespace-pre-wrap">
              {parts.map((x, i) => /^\[.*\]$/.test(x) ? <mark key={i} className="bg-kairos-hl text-kairos rounded px-1">{x}</mark> : <React.Fragment key={i}>{x}</React.Fragment>)}
            </div>
          </Panel>
          <div className="grid gap-4 content-start">
            <Panel className="p-5">
              <h3 className="font-display text-[22px] mb-1.5">What we didn't do</h3>
              <p className="text-[13.5px] text-muted leading-relaxed">{SAMPLE_NOTES.honesty}</p>
            </Panel>
            <Panel className="p-5">
              <h3 className="font-display text-[22px] mb-3">Craft, before and after</h3>
              <table className="w-full text-[13px]"><tbody>
                {[["Words", rb.craft.words, ra.craft.words], ["Fog index", rb.craft.gunning_fog, ra.craft.gunning_fog], ["Passive sentences", rb.craft.passive_pct + "%", ra.craft.passive_pct + "%"], ["Questions to the reader", rb.craft.devices.questions, ra.craft.devices.questions], ["Main job", E.FN.find(f => f.id === rb.duties.primary).name, E.FN.find(f => f.id === ra.duties.primary).name]].map(([k, b, a]) => (
                  <tr key={k} className="border-t border-line first:border-0"><td className="py-2 text-muted">{k}</td><td className="py-2 text-right tabular-nums">{b}</td><td className="py-2 text-right tabular-nums font-semibold">{a}</td></tr>
                ))}
              </tbody></table>
            </Panel>
            <Btn variant="primary" onClick={() => onAssessText(SAMPLE_AFTER, SAMPLE_CTX)}>Open the rewrite in the assessor</Btn>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ================= Model ================= */
function Pipeline({ E }) {
  const nodes = [
    ["Your text and reader", "Content type, archetype, role and context set the target mix."],
    ["Quick scan", "Instant, in the browser. Patterns, readability, red flags."],
    ["Six AI judges", "Ethos, pathos, logos, kairos, lenses, influence panel. Every finding quotes the text."],
    ["The assessment", "Scores, highlights, balance, duties, levers and recommendations."],
    ["Rewrite", "Claude applies the moves, keeps your voice, never invents proof."],
  ];
  return (
    <div className="grid gap-3 md:grid-cols-5 items-stretch">
      {nodes.map(([h, p], i) => (
        <div key={h} className="relative">
          <div className={cx("h-full p-4 rounded-2xl border", i === 2 ? "border-accent bg-accent-soft" : "border-line bg-surface")}>
            <span className="text-xs text-muted tabular-nums">Step {i + 1}</span>
            <h3 className="font-display text-[22px] leading-tight mt-1 mb-1.5">{h}</h3>
            <p className="text-[13px] text-muted leading-snug">{p}</p>
          </div>
          {i < nodes.length - 1 && <span className="hidden md:grid absolute -right-3 top-1/2 -translate-y-1/2 z-10 w-6 h-6 rounded-full bg-bg border border-line place-items-center text-muted"><Icon name="chevron" size={14} className="-rotate-90" /></span>}
        </div>
      ))}
    </div>
  );
}
function ArchetypeMap({ E }) {
  const P = { auditor: [0.82, 0.74], builder: [0.55, 0.62], pathfinder: [0.42, 0.2], connector: [0.2, 0.32], sceptic: [0.88, 0.5] };
  const W = 520, H = 340, pad = 44;
  const x = v => pad + v * (W - pad * 2), y = v => pad + v * (H - pad * 2);
  const col = { auditor: "ethos", builder: "logos", pathfinder: "kairos", connector: "pathos", sceptic: "lenses" };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Map of the five reader archetypes by appetite for evidence and by growth or safety focus">
      <rect x={pad} y={pad} width={W - pad * 2} height={H - pad * 2} rx="14" fill="var(--surface-2)" />
      <line x1={W / 2} y1={pad} x2={W / 2} y2={H - pad} stroke="var(--line)" strokeDasharray="3 5" />
      <line x1={pad} y1={H / 2} x2={W - pad} y2={H / 2} stroke="var(--line)" strokeDasharray="3 5" />
      <text x={pad} y={H - 14} fontSize="12" fill="var(--muted)" fontFamily="var(--ui)">Skims, decides on cues</text>
      <text x={W - pad} y={H - 14} fontSize="12" fill="var(--muted)" textAnchor="end" fontFamily="var(--ui)">Reads closely, wants evidence</text>
      <text x={pad + 6} y={pad - 14} fontSize="12" fill="var(--muted)" fontFamily="var(--ui)">Growth: drawn to gains</text>
      <text x={pad + 6} y={H - pad + 18} fontSize="12" fill="var(--muted)" fontFamily="var(--ui)" dy="0">Safety: avoids mistakes</text>
      {Object.entries(P).map(([id, [px, py]]) => {
        const a = E.ARCH[id]; if (!a) return null;
        return (
          <g key={id}>
            {id === "sceptic" && <circle cx={x(px)} cy={y(py)} r="30" fill="none" stroke={`var(--${col[id]})`} strokeDasharray="2 4" />}
            <circle cx={x(px)} cy={y(py)} r="18" fill={`var(--${col[id]})`} fillOpacity=".18" stroke={`var(--${col[id]})`} strokeWidth="1.5" />
            <text x={x(px)} y={y(py) + 38} textAnchor="middle" fontFamily="var(--display)" fontSize="19" fill="var(--ink)">{a.name.replace("The ", "")}</text>
            <text x={x(px)} y={y(py) + 54} textAnchor="middle" fontFamily="var(--ui)" fontSize="11" fill="var(--muted)">{a.motto}</text>
          </g>
        );
      })}
    </svg>
  );
}
function PerspectivePetals({ E }) {
  const ps = E.MODEL.perspectives, n = ps.length, C = 210, R0 = 46, maxL = Math.max(...ps.map(p => p.levers.length));
  return (
    <svg viewBox="0 0 420 420" className="w-full max-w-[420px] mx-auto h-auto" role="img" aria-label="Thirteen influence perspectives, sized by number of levers">
      {ps.map((p, i) => {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2, len = R0 + (p.levers.length / maxL) * 110, w = 0.2;
        const pt = (ang, r) => `${C + Math.cos(ang) * r},${C + Math.sin(ang) * r}`;
        const tip = pt(a, len), l = pt(a - w, R0 + 18), rr = pt(a + w, R0 + 18), base = pt(a, R0 - 4);
        const lx = C + Math.cos(a) * (len + 16), ly = C + Math.sin(a) * (len + 16);
        const anchor = Math.abs(Math.cos(a)) < 0.2 ? "middle" : Math.cos(a) > 0 ? "start" : "end";
        const isCrit = p.id === "pv_critical" || p.id === "pv_ethics";
        return (
          <g key={p.id}>
            <path d={`M${base} Q${l} ${tip} Q${rr} ${base}Z`} fill={isCrit ? "var(--accent)" : "var(--ink)"} fillOpacity={isCrit ? ".55" : ".12"} stroke={isCrit ? "var(--accent)" : "var(--muted)"} strokeWidth="1" />
            <text x={lx} y={ly + 4} textAnchor={anchor} fontFamily="var(--ui)" fontSize="11" fill="var(--muted)">{p.name}</text>
          </g>
        );
      })}
      <circle cx={C} cy={C} r={R0 - 6} fill="var(--surface)" stroke="var(--line)" />
      <text x={C} y={C + 2} textAnchor="middle" fontFamily="var(--display)" fontSize="30" fill="var(--ink)">{ps.reduce((a, p) => a + p.levers.length, 0)}</text>
      <text x={C} y={C + 18} textAnchor="middle" fontFamily="var(--ui)" fontSize="10" fill="var(--muted)">levers</text>
    </svg>
  );
}
function ContentMix({ E }) {
  const cts = E.MODEL.content_types;
  return (
    <div className="grid gap-2.5">
      {cts.map(c => (
        <div key={c.id} className="grid grid-cols-[minmax(110px,190px)_1fr] items-center gap-4 text-[13px]">
          <span className="truncate" title={c.examples}>{c.name}</span>
          <div className="flex h-5 rounded-md overflow-hidden gap-0.5">
            {APPEALS.map(a => (
              <span key={a} className={cx("grid place-items-center text-[10px] font-semibold text-surface", tone(a).bg)} style={{ width: c.weights[a] * 100 + "%" }} title={`${E.APP[a].name} ${Math.round(c.weights[a] * 100)}%`}>
                {c.weights[a] >= 0.15 ? Math.round(c.weights[a] * 100) : ""}
              </span>
            ))}
          </div>
        </div>
      ))}
      <div className="flex flex-wrap gap-4 mt-3 text-xs text-muted">{APPEALS.map(a => <span key={a} className="inline-flex items-center gap-1.5"><Dot k={a} />{E.APP[a].name}</span>)}</div>
    </div>
  );
}
function AppealColumns({ E }) {
  const maxW = Math.max(...E.DIMS.map(d => d.weight));
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {E.MODEL.appeals.map(a => (
        <Panel key={a.id} className="p-5 flex flex-col">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className={cx("font-display text-[34px] leading-none", tone(a.id).text)}>{a.name}</h3>
            <span className="font-display italic text-muted text-lg">{a.greek}</span>
          </div>
          <p className="font-display text-[19px] leading-snug mt-3 mb-5">{a.question}</p>
          <div className="grid gap-1 mt-auto">
            {E.DIMS.filter(d => d.appeal === a.id).map(d => (
              <details key={d.id} className="group rounded-xl hover:bg-surface2 px-2 -mx-2">
                <summary className="list-none cursor-pointer py-2">
                  <div className="flex justify-between gap-2 text-[13px] mb-1.5"><span className="font-medium">{d.name}</span><Icon name="chevron" size={14} className="text-muted group-open:rotate-180 transition" /></div>
                  <div className="h-1.5 rounded-full bg-surface2"><div className={cx("h-full rounded-full", tone(a.id).bg)} style={{ width: (100 * d.weight / maxW) + "%" }} /></div>
                </summary>
                <div className="text-[12.5px] text-muted pb-3 leading-relaxed">
                  <p className="mb-1.5">{d.description}</p>
                  <p><b className="text-ink">What 4 looks like:</b> {d.rubric["4"]}</p>
                  <p className="mt-1.5">Evidence: {d.evidence_basis}. Based on {E.thinkers(d.grounded_in).slice(0, 4).join(", ")}.</p>
                </div>
              </details>
            ))}
          </div>
          <p className="text-xs text-muted mt-3">Bar length shows each dimension's weight within the appeal.</p>
        </Panel>
      ))}
    </div>
  );
}
function ModelView({ E, downloads }) {
  const M = E.MODEL, nlev = M.perspectives.reduce((a, p) => a + p.levers.length, 0);
  return (
    <section>
      <PageHeader title="The model behind the scores" lead={`Version ${M.meta.version}. Four appeals, ${E.LENSES.length} lenses, ${M.perspectives.length} schools of influence and ${nlev} levers, grounded in ${M.knowledge_refs.thinkers.length} thinkers and ${M.research.length + M.knowledge_refs.studies.length} studies.`}
        actions={<SaveButton downloads={downloads} filename="howdoesthisland_model.json" data={M} label="Download model" />} />
      <Pipeline E={E} />

      <Section title="Four appeals" lead="Aristotle's three modes of persuasion, plus kairos for timing. Open any dimension to see its rubric and evidence.">
        <AppealColumns E={E} />
      </Section>

      <div className="grid gap-6 mt-12 lg:grid-cols-2">
        <Panel className="p-6">
          <h2 className="font-display text-[30px] leading-tight">Thirteen schools of influence</h2>
          <p className="text-[13px] text-muted mt-1 mb-4">Petal length shows how many levers each school contributes. Critical suspicion and ethics, in colour, check the persuader as well as the text.</p>
          <PerspectivePetals E={E} />
        </Panel>
        <Panel className="p-6">
          <h2 className="font-display text-[30px] leading-tight">Five kinds of reader</h2>
          <p className="text-[13px] text-muted mt-1 mb-4">Archetypes sit on two research dimensions: appetite for evidence and growth or safety focus. The dashed ring marks the Sceptic's resistance to being sold to.</p>
          <ArchetypeMap E={E} />
        </Panel>
      </div>

      <div className="grid gap-6 mt-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel className="p-6">
          <h2 className="font-display text-[30px] leading-tight">What each kind of text needs</h2>
          <p className="text-[13px] text-muted mt-1 mb-5">Target mix of appeals by content type, before reader settings adjust it.</p>
          <ContentMix E={E} />
        </Panel>
        <Panel className="p-6">
          <h2 className="font-display text-[30px] leading-tight">How strong is the evidence?</h2>
          <p className="text-[13px] text-muted mt-1 mb-5">Most persuasion advice is practitioner wisdom. The model says so, check by check.</p>
          <EvidenceChart M={M} />
        </Panel>
      </div>

      <Section title="Lenses and rhetorical duties" lead="Reported beside the appeals, not folded into the overall score.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {E.LENSES.map(l => (
            <Card key={l.id}>
              <div className="flex items-baseline justify-between"><h3 className="font-display text-[26px] text-lenses">{l.name}</h3><span className="font-display italic text-muted">{l.greek}</span></div>
              <p className="text-[13.5px] mt-2"><b>{l.tagline}.</b> {l.description}</p>
            </Card>
          ))}
        </div>
        <div className="grid gap-4 mt-4 sm:grid-cols-5">
          {E.FN.map(f => (
            <Card key={f.id}><span className="font-display italic text-muted">{f.latin}</span><h3 className="font-display text-[26px]">{f.name}</h3><p className="text-[13px] text-muted mt-1">{f.verb}.</p></Card>
          ))}
        </div>
      </Section>

      <Section title="Evidence register" lead="What the research says and what it changed in the model.">
        <details className="group">
          <summary className="list-none cursor-pointer inline-flex items-center gap-2 h-10 px-4 rounded-xl border border-line bg-surface text-sm font-semibold mb-4">Show all {M.research.length} entries<Icon name="chevron" size={16} className="group-open:rotate-180 transition" /></summary>
          <TableWrap>
            <thead><tr><Th>Source</Th><Th>Finding</Th><Th>What it changed</Th><Th>Evidence</Th></tr></thead>
            <tbody>{M.research.map(rs => <tr key={rs.id}><Td className="text-[13px]">{rs.cite}</Td><Td className="text-[13px]">{rs.finding}</Td><Td className="text-[13px]">{rs.implication}</Td><Td className="text-[13px]"><span className={cx("inline-flex items-center gap-1.5")}><Dot k={EVID_TONE[rs.evidence] || "neutral"} />{EVID_LABEL[rs.evidence] || rs.evidence}</span></Td></tr>)}</tbody>
          </TableWrap>
        </details>
      </Section>

      <Section title="Limitations" lead="Where the model is weakest, and what it does about it.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{M.limitations.map(l => <Card key={l.id}><h3 className="font-display text-[22px] leading-tight">{l.title}</h3><p className="text-[13.5px] mt-2">{l.detail}</p><p className="text-[12.5px] text-muted mt-2">In the model: {l.mitigation}</p></Card>)}</div>
      </Section>
    </section>
  );
}
