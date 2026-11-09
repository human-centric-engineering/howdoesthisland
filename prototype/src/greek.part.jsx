
/* ================= Greek visual system ================= */
/* Original line drawings in the manner of ancient coins and engravings. */
const EMBLEMS = {
  // Athena's owl with an olive sprig: practical wisdom (phronesis), the root of ethos
  ethos: (
    <g>
      <path d="M50 30C66 30 72 44 72 58C72 74 62 84 50 84C38 84 28 74 28 58C28 44 34 30 50 30Z" />
      <path d="M36 35 31 22 44 31M64 35 69 22 56 31" />
      <circle cx="40" cy="49" r="8" /><circle cx="60" cy="49" r="8" />
      <circle cx="40" cy="49" r="2.6" fill="currentColor" stroke="none" /><circle cx="60" cy="49" r="2.6" fill="currentColor" stroke="none" />
      <path d="M47 57 50 63 53 57Z" />
      <path d="M34 63C37 71 42 75 46 77M66 63C63 71 58 75 54 77M38 68h4M58 68h4M41 73h3M56 73h3" />
      <path d="M44 84v5M50 84v5M56 84v5" />
      <path d="M73 36C79 30 85 27 91 27" />
      <path d="M79 31Q80 25 85 25Q84 30 79 31ZM85 28Q87 23 91 23Q90 28 85 28ZM77 34Q72 31 72 27Q77 28 77 34Z" />
    </g>
  ),
  // theatre mask: emotion, the root of pathos
  pathos: (
    <g>
      <path d="M28 26C40 20 60 20 72 26C74 46 70 66 50 82C30 66 26 46 28 26Z" />
      <path d="M36 43C40 38 46 38 46 45C42 47 38 47 36 43ZM64 43C60 38 54 38 54 45C58 47 62 47 64 43Z" />
      <path d="M33 36Q40 30 47 35M67 36Q60 30 53 35" />
      <path d="M50 46v8M47 56Q50 58 53 56" />
      <path d="M40 65Q50 57 60 65Q50 72 40 65Z" />
      <path d="M28 30C20 34 18 44 13 51M72 30C80 34 82 44 87 51" />
    </g>
  ),
  // Euclid, Elements I.1: two circles construct an equilateral triangle. Proof, the root of logos
  logos: (
    <g>
      <circle cx="40" cy="60" r="20" /><circle cx="60" cy="60" r="20" />
      <path d="M40 60 60 60 50 42.7Z" strokeWidth="2.6" />
      <circle cx="40" cy="60" r="2.2" fill="currentColor" stroke="none" /><circle cx="60" cy="60" r="2.2" fill="currentColor" stroke="none" /><circle cx="50" cy="42.7" r="2.2" fill="currentColor" stroke="none" />
      <path d="M22 86h56" strokeDasharray="1 4" />
    </g>
  ),
  // scales balanced on a razor's edge, after Lysippos's Kairos: the opportune moment
  kairos: (
    <g>
      <path d="M46 86 50 41 54 86Z" />
      <path d="M22 41h56" strokeWidth="2.6" />
      <path d="M26 41 18 59M26 41 34 59M74 41 66 59M74 41 82 59" />
      <path d="M15 59Q26 67 37 59ZM63 59Q74 67 85 59Z" />
      <path d="M56 74C64 68 72 68 79 62C76 71 67 77 58 79M57 80C64 77 70 78 76 75C72 81 65 84 58 84" />
      <circle cx="50" cy="38" r="2" fill="currentColor" stroke="none" />
    </g>
  ),
  // Peitho: two circles meeting; the same figure as Euclid's construction
  peitho: (
    <g>
      <path d="M50 37.3A21 21 0 0 1 50 72.7A21 21 0 0 1 50 37.3Z" fill="var(--accent)" stroke="none" />
      <circle cx="39" cy="55" r="21" /><circle cx="61" cy="55" r="21" />
    </g>
  ),
};
const LEGEND = { ethos: "ΗΘΟΣ", pathos: "ΠΑΘΟΣ", logos: "ΛΟΓΟΣ", kairos: "ΚΑΙΡΟΣ", peitho: "ΠΕΙΘΩ" };
function Coin({ id, size = 120, className, tint }) {
  const uid = React.useId().replace(/:/g, "");
  const col = tint || (id === "peitho" ? "var(--ink)" : `var(--${id})`);
  return (
    <svg width={size} height={size} viewBox="0 0 160 160" className={cx("shrink-0", className)} role="img" aria-label={`${LEGEND[id]} coin emblem`}>
      <defs><path id={"arc" + uid} d="M24 80A56 56 0 0 1 136 80" /></defs>
      <circle cx="80" cy="80" r="77" fill="var(--surface-2)" stroke="var(--line)" />
      <circle cx="80" cy="80" r="70" fill="none" stroke={col} strokeOpacity=".35" strokeWidth="2.2" strokeDasharray="0.1 5.2" strokeLinecap="round" />
      <circle cx="80" cy="80" r="64" fill="none" stroke={col} strokeOpacity=".25" />
      <text fill={col} fontFamily="var(--greek)" fontSize="15" letterSpacing="5"><textPath href={"#arc" + uid} startOffset="50%" textAnchor="middle">{LEGEND[id]}</textPath></text>
      <g transform="translate(40 46) scale(.8)" fill="none" stroke={col} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: col }}>{EMBLEMS[id]}</g>
    </svg>
  );
}
function Meander({ className }) {
  const uid = React.useId().replace(/:/g, "");
  return (
    <svg className={cx("w-full h-[14px] block", className)} aria-hidden="true">
      <defs>
        <pattern id={"mx" + uid} width="28" height="14" patternUnits="userSpaceOnUse">
          <path d="M0 13H20V1H6V9H14V5H10" fill="none" stroke="var(--line)" strokeWidth="1.4" strokeLinecap="square" />
          <path d="M20 13H28" fill="none" stroke="var(--line)" strokeWidth="1.4" />
        </pattern>
      </defs>
      <rect width="100%" height="14" fill={`url(#mx${uid})`} />
    </svg>
  );
}
const Greek = ({ children, className }) => <span lang="grc" className={cx("font-greek", className)}>{children}</span>;

