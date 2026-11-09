
/* ================= culture and judges ================= */
function CultureSelect({ E, value, onChange, globalLabel, globalValue = "global" }) {
  const regions = {};
  for (const c of E.CUL.countries) (regions[c.region] = regions[c.region] || []).push(c);
  return (
    <Select value={value} onChange={onChange}>
      <option value={globalValue}>{globalLabel}</option>
      {Object.entries(regions).map(([r, cs]) => (
        <optgroup key={r} label={r}>{[...cs].sort((a, b) => a.name.localeCompare(b.name)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>
      ))}
    </Select>
  );
}

function JudgePicker({ E, judges, setJudges, disabled }) {
  const opts = E.MODEL.judge_catalogue.filter(j => !j.always);
  const on = opts.filter(j => judges[j.id]).length;
  return (
    <details className={cx("group mb-4 rounded-xl border border-line", disabled && "opacity-60")}>
      <summary className="list-none cursor-pointer flex items-center gap-2 px-3 h-11 text-sm font-semibold">
        <Icon name="sliders" size={16} className="text-muted" />Judges<span className="text-xs font-medium text-muted">4 appeals + {on} more</span>
        <Icon name="chevron" size={16} className="ml-auto text-muted group-open:rotate-180 transition" />
      </summary>
      <div className="px-3 pb-3 grid gap-1">
        <div className="flex gap-2.5 items-start py-1.5 text-[13px]"><input type="checkbox" checked disabled className="mt-0.5" /><span><b>The four appeals</b><br /><span className="text-muted">Always on.</span></span></div>
        {opts.map(j => (
          <label key={j.id} className="flex gap-2.5 items-start py-1.5 text-[13px] cursor-pointer">
            <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={!!judges[j.id]} disabled={disabled} onChange={e => setJudges(s => ({ ...s, [j.id]: e.target.checked }))} />
            <span><b>{j.name}</b><br /><span className="text-muted">{j.description}</span></span>
          </label>
        ))}
        <p className="text-xs text-muted pt-1">The quick scan always covers every group. These choices control which AI judges read the text.</p>
      </div>
    </details>
  );
}

function GroupStrip({ E, r }) {
  return (
    <div className="grid border-t border-line md:grid-cols-3">
      {E.GROUPS.map((g, i) => {
        const ds = E.EXTRA.filter(d => d.group === g.id);
        const sub = g.id === "culture" ? (r.culture.reader.global ? "Global or mixed audience" : `For ${r.culture.reader.name}`) : g.question;
        return (
          <div key={g.id} className={cx("px-5 sm:px-7 py-5 border-b md:border-b-0 border-line", i < 2 && "md:border-r")}>
            <div className="flex items-baseline justify-between gap-3">
              <h3 className={cx("text-sm font-semibold", tone(g.id).text)}>{g.name}</h3>
              <span className="font-display text-[34px] leading-none tabular-nums">{r.group_scores[g.id]}</span>
            </div>
            <p className="text-xs text-muted mt-0.5 mb-3 line-clamp-2">{sub}</p>
            <div className={cx("grid gap-1.5", g.id === "culture" ? "grid-cols-10" : "grid-cols-6")}>
              {ds.map(d => { const v = r.dimensions.find(x => x.id === d.id).score ?? 0; return (
                <div key={d.id} title={`${d.name}: ${v} of 4`} className="h-8 rounded bg-surface2 relative overflow-hidden">
                  <div className={cx("absolute inset-x-0 bottom-0 rounded", tone(g.id).bg)} style={{ height: (v / 4) * 100 + "%", opacity: .85 }} />
                </div>
              ); })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* Lewis triangle: reactive at the top, linear-active bottom left, multi-active bottom right */
function LewisTriangle({ points, size = 300, labels = true, showAll }) {
  const W = size, H = size * 0.9, pad = 34;
  const V = { reactive: [W / 2, pad], linear: [pad, H - pad], multi: [W - pad, H - pad] };
  const xy = l => [l.linear * V.linear[0] + l.multi * V.multi[0] + l.reactive * V.reactive[0], l.linear * V.linear[1] + l.multi * V.multi[1] + l.reactive * V.reactive[1]];
  return (
    <svg viewBox={`0 0 ${W} ${H + 8}`} className="w-full h-auto" role="img" aria-label="Lewis model triangle">
      <path d={`M${V.reactive}L${V.linear}L${V.multi}Z`} fill="var(--surface-2)" stroke="var(--line)" strokeWidth="1.5" strokeLinejoin="round" />
      {[0.33, 0.66].map(t => <path key={t} d={`M${V.reactive[0] + (V.linear[0] - V.reactive[0]) * t},${V.reactive[1] + (V.linear[1] - V.reactive[1]) * t}L${V.reactive[0] + (V.multi[0] - V.reactive[0]) * t},${V.reactive[1] + (V.multi[1] - V.reactive[1]) * t}`} stroke="var(--line)" strokeDasharray="2 4" />)}
      {labels && <>
        <text x={V.reactive[0]} y={V.reactive[1] - 12} textAnchor="middle" fontFamily="var(--display)" fontSize="17" fill="var(--ink)">Reactive</text>
        <text x={V.linear[0] - 4} y={V.linear[1] + 22} textAnchor="start" fontFamily="var(--display)" fontSize="17" fill="var(--ink)">Linear-active</text>
        <text x={V.multi[0] + 4} y={V.multi[1] + 22} textAnchor="end" fontFamily="var(--display)" fontSize="17" fill="var(--ink)">Multi-active</text>
      </>}
      {points.map((p, i) => { const [x, y] = xy(p.lewis); return (
        <g key={i}>
          <circle cx={x} cy={y} r={p.kind === "reader" ? 7 : p.kind === "writer" ? 6 : 3.5} fill={p.kind === "reader" ? "var(--culture)" : p.kind === "writer" ? "var(--surface)" : "var(--muted)"} fillOpacity={p.kind ? 1 : 0.55} stroke={p.kind === "writer" ? "var(--ink)" : "none"} strokeWidth="1.5">
            <title>{p.label}</title>
          </circle>
          {(p.kind || showAll) && <text x={x + (p.kind ? 11 : 6)} y={y + 4} fontFamily="var(--ui)" fontSize={p.kind ? 12 : 9.5} fontWeight={p.kind ? 600 : 400} fill={p.kind ? "var(--ink)" : "var(--muted)"}>{p.label}</text>}
        </g>
      ); })}
    </svg>
  );
}

function ScaleChart({ E, r }) {
  const c = r.culture;
  return (
    <div className="grid gap-4">
      {E.CUL.scales.map(s => {
        const t = c.reader.targets[s.id], p = c.positions[s.id], w = c.writer?.targets[s.id], tol = c.reader.tolerance;
        const fit = r.dimensions.find(x => x.id === "cul_" + s.id)?.score ?? 0;
        return (
          <div key={s.id}>
            <div className="flex justify-between text-[12px] text-muted mb-1.5"><span>{s.low.split(":")[0]}</span><b className="text-ink font-semibold">{s.name}</b><span>{s.high.split(":")[0]}</span></div>
            <div className="relative h-6">
              <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-surface2" />
              <div className="absolute top-1/2 -translate-y-1/2 h-3 rounded-full bg-culture-hl border border-culture" style={{ left: Math.max(0, t - tol) * 100 + "%", width: (Math.min(1, t + tol) - Math.max(0, t - tol)) * 100 + "%" }} title="What this reader's culture tends to expect" />
              {w !== undefined && <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rotate-45 border border-ink bg-surface" style={{ left: w * 100 + "%" }} title="Your culture's usual position" />}
              <div className={cx("absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full border-2 border-surface", fit >= 3 ? "bg-ok" : fit >= 2 ? "bg-kairos" : "bg-warn")} style={{ left: p * 100 + "%" }} title={`Your text: ${Math.round(p * 100)}`} />
            </div>
          </div>
        );
      })}
      <div className="flex flex-wrap gap-4 text-xs text-muted pt-1">
        <span className="inline-flex items-center gap-1.5"><span className="w-5 h-2.5 rounded-full bg-culture-hl border border-culture" />Reader's expected range</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-ok" />Your text</span>
        {c.writer && <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rotate-45 border border-ink" />Your culture's habit</span>}
      </div>
    </div>
  );
}

function CultureTab({ E, r, status, aiAvailable, text, jump }) {
  const c = r.culture, prof = c.reader.global ? null : E.COUNTRY[c.reader.id];
  const scaleName = id => E.CUL.scales.find(s => s.id === id);
  return (
    <>
      <StatusLine status={status} label="culture" aiAvailable={aiAvailable} />
      <p className="font-display text-[21px] leading-snug mb-4">{r.judges.culture || (c.reader.global ? "Written for a global or mixed audience: clear, explicit and courteous travels best." : `How this will read in ${c.reader.name}.`)}</p>
      <div className="grid gap-5 sm:grid-cols-[180px_1fr] items-center mb-6">
        <LewisTriangle size={200} labels={false} points={[{ lewis: c.reader.lewis, label: c.reader.global ? "Global" : c.reader.name, kind: "reader" }, ...(c.writer ? [{ lewis: c.writer.lewis, label: c.writer.name, kind: "writer" }] : [])]} />
        <div className="text-[13.5px]">
          <p className="font-semibold">{c.reader.lewis_label}.</p>
          {!c.reader.global && <p className="text-muted mt-1.5 leading-relaxed">{E.CUL.poles.find(p => p.id === Object.entries(c.reader.lewis).sort((a, b) => b[1] - a[1])[0][0]).writing}</p>}
          <p className="text-xs text-muted mt-2">Placement is an estimate. Individuals, regions and professions vary.</p>
        </div>
      </div>
      {c.gaps.length > 0 && (
        <div className="mb-6 p-4 rounded-2xl bg-culture-hl">
          <h4 className="text-sm font-semibold mb-2">Writing from {c.writer.name} to {c.reader.name}</h4>
          <ul className="grid gap-1.5 text-[13px]">
            {c.gaps.slice(0, 4).map(g => { const s = scaleName(g.scale); return <li key={g.scale}><b>{s.name}:</b> {g.diff > 0 ? s.high : s.low}</li>; })}
          </ul>
        </div>
      )}
      <h4 className="text-sm font-semibold mb-3">Where your text sits</h4>
      <ScaleChart E={E} r={r} />
      {prof && (
        <>
          <h4 className="text-sm font-semibold mt-7 mb-3">Hofstede profile for {prof.name}</h4>
          <div className="grid gap-2.5">
            {E.CUL.hofstede_dims.map(d => { const v = prof.hofstede[d.id]; return (
              <div key={d.id} className="grid grid-cols-[150px_1fr_30px] items-center gap-3 text-[12.5px]" title={v == null ? "No published score" : (v >= 50 ? d.high : d.low)}>
                <span>{d.name}</span>
                <div className="h-2 rounded-full bg-surface2"><div className="h-full rounded-full bg-culture" style={{ width: (v ?? 0) + "%", opacity: v == null ? 0 : .8 }} /></div>
                <span className="text-right tabular-nums text-muted">{v ?? "n/a"}</span>
              </div>
            ); })}
          </div>
          <p className="text-xs text-muted mt-2">Approximate published scores; relative, not absolute. Hover a bar for what it means for your writing.</p>
        </>
      )}
      <div className="mt-7"><DimList E={E} r={r} k="culture" dims={E.EXTRA.filter(d => d.group === "culture")} /></div>
      <h3 className="font-display text-[22px] mt-2 mb-2">Recommendations</h3>
      <RecCards E={E} k="culture" text={text} jump={jump} recs={r.recommendations.filter(x => x.appeal === "culture")} />
    </>
  );
}

/* ---------- model page sections ---------- */
function JudgesSection({ E }) {
  const col = { core: "accent", craft: "craft", audience: "audience", culture: "culture", lenses: "lenses", influence: "ink" };
  return (
    <Section title="The judges" lead="Each judge reads the text for one thing. The four appeals always run; choose the others when you assess.">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {E.MODEL.judge_catalogue.map(j => {
          const ds = j.id === "core" ? E.DIMS : j.id === "lenses" ? E.LENSES : j.id === "influence" ? [] : E.EXTRA.filter(d => d.group === j.id);
          return (
            <Card key={j.id}>
              <div className="flex items-center justify-between gap-2 mb-1"><h3 className="font-display text-[26px] leading-tight">{j.name}</h3>{j.always && <span className="text-[11px] font-semibold px-2 h-6 inline-flex items-center rounded-full bg-accent-soft text-accent">Always on</span>}</div>
              <p className="text-[13.5px] text-muted mb-3">{j.description}</p>
              <div className="flex flex-wrap gap-1">
                {(j.id === "influence" ? E.MODEL.perspectives.map(p => p.name) : ds.map(d => d.name)).slice(0, 14).map(n => <span key={n} className="text-[11.5px] px-2 py-0.5 rounded-full bg-surface2 text-muted">{n}</span>)}
              </div>
            </Card>
          );
        })}
      </div>
      <div className="mt-4 p-5 rounded-2xl border border-line bg-surface text-[13.5px]">
        <b>Other judges we could add:</b> <span className="text-muted">brand voice (scored against your own style guide), translation readiness (beyond idioms), accessibility for screen readers and dyslexic readers, regulatory claims checks by sector (financial promotions, health), and a deck judge that reads slide by slide.</span>
      </div>
    </Section>
  );
}

function CultureModelSection({ E }) {
  const C = E.CUL;
  return (
    <Section title="Culture" lead="Anchored in Richard Lewis's three poles, calibrated with Hofstede's six dimensions, and measured in the text on nine scales.">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,.9fr)]">
        <Panel className="p-6">
          <h3 className="font-display text-[26px] leading-tight">Where {C.countries.length} cultures sit</h3>
          <p className="text-[13px] text-muted mt-1 mb-4">Most cultures are a blend. Placements are HowDoesThisLand's estimates; hover a dot for the country.</p>
          <LewisTriangle size={460} showAll points={C.countries.map(c => ({ lewis: c.lewis, label: c.name }))} />
        </Panel>
        <div className="grid gap-4 content-start">
          {C.poles.map(p => (
            <Card key={p.id}>
              <h3 className="font-display text-[24px] leading-tight">{p.name}</h3>
              <p className="text-[13.5px] mt-1">{p.summary}</p>
              <p className="text-[13px] text-muted mt-2"><b className="text-ink">Writing for them:</b> {p.writing}</p>
              <p className="text-xs text-muted mt-2">For example: {p.examples}.</p>
            </Card>
          ))}
        </div>
      </div>
      <div className="grid gap-6 mt-6 lg:grid-cols-2">
        <Panel className="p-6">
          <h3 className="font-display text-[26px] leading-tight mb-4">Nine scales HowDoesThisLand measures in your text</h3>
          <div className="grid gap-3">
            {C.scales.map(s => (
              <div key={s.id} className="text-[13px]">
                <b>{s.name}</b>
                <div className="grid grid-cols-2 gap-3 text-muted mt-0.5"><span>{s.low}</span><span className="text-right">{s.high}</span></div>
              </div>
            ))}
          </div>
        </Panel>
        <Panel className="p-6">
          <h3 className="font-display text-[26px] leading-tight mb-4">Hofstede's six dimensions</h3>
          <div className="grid gap-3">
            {C.hofstede_dims.map(d => <div key={d.id} className="text-[13px]"><b>{d.name}</b><p className="text-muted mt-0.5">High: {d.high} Low: {d.low}</p></div>)}
          </div>
          <p className="text-xs text-muted mt-4">{C.note}</p>
        </Panel>
      </div>
    </Section>
  );
}