const GLOSS_EMBLEM = { Ethos: "ethos", Pathos: "pathos", Logos: "logos", Kairos: "kairos", "Peithō": "peitho" };
function AboutView({ E }) {
  const B = E.MODEL.brand;
  return (
    <section className="max-w-[1120px]">
      <div className="grid gap-10 items-center md:grid-cols-[auto_1fr] mb-12">
        <Coin id="peitho" size={220} className="mx-auto" />
        <div>
          <p className="text-muted mb-2"><Greek className="text-[26px] text-ink">Πειθώ</Greek><span className="font-display italic text-xl ml-3">said {B.pronunciation.toLowerCase()}</span></p>
          <h1 className="font-display text-[64px] sm:text-[96px] leading-[.9] tracking-tight mb-4">{B.name}</h1>
          <p className="font-display italic text-[30px] leading-snug mb-4">{B.tagline}.</p>
          <p className="text-muted max-w-[60ch] leading-relaxed">{B.origin} {B.meaning}</p>
        </div>
      </div>
      <Meander />
      <div className="py-12 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center">
        <p className="font-display text-[34px] sm:text-[40px] leading-[1.1] max-w-[22ch]">{B.central_idea}</p>
        <p className="text-muted leading-relaxed max-w-[56ch]">In Greek thought, persuasion (<Greek>πειθώ</Greek>) and trust (<Greek>πίστις</Greek>) were bound together. Peitho was worshipped beside Aphrodite and the Graces, because winning someone over was understood as an art of attraction and goodwill, not force. HowDoesThisLand keeps that standard: it rewards text that earns agreement and penalises text that tries to take it.</p>
      </div>
      <Meander />

      <Section title="The four appeals" lead="Each appeal has an emblem drawn from the Greek world.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {E.MODEL.appeals.map(a => (
            <Card key={a.id} className="text-center">
              <Coin id={a.id} size={132} className="mx-auto mb-3" />
              <h3 className={cx("font-display text-[30px] leading-none", tone(a.id).text)}>{a.name}</h3>
              <Greek className="block text-[20px] text-muted mt-1">{a.greek}</Greek>
              <p className="text-[13.5px] mt-3 leading-relaxed">{a.question}</p>
              <p className="text-xs text-muted mt-3 leading-relaxed">{{ ethos: "Athena's owl, emblem of practical wisdom.", pathos: "The theatre mask, where Greek audiences learned to feel together.", logos: "Euclid's first proposition: two circles, one proof.", kairos: "Scales balanced on a razor, after Lysippos's statue of Kairos." }[a.id]}</p>
            </Card>
          ))}
        </div>
      </Section>

      <Section title="Five principles" lead="What HowDoesThisLand stands for, and where each principle lives in the model.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {B.principles.map(p => (
            <Card key={p.id}>
              <p className="font-display italic text-muted text-base">{p.greek}</p>
              <h3 className="font-display text-[26px] mb-1">{p.name}</h3>
              <p className="text-sm mb-2.5">{p.statement}</p>
              <p className="text-[13px] text-muted"><b className="text-ink">In the app:</b> {p.in_the_model}</p>
            </Card>
          ))}
        </div>
      </Section>

      <Section title="The critical questions" lead={B.critical_questions.source}>
        <div className="grid gap-4 md:grid-cols-[1.4fr_1fr]">
          <Panel className="p-6">
            <ol className="grid gap-4">
              {B.critical_questions.questions.map((q, i) => (
                <li key={i} className="flex gap-4 items-baseline"><span className="font-display text-[30px] text-accent tabular-nums w-7">{i + 1}</span><span className="font-display text-[24px] leading-snug">{q}</span></li>
              ))}
            </ol>
          </Panel>
          <Card className="self-start"><h3 className="font-display text-[22px] mb-1">In the app</h3><p className="text-sm">{B.critical_questions.in_the_model}</p></Card>
        </div>
      </Section>

      <Section title="Greek vocabulary" lead="The words behind the method, and where each appears in the assessment.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {B.glossary.map(t => (
            <Card key={t.term} className="flex gap-4">
              {GLOSS_EMBLEM[t.term] ? <Coin id={GLOSS_EMBLEM[t.term]} size={64} /> : <span className="w-16 h-16 shrink-0 rounded-full border border-line grid place-items-center"><Greek className="text-[26px] text-muted">{t.greek.slice(0, 1)}</Greek></span>}
              <div className="min-w-0">
                <Greek className="block text-[26px] leading-tight">{t.greek}</Greek>
                <p className="font-display italic text-lg text-muted leading-tight">{t.term}</p>
                <p className="text-[13.5px] mt-2">{t.meaning}</p>
                <p className="text-xs text-muted mt-1.5">{t.where}</p>
              </div>
            </Card>
          ))}
        </div>
      </Section>

      <Section title="Brand notes">
        <div className="grid gap-4 md:grid-cols-3">
          <Card><h3 className="font-display text-[22px] mb-1">Visual direction</h3><p className="text-sm">{B.visual.direction} Greek references appear as coin-style line drawings and epigraphic lettering, never marble.</p></Card>
          <Card><h3 className="font-display text-[22px] mb-1">The mark</h3><p className="text-sm">{B.visual.mark} It is also Euclid's figure for his first proof, which is where the logos coin comes from.</p></Card>
          <Card><h3 className="font-display text-[22px] mb-1">Lines and extensions</h3><p className="text-sm">{B.secondary_lines.join(" ")}</p><p className="text-[13px] text-muted mt-2">{B.extensions.join(", ")}</p></Card>
        </div>
      </Section>
    </section>
  );
}

/* home section: roots */
function RootsSection({ E }) {
  return (
    <div className="py-16 border-b border-line">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)] items-end mb-10">
        <h2 className="font-display text-[40px] sm:text-[48px] leading-[1.02] max-w-[14ch]">Rooted in 2,400 years of rhetoric.</h2>
        <p className="text-muted leading-relaxed max-w-[58ch]">Aristotle named three ways to persuade: the speaker's character, the audience's feelings and the argument itself. The Greeks added kairos, the right moment. HowDoesThisLand keeps those four at its core, then tests each one against modern research, because an old idea earns its place only if it still works.</p>
      </div>
      <div className="grid gap-6 grid-cols-2 lg:grid-cols-4">
        {E.MODEL.appeals.map(a => (
          <a key={a.id} href="#about" className="group no-underline text-ink text-center">
            <Coin id={a.id} size={128} className="mx-auto transition-transform duration-500 group-hover:rotate-[8deg] motion-reduce:transition-none" />
            <h3 className={cx("font-display text-[28px] leading-none mt-4", tone(a.id).text)}>{a.name}</h3>
            <Greek className="block text-muted text-lg mt-1">{a.greek}</Greek>
            <p className="text-[13.5px] text-muted mt-2 max-w-[26ch] mx-auto leading-relaxed">{a.question}</p>
          </a>
        ))}
      </div>
    </div>
  );
}
