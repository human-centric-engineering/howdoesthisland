import { createEngine, APPEALS, JUDGE_GROUPS, DEFAULT_CTX, wordCount, locate } from "./engine.js";

const { useState, useEffect, useMemo, useRef, useCallback, createContext, useContext } = React;

/* Tailwind needs literal class names, so appeal styles live in one map. */
const TONE = {
  ethos: { text: "text-ethos", bg: "bg-ethos", hl: "bg-ethos-hl", deco: "decoration-ethos", border: "border-ethos" },
  pathos: { text: "text-pathos", bg: "bg-pathos", hl: "bg-pathos-hl", deco: "decoration-pathos", border: "border-pathos" },
  logos: { text: "text-logos", bg: "bg-logos", hl: "bg-logos-hl", deco: "decoration-logos", border: "border-logos" },
  kairos: { text: "text-kairos", bg: "bg-kairos", hl: "bg-kairos-hl", deco: "decoration-kairos", border: "border-kairos" },
  lenses: { text: "text-lenses", bg: "bg-lenses", hl: "bg-lenses-hl", deco: "decoration-lenses", border: "border-lenses" },
  ink: { text: "text-ink", bg: "bg-ink", hl: "bg-surface2", deco: "decoration-ink", border: "border-ink" },
  neutral: { text: "text-muted", bg: "bg-line", hl: "bg-surface2", deco: "decoration-line", border: "border-line" },
  warn: { text: "text-warn", bg: "bg-warn", hl: "bg-pathos-hl", deco: "decoration-warn", border: "border-warn" },
};
const tone = k => TONE[k] || TONE.lenses;
const cx = (...a) => a.filter(Boolean).join(" ");
const AI_ERR = { not_granted: "Claude access was declined for this page.", sampling_disabled: "Claude isn't available on this account.", rate_limited: "Too many requests just now. Try again in a minute.", invalid_json: "This judge's reply couldn't be read. Run the assessment again.", refused: "Claude declined to assess this content.", prompt_too_large: "The content is too long. Assess a shorter section.", session_expired: "Sign in to Claude again, then retry." };
const hlKey = h => `${h.start}:${h.end}:${h.dimension}:${h.polarity}`;
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- icons (1.6px stroke, 20px grid) ---------- */
const PATHS = {
  assess: "M4 5h12M4 10h8M4 15h10",
  model: "M10 3a7 7 0 1 0 0 14a7 7 0 1 0 0-14ZM3 10h14M10 3c2.5 2 2.5 12 0 14M10 3c-2.5 2-2.5 12 0 14",
  calibrate: "M4 16V9M10 16V4M16 16v-5M2.5 16.5h15",
  api: "M7 6 3 10l4 4M13 6l4 4-4 4",
  about: "M10 3a7 7 0 1 0 0 14a7 7 0 1 0 0-14ZM10 9v5M10 6.5v.01",
  menu: "M3.5 6h13M3.5 10h13M3.5 14h13",
  close: "M5 5l10 10M15 5 5 15",
  sun: "M10 6.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7ZM10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M4.3 15.7l1.4-1.4M14.3 5.7l1.4-1.4",
  moon: "M15.5 12.5A6.5 6.5 0 0 1 7.5 4.5a6.5 6.5 0 1 0 8 8Z",
  system: "M3 4.5h14v9H3zM7.5 16.5h5M10 13.5v3",
  sliders: "M4 6h7M15 6h1M4 14h1M9 14h7M13 4v4M7 12v4",
  upload: "M10 13V4M6.5 7.5 10 4l3.5 3.5M4 13v2.5h12V13",
  link: "M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-.8.8M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l.8-.8",
  text: "M4 5h12M10 5v11M7 16h6",
  book: "M4 4.5h4.5A1.5 1.5 0 0 1 10 6v10a1.5 1.5 0 0 0-1.5-1.5H4ZM16 4.5h-4.5A1.5 1.5 0 0 0 10 6v10a1.5 1.5 0 0 1 1.5-1.5H16Z",
  wand: "M4 16 13 7M12 4v2M16 8h-2M15.5 4.5l-1.4 1.4M8 4.5v1M4.5 8h1",
  more: "M5 10h.01M10 10h.01M15 10h.01",
  download: "M10 4v9M6.5 9.5 10 13l3.5-3.5M4 15.5h12",
  copy: "M7 7h9v9H7zM4 13V4h9",
  plus: "M10 4v12M4 10h12",
  chevron: "M7 8l3 3 3-3",
  history: "M4 10a6 6 0 1 0 1.8-4.3M4 4v3h3M10 7v3l2 1.5",
  check: "M4.5 10.5l3.5 3.5 7.5-8",
  trash: "M5 6h10M8 6V4.5h4V6M6.5 6l.6 9.5h5.8l.6-9.5",
};
const Icon = ({ name, size = 18, className }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={cx("shrink-0", className)}>
    <path d={PATHS[name]} />
  </svg>
);

/* ---------- brand mark ---------- */
function Mark({ size = 26, className }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={cx("shrink-0", className)}>
      <path d="M12 5.68 A7 7 0 0 1 12 18.32 A7 7 0 0 1 12 5.68 Z" fill="var(--accent)" />
      <circle cx="9" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="15" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

/* ---------- primitives ---------- */
const Panel = ({ className, children, ...p }) => <div {...p} className={cx("bg-surface border border-line rounded-2xl", className)}>{children}</div>;
function Btn({ variant = "secondary", size = "md", icon, className, children, ...p }) {
  const v = {
    primary: "bg-accent text-accent-ink border-transparent hover:brightness-110 shadow-sm",
    secondary: "bg-surface text-ink border-line hover:bg-surface2",
    ghost: "bg-transparent text-ink border-transparent hover:bg-surface2",
  }[variant];
  const s = { sm: "h-8 px-2.5 text-[13px] gap-1.5", md: "h-10 px-3.5 text-sm gap-2", lg: "h-12 px-5 text-[15px] gap-2" }[size];
  return (
    <button {...p} className={cx("inline-flex items-center justify-center rounded-xl font-semibold border transition disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap", v, s, className)}>
      {icon && <Icon name={icon} size={size === "sm" ? 16 : 18} />}{children}
    </button>
  );
}
const IconBtn = ({ icon, label, className, ...p }) => (
  <button {...p} aria-label={label} title={label} className={cx("inline-flex items-center justify-center w-9 h-9 rounded-xl text-muted hover:text-ink hover:bg-surface2 transition", className)}><Icon name={icon} /></button>
);
const Dot = ({ k, className }) => <span className={cx("inline-block w-2.5 h-2.5 rounded-full shrink-0", tone(k).bg, className)} />;
const Spinner = () => <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-line border-t-accent animate-spin motion-reduce:animate-none" />;
function Field({ label, hint, children }) {
  return <label className="block mb-4"><span className="block text-[13px] font-semibold mb-1.5">{label}</span>{children}{hint && <span className="block text-xs text-muted mt-1">{hint}</span>}</label>;
}
const selectCls = "w-full h-10 pl-3 pr-8 border border-line rounded-xl bg-surface appearance-none bg-no-repeat bg-[right_10px_center] bg-[length:16px] text-sm";
const chevronBg = { backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='none' stroke='%237a8296' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M7 8l3 3 3-3'/%3E%3C/svg%3E\")" };
const Select = ({ value, onChange, children, className, ...p }) => (
  <select {...p} value={value} onChange={e => onChange(e.target.value)} className={cx(selectCls, className)} style={chevronBg}>{children}</select>
);
function Pips({ value, k }) {
  if (value === null || value === undefined) return <span className="text-xs text-muted">needs AI</span>;
  return <span className="inline-flex gap-[3px] shrink-0" aria-label={`${value} of 4`}>{[1, 2, 3, 4].map(i => <i key={i} className={cx("w-3.5 h-1.5 rounded-full", i <= value ? tone(k).bg : "bg-line")} />)}</span>;
}
function Segmented({ items, value, onChange, className, label }) {
  return (
    <div role="tablist" aria-label={label} className={cx("inline-flex p-1 rounded-xl bg-surface2 border border-line gap-0.5", className)}>
      {items.map(it => (
        <button key={it.id} role="tab" aria-selected={value === it.id} onClick={() => onChange(it.id)}
          className={cx("inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-semibold transition", value === it.id ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink")}>
          {it.icon && <Icon name={it.icon} size={16} />}{it.label}
        </button>
      ))}
    </div>
  );
}
function Tabs({ items, value, onChange, className }) {
  return (
    <div role="tablist" className={cx("flex gap-1 px-3 border-b border-line overflow-x-auto scrollbar-none", className)}>
      {items.map(it => (
        <button key={it.id} role="tab" aria-selected={value === it.id} onClick={() => onChange(it.id)}
          className={cx("relative flex items-center gap-1.5 whitespace-nowrap px-2.5 h-11 text-sm font-semibold transition", value === it.id ? "text-ink" : "text-muted hover:text-ink")}>
          {it.dot && <Dot k={it.dot} />}{it.label}{it.count !== undefined && it.count !== null && <span className="font-medium text-muted tabular-nums">{it.count}</span>}
          {value === it.id && <span className="absolute left-2 right-2 -bottom-px h-0.5 rounded-full bg-accent" />}
        </button>
      ))}
    </div>
  );
}

/* ---------- menu ---------- */
function Menu({ trigger, items, align = "right", width = "w-64" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = e => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      {trigger({ open, toggle: () => setOpen(o => !o) })}
      {open && (
        <div role="menu" className={cx("absolute z-40 mt-2 p-1.5 rounded-2xl bg-surface border border-line shadow-pop max-h-[70vh] overflow-auto origin-top animate-pop", width, align === "right" ? "right-0" : "left-0")}>
          {items.map((it, i) => it.divider ? <div key={i} className="h-px bg-line my-1.5" /> : it.heading ? <p key={i} className="px-2.5 pt-2 pb-1 text-xs font-semibold text-muted">{it.heading}</p> : (
            <button key={i} role="menuitem" disabled={it.disabled} onClick={() => { setOpen(false); it.onSelect(); }}
              className="w-full flex items-start gap-2.5 text-left px-2.5 py-2 rounded-xl hover:bg-surface2 disabled:opacity-45 text-sm">
              {it.icon && <Icon name={it.icon} size={17} className="mt-0.5 text-muted" />}
              <span className="min-w-0"><span className="block font-medium truncate">{it.label}</span>{it.hint && <span className="block text-xs text-muted truncate">{it.hint}</span>}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- drawer ---------- */
function Drawer({ open, onClose, title, subtitle, side = "right", width = "max-w-[480px]", children, footer }) {
  const panel = useRef(null);
  useEffect(() => {
    if (!open) return;
    const esc = e => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    const prev = document.activeElement;
    setTimeout(() => panel.current?.focus(), 10);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", esc); document.body.style.overflow = ""; prev && prev.focus && prev.focus(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-scrim animate-fade" onClick={onClose} />
      <div ref={panel} tabIndex={-1} className={cx("absolute top-0 bottom-0 w-full flex flex-col bg-surface shadow-drawer outline-none pt-safe pb-safe", width, side === "right" ? "right-0 animate-slide-l border-l border-line" : "left-0 animate-slide-r border-r border-line")}>
        {title && (
          <div className="flex items-start gap-3 px-5 pt-5 pb-4 border-b border-line">
            <div className="min-w-0 flex-1"><h2 className="font-read text-[22px] font-semibold leading-tight">{title}</h2>{subtitle && <p className="text-[13px] text-muted mt-1">{subtitle}</p>}</div>
            <IconBtn icon="close" label="Close" onClick={onClose} className="-mr-1.5 -mt-1" />
          </div>
        )}
        <div className="flex-1 overflow-auto">{children}</div>
        {footer && <div className="px-5 py-4 border-t border-line bg-surface">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------- toasts ---------- */
const ToastCtx = createContext(() => {});
const useToast = () => useContext(ToastCtx);
function ToastHost({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((msg, kind = "ok") => {
    const id = Math.random().toString(36).slice(2);
    setItems(t => [...t, { id, msg, kind }]);
    setTimeout(() => setItems(t => t.filter(x => x.id !== id)), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed z-[60] bottom-4 left-1/2 -translate-x-1/2 flex flex-col gap-2 items-center pointer-events-none pb-safe" aria-live="polite">
        {items.map(t => (
          <div key={t.id} className="pointer-events-auto flex items-center gap-2 px-4 py-2.5 rounded-xl bg-ink text-surface text-sm font-medium shadow-pop animate-pop">
            <Icon name={t.kind === "ok" ? "check" : "about"} size={16} />{t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    try { const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); const ok = document.execCommand("copy"); ta.remove(); return ok; } catch (e2) { return false; }
  }
}

/* ---------- file reading ---------- */
const libs = {};
function loadScript(src) {
  return libs[src] || (libs[src] = new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("Couldn't load the file reader. Check your connection and try again.")); document.head.appendChild(s); }));
}
async function extractFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) {
    await loadScript("https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js");
    await loadScript("https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js");
    const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages = [];
    for (let i = 1; i <= Math.min(pdf.numPages, 80); i++) {
      const c = await (await pdf.getPage(i)).getTextContent(); let out = "", lastY = null;
      for (const it of c.items) { const y = it.transform ? it.transform[5] : null; if (lastY !== null && y !== null && Math.abs(y - lastY) > 4) out += "\n"; out += it.str; if (it.hasEOL) out += "\n"; lastY = y; }
      pages.push(out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim());
    }
    return pages.join("\n\n");
  }
  if (name.endsWith(".docx")) {
    await loadScript("https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js");
    return (await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value.replace(/\n{3,}/g, "\n\n").trim();
  }
  if (name.endsWith(".pptx")) {
    await loadScript("https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js");
    const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
    const slides = Object.keys(zip.files).filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f)).sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
    const out = [];
    for (const [i, f] of slides.entries()) {
      const xml = new DOMParser().parseFromString(await zip.file(f).async("string"), "application/xml");
      out.push(`Slide ${i + 1}\n` + [...xml.getElementsByTagName("a:p")].map(p => [...p.getElementsByTagName("a:t")].map(t => t.textContent).join("")).filter(Boolean).join("\n"));
    }
    return out.join("\n\n");
  }
  const raw = await file.text();
  if (/\.html?$/.test(name)) {
    const d = new DOMParser().parseFromString(raw, "text/html");
    d.querySelectorAll("script,style,noscript,svg,nav,footer").forEach(n => n.remove());
    d.querySelectorAll("p,div,li,h1,h2,h3,h4,h5,h6,br,section,article,tr").forEach(n => n.append("\n"));
    return (d.body ? d.body.textContent : "").replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*/g, "\n\n").trim();
  }
  return raw.trim();
}

/* ---------- persistence ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem("peithia:" + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("peithia:" + k, JSON.stringify(v)); } catch (e) {} },
};
function loadSaved(E) {
  const s = store.get("draft", null);
  if (!s) return null;
  return { text: s.text || "", ctx: { contentType: E.CT[s.ctx?.contentType] ? s.ctx.contentType : "general", archetype: E.ARCH[s.ctx?.archetype] ? s.ctx.archetype : "general", role: E.ROLE[s.ctx?.role] ? s.ctx.role : "", audience: { ...DEFAULT_CTX.audience, ...(s.ctx?.audience || {}) } } };
}
const titleOf = t => (t.split("\n").map(s => s.trim()).find(Boolean) || "Untitled").replace(/^(subject:\s*)/i, "").slice(0, 60);
function timeAgo(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "just now"; if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
  return new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/* ---------- hooks ---------- */
function useClaude() {
  const [caps, setCaps] = useState({ sample: undefined, downloads: undefined });
  useEffect(() => {
    if (!window.claude || !window.claude.use) { setCaps({ sample: null, downloads: null }); return; }
    window.claude.use("sample").then(s => setCaps(c => ({ ...c, sample: s })));
    window.claude.use("downloads").then(d => setCaps(c => ({ ...c, downloads: d })));
  }, []);
  return caps;
}
const ROUTES = ["assess", "model", "calibrate", "api", "about"];
function useRoute() {
  const get = () => { const v = (location.hash || "#assess").slice(1); return ROUTES.includes(v) ? v : "assess"; };
  const [r, setR] = useState(get);
  useEffect(() => { const f = () => { setR(get()); window.scrollTo(0, 0); }; window.addEventListener("hashchange", f); return () => window.removeEventListener("hashchange", f); }, []);
  return r;
}
function useTheme() {
  const [theme, setTheme] = useState(() => store.get("theme", "system"));
  useEffect(() => {
    const el = document.documentElement;
    if (theme === "system") el.removeAttribute("data-theme"); else el.setAttribute("data-theme", theme);
    store.set("theme", theme);
  }, [theme]);
  return [theme, setTheme];
}

/* ================= App ================= */
export default function App(props) { return <ToastHost><AppInner {...props} /></ToastHost>; }

function AppInner({ MODEL, EVAL }) {
  const E = useMemo(() => createEngine(MODEL), [MODEL]);
  const saved = useMemo(() => loadSaved(E), [E]);
  const route = useRoute();
  const caps = useClaude();
  const [theme, setTheme] = useTheme();
  const toast = useToast();
  const [navOpen, setNavOpen] = useState(false);
  const [text, setText] = useState(saved?.text || "");
  const [ctx, setCtx] = useState(saved?.ctx || DEFAULT_CTX);
  const [assessed, setAssessed] = useState(null);
  const [ai, setAi] = useState({});
  const [aiStatus, setAiStatus] = useState({});
  const [useAi, setUseAi] = useState(true);
  const [aiBlocked, setAiBlocked] = useState("");
  const [prevOverall, setPrevOverall] = useState(null);
  const [source, setSource] = useState("");
  const [history, setHistory] = useState(() => store.get("history", []));
  const runRef = useRef(0);
  const resultsRef = useRef(null);

  useEffect(() => { store.set("draft", { text: text.slice(0, 60000), ctx }); }, [text, ctx]);
  useEffect(() => { store.set("history", history); }, [history]);
  useEffect(() => setNavOpen(false), [route]);

  const quick = useMemo(() => (assessed ? E.quickScan(assessed.text, ctx) : null), [E, assessed, ctx]);
  const result = useMemo(() => (quick ? E.assemble(assessed.text, ctx, quick, ai, assessed.source || null) : null), [E, quick, ai, assessed, ctx]);
  const aiAvailable = !!caps.sample && !aiBlocked;

  // keep the latest score in history once AI judges finish
  useEffect(() => {
    if (!result || !assessed) return;
    setHistory(h => h.map(x => x.id === assessed.id ? { ...x, score: result.scores.overall, band: result.scores.band } : x));
  }, [result?.scores.overall]);

  const runJudges = useCallback((t, c, runId) => {
    const st = {}; JUDGE_GROUPS.forEach(g => (st[g] = "running")); setAiStatus(st);
    for (const g of JUDGE_GROUPS) {
      caps.sample.json(E.judgePrompt(g, t, c), { modelTier: "default" })
        .then(out => {
          if (runId !== runRef.current) return;
          if (!E.validJudgeOutput(g, out)) throw { code: "invalid_json" };
          setAi(a => ({ ...a, [g]: out })); setAiStatus(s => ({ ...s, [g]: "done" }));
        })
        .catch(e => {
          if (runId !== runRef.current) return;
          setAiStatus(s => ({ ...s, [g]: "error:" + (AI_ERR[e && e.code] || "This judge didn't finish. The quick scan result is shown instead.") }));
          if (e && (e.code === "not_granted" || e.code === "sampling_disabled")) setAiBlocked(AI_ERR[e.code]);
        });
    }
  }, [caps.sample, E]);

  const assess = useCallback((t = text, c = ctx, src = source) => {
    if (wordCount(t) < 5) { toast("Add a few sentences first.", "info"); return false; }
    if (result) setPrevOverall(result.scores.overall);
    runRef.current += 1; setAi({}); setAiStatus({});
    const id = Date.now().toString(36);
    const q = E.quickScan(t, c), r0 = E.assemble(t, c, q, {});
    setHistory(h => [{ id, title: titleOf(t), at: Date.now(), text: t, ctx: c, score: r0.scores.overall, band: r0.scores.band, type: E.CT[c.contentType].name }, ...h.filter(x => x.text !== t)].slice(0, 12));
    setAssessed({ id, text: t, source: src || null });
    if (useAi && aiAvailable) runJudges(t, c, runRef.current);
    setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" }), 60);
    return true;
  }, [text, ctx, source, result, useAi, aiAvailable, runJudges, E, toast]);

  const restore = item => {
    setText(item.text); setCtx({ ...DEFAULT_CTX, ...item.ctx, audience: { ...DEFAULT_CTX.audience, ...(item.ctx?.audience || {}) } }); setSource("");
    if (location.hash !== "#assess") location.hash = "#assess";
    setTimeout(() => assess(item.text, item.ctx, ""), 0);
  };
  const openCase = c => {
    const nc = E.caseCtx(c);
    setText(c.text); setCtx(nc); setSource("calibration " + c.id);
    location.hash = "#assess";
    setTimeout(() => assess(c.text, nc, "calibration " + c.id), 0);
  };
  const newAssessment = () => { setText(""); setSource(""); setAssessed(null); setAi({}); setAiStatus({}); setPrevOverall(null); location.hash = "#assess"; window.scrollTo(0, 0); };

  const sidebar = <Sidebar route={route} theme={theme} setTheme={setTheme} history={history} onRestore={restore} onNew={newAssessment}
    onClearHistory={() => { setHistory([]); toast("History cleared"); }} activeId={assessed?.id} />;

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[272px_minmax(0,1fr)]">
      <aside className="hidden lg:flex sticky top-0 h-screen flex-col border-r border-line bg-surface pt-safe">{sidebar}</aside>
      <Drawer open={navOpen} onClose={() => setNavOpen(false)} side="left" width="max-w-[300px]">{sidebar}</Drawer>
      <div className="min-w-0">
        <div className="lg:hidden sticky top-0 z-30 flex items-center gap-2 h-14 px-3 border-b border-line bg-surface/95 backdrop-blur pt-safe box-content">
          <IconBtn icon="menu" label="Open menu" onClick={() => setNavOpen(true)} />
          <a href="#assess" className="flex items-center gap-2 text-ink no-underline"><Mark size={24} /><b className="font-read text-xl font-semibold">HowDoesThisLand</b></a>
          <div className="ml-auto"><ThemeMenu theme={theme} setTheme={setTheme} /></div>
        </div>
        <main className="max-w-[1240px] mx-auto px-4 sm:px-6 lg:px-8 pt-6 lg:pt-9 pb-20">
          {route === "assess" && (
            <AssessView E={E} EVAL={EVAL} text={text} setText={setText} ctx={ctx} setCtx={setCtx} setSource={setSource}
              assess={() => assess()} result={result} assessedText={assessed?.text || ""} ai={ai} aiStatus={aiStatus}
              useAi={useAi} setUseAi={setUseAi} caps={caps} aiBlocked={aiBlocked} aiAvailable={aiAvailable}
              prevOverall={prevOverall} resultsRef={resultsRef} onNew={newAssessment}
              reassessDraft={d => { setText(d); setSource("improved draft"); assess(d, ctx, "improved draft"); }} />
          )}
          {route === "model" && <ModelView E={E} downloads={caps.downloads} />}
          {route === "calibrate" && <CalibrateView E={E} EVAL={EVAL} onOpen={openCase} downloads={caps.downloads} />}
          {route === "api" && <ApiView E={E} text={text} ctx={ctx} result={result} downloads={caps.downloads} />}
          {route === "about" && <AboutView E={E} />}
        </main>
      </div>
    </div>
  );
}

/* ---------- sidebar ---------- */
const NAV = [["assess", "Assess", "assess"], ["model", "The model", "model"], ["calibrate", "Calibrate", "calibrate"], ["api", "API", "api"], ["about", "About HowDoesThisLand", "about"]];
function Sidebar({ route, theme, setTheme, history, onRestore, onNew, onClearHistory, activeId }) {
  return (
    <div className="flex flex-col h-full min-h-0">
      <a href="#assess" className="flex items-center gap-2.5 px-5 h-[68px] text-ink no-underline shrink-0">
        <Mark size={28} /><span><b className="block font-read text-[23px] font-semibold leading-none tracking-tight">HowDoesThisLand</b><span className="block text-xs text-muted mt-1">The art of changing minds</span></span>
      </a>
      <div className="px-3 pb-3"><Btn variant="primary" icon="plus" className="w-full" onClick={onNew}>New assessment</Btn></div>
      <nav className="px-3 grid gap-0.5" aria-label="Main">
        {NAV.map(([id, label, icon]) => (
          <a key={id} href={"#" + id} aria-current={route === id ? "page" : undefined}
            className={cx("flex items-center gap-3 h-10 px-3 rounded-xl text-sm font-semibold no-underline transition", route === id ? "bg-accent-soft text-accent" : "text-muted hover:text-ink hover:bg-surface2")}>
            <Icon name={icon} />{label}
          </a>
        ))}
      </nav>
      <div className="mt-6 px-5 flex items-center justify-between">
        <span className="text-xs font-semibold text-muted">Recent</span>
        {history.length > 0 && <button onClick={onClearHistory} className="text-xs text-muted hover:text-ink">Clear</button>}
      </div>
      <div className="flex-1 min-h-0 overflow-auto px-3 py-2">
        {history.length === 0 ? <p className="px-2 text-[13px] text-muted leading-snug">Your assessments appear here, so you can come back to them.</p> : history.map(h => (
          <button key={h.id} onClick={() => onRestore(h)}
            className={cx("w-full text-left flex items-center gap-3 px-2.5 py-2 rounded-xl transition", activeId === h.id ? "bg-surface2" : "hover:bg-surface2")}>
            <span className="w-9 h-9 shrink-0 rounded-full grid place-items-center font-read text-[15px] font-semibold border border-line tabular-nums">{h.score}</span>
            <span className="min-w-0"><span className="block text-[13px] font-semibold truncate">{h.title}</span><span className="block text-xs text-muted truncate">{h.type}, {timeAgo(h.at)}</span></span>
          </button>
        ))}
      </div>
      <div className="px-4 py-4 border-t border-line pb-safe">
        <Segmented label="Theme" value={theme} onChange={setTheme} className="w-full justify-between"
          items={[{ id: "light", label: "Light", icon: "sun" }, { id: "dark", label: "Dark", icon: "moon" }, { id: "system", label: "Auto", icon: "system" }]} />
      </div>
    </div>
  );
}
function ThemeMenu({ theme, setTheme }) {
  return <Menu width="w-44" trigger={({ toggle }) => <IconBtn icon={theme === "dark" ? "moon" : theme === "light" ? "sun" : "system"} label="Theme" onClick={toggle} />}
    items={[{ label: "Light", icon: "sun", onSelect: () => setTheme("light") }, { label: "Dark", icon: "moon", onSelect: () => setTheme("dark") }, { label: "Match system", icon: "system", onSelect: () => setTheme("system") }]} />;
}

/* ---------- page header ---------- */
function PageHeader({ title, lead, actions }) {
  return (
    <div className="flex flex-wrap items-end gap-4 mb-7">
      <div className="min-w-0 flex-1">
        <h1 className="font-read text-[34px] sm:text-[40px] leading-[1.05] font-semibold tracking-tight">{title}</h1>
        {lead && <p className="text-muted mt-2.5 max-w-[66ch] text-[15px]">{lead}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/* ================= Assess ================= */
function AssessView(p) {
  const { E, result } = p;
  const [readerOpen, setReaderOpen] = useState(false);
  const [rewriteOpen, setRewriteOpen] = useState(false);
  return (
    <section>
      <PageHeader title="How will this land?" lead="Paste a CV, landing page, deck or email. HowDoesThisLand scores it on ethos, pathos, logos and kairos, shows where each appears, and suggests how to rewrite it." />
      <div className="grid gap-5 items-start xl:grid-cols-[minmax(0,1fr)_340px]">
        <EditorCard {...p} />
        <ReaderCard {...p} onMore={() => setReaderOpen(true)} />
      </div>
      <ReaderDrawer {...p} open={readerOpen} onClose={() => setReaderOpen(false)} />
      {result && (
        <div ref={p.resultsRef} className="mt-10 scroll-mt-20">
          <ResultsHeader E={E} r={result} text={p.assessedText} downloads={p.caps.downloads} onRewrite={() => setRewriteOpen(true)} canRewrite={p.aiAvailable} onNew={p.onNew} aiStatus={p.aiStatus} />
          <ScoreHero E={E} r={result} aiStatus={p.aiStatus} prevOverall={p.prevOverall} />
          <Workspace E={E} r={result} text={p.assessedText} ai={p.ai} aiStatus={p.aiStatus} aiAvailable={p.aiAvailable} />
          <RewriteDrawer open={rewriteOpen} onClose={() => setRewriteOpen(false)} E={E} r={result} text={p.assessedText} ctx={p.ctx}
            sample={p.aiAvailable ? p.caps.sample : null} onReassess={d => { setRewriteOpen(false); p.reassessDraft(d); }} />
        </div>
      )}
    </section>
  );
}

function EditorCard({ E, EVAL, text, setText, setCtx, setSource }) {
  const [tab, setTab] = useState("paste");
  const [fileMsg, setFileMsg] = useState("");
  const [over, setOver] = useState(false);
  const [url, setUrl] = useState("");
  const fileRef = useRef(null);
  const toast = useToast();
  const loadExample = c => { setText(c.text); setSource("example"); setCtx(x => ({ ...x, contentType: c.content_type })); setTab("paste"); };
  const handleFile = async file => {
    setFileMsg("Reading " + file.name + "…");
    try {
      const t = await extractFile(file);
      if (!t) throw new Error("No text found. If this is a scanned PDF, copy the text out of it and paste it instead.");
      setText(t); setSource(file.name); setTab("paste"); setFileMsg("");
      toast(`Read ${wordCount(t).toLocaleString("en-GB")} words from ${file.name}`);
      const n = file.name.toLowerCase();
      const pick = /cv|resume|résumé/.test(n) ? "cv_resume" : /deck|pitch/.test(n) || n.endsWith(".pptx") ? "pitch_deck" : /proposal|tender/.test(n) ? "sales_proposal" : /board|brief|memo/.test(n) ? "exec_briefing" : null;
      if (pick) setCtx(c => ({ ...c, contentType: pick }));
    } catch (e) { setFileMsg(e.message || "That file couldn't be read. Try another format or paste the text."); }
  };
  const groups = {};
  EVAL.cases.forEach(c => { const k = E.CT[c.content_type].name; (groups[k] = groups[k] || []).push(c); });
  const exampleItems = Object.entries(groups).flatMap(([k, cs]) => [{ heading: k }, ...cs.map(c => ({ label: c.title, onSelect: () => loadExample(c) }))]);
  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-line">
        <Segmented label="Source" value={tab} onChange={setTab} items={[{ id: "paste", label: "Text", icon: "text" }, { id: "file", label: "File", icon: "upload" }, { id: "url", label: "Web page", icon: "link" }]} />
        <div className="ml-auto flex items-center gap-1">
          <Menu width="w-72" trigger={({ toggle }) => <Btn variant="ghost" size="sm" icon="book" onClick={toggle}>Examples</Btn>} items={exampleItems} />
          {text && <IconBtn icon="trash" label="Clear text" onClick={() => { setText(""); setSource(""); }} />}
        </div>
      </div>
      {tab === "paste" && (
        <div className="relative">
          <label htmlFor="src" className="sr-only">Content to assess</label>
          <textarea id="src" value={text} onChange={e => { setText(e.target.value); setSource(""); }}
            placeholder="Paste the text you want to assess. Anything from a one-line headline to a 20-page proposal."
            className="block w-full min-h-[340px] resize-y px-6 py-5 bg-surface font-read text-[17px] leading-[1.7] placeholder:text-muted focus:outline-none" />
          <span className="absolute right-4 bottom-3 text-xs text-muted tabular-nums pointer-events-none">{wordCount(text).toLocaleString("en-GB")} words</span>
        </div>
      )}
      {tab === "file" && (
        <div className="p-5">
          <div role="button" tabIndex={0} onClick={() => fileRef.current.click()} onKeyDown={e => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), fileRef.current.click())}
            onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={e => { e.preventDefault(); setOver(false); e.dataTransfer.files[0] && handleFile(e.dataTransfer.files[0]); }}
            className={cx("grid place-items-center text-center min-h-[300px] rounded-2xl border-2 border-dashed cursor-pointer transition", over ? "border-accent bg-accent-soft" : "border-line bg-surface2 hover:border-muted")}>
            <div>
              <span className="mx-auto mb-3 grid place-items-center w-12 h-12 rounded-2xl bg-surface border border-line"><Icon name="upload" size={22} /></span>
              <strong className="block text-base mb-1">Drop a file here, or choose one</strong>
              <span className="text-[13px] text-muted">PDF, Word, PowerPoint, HTML, Markdown or plain text</span>
              {fileMsg && <p className="text-[13px] text-muted mt-3">{fileMsg}</p>}
            </div>
            <input ref={fileRef} type="file" accept=".pdf,.docx,.pptx,.txt,.md,.html,.htm" hidden onChange={e => e.target.files[0] && handleFile(e.target.files[0])} />
          </div>
        </div>
      )}
      {tab === "url" && (
        <div className="p-5 min-h-[340px]">
          <Field label="Page address"><input type="url" value={url} onChange={e => { setUrl(e.target.value); setSource(e.target.value); }} placeholder="https://example.com/pricing" className="w-full h-10 px-3 border border-line rounded-xl bg-surface text-sm" /></Field>
          <div className="text-[13px] text-muted bg-surface2 rounded-xl px-4 py-3 max-w-[60ch]">
            Fetching pages arrives with the API service. For now, open the page, select all, copy, and paste it under{" "}
            <button className="text-accent font-semibold underline underline-offset-2" onClick={() => setTab("paste")}>Text</button>. The address stays attached as the source.
          </div>
        </div>
      )}
    </Panel>
  );
}

function aiNote(caps, aiBlocked) {
  if (caps.sample === undefined) return "Checking access to Claude…";
  if (aiBlocked) return aiBlocked;
  if (caps.sample) return "Six judges read for meaning, using your Claude account.";
  return window.claude ? "Not available in this view. The quick scan still works." : "Available when this page is opened in Claude. The quick scan works anywhere.";
}
function ReaderCard({ E, ctx, setCtx, assess, useAi, setUseAi, caps, aiBlocked, aiAvailable, onMore }) {
  const set = patch => setCtx(c => ({ ...c, ...patch }));
  const pickRole = v => {
    if (!v) return set({ role: "" });
    const r = E.ROLE[v], f = E.ARCH[r.archetype].focus;
    setCtx(c => ({ ...c, role: v, archetype: r.archetype, audience: { ...c.audience, focus: c.audience.focus === "unknown" && f ? f : c.audience.focus } }));
  };
  const arch = E.ARCH[ctx.archetype];
  return (
    <Panel className="p-5 xl:sticky xl:top-6">
      <h2 className="font-read text-xl font-semibold mb-4">The reader</h2>
      <Field label="What is it?"><Select value={ctx.contentType} onChange={v => set({ contentType: v })}>{E.MODEL.content_types.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
      <Field label="Who reads it?" hint={arch?.key_question ? `They ask: ${arch.key_question}` : undefined}>
        <Select value={ctx.archetype} onChange={v => set({ archetype: v, role: ctx.role && E.ROLE[ctx.role].archetype !== v ? "" : ctx.role })}>
          {E.MODEL.archetypes.map(a => <option key={a.id} value={a.id}>{a.name}{a.motto ? `: ${a.motto}` : ""}</option>)}
        </Select>
      </Field>
      <Field label="Their role"><Select value={ctx.role} onChange={pickRole}><option value="">No specific role</option>{E.MODEL.exec_roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
      <button onClick={onMore} className="w-full flex items-center gap-2 h-10 px-3 -mt-1 mb-4 rounded-xl text-sm font-semibold text-muted hover:text-ink hover:bg-surface2 transition">
        <Icon name="sliders" />Fine-tune the reader<span className="ml-auto text-xs font-medium">{E.MODS.filter(m => ctx.audience[m.id] !== DEFAULT_CTX.audience[m.id]).length || ""}</span>
      </button>
      <label className={cx("flex gap-3 items-start p-3 rounded-xl border mb-4 cursor-pointer", aiAvailable && useAi ? "border-accent bg-accent-soft" : "border-line")}>
        <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={useAi && aiAvailable} disabled={!aiAvailable} onChange={e => setUseAi(e.target.checked)} />
        <span><b className="text-sm">AI judges</b><br /><span className="text-xs text-muted">{aiNote(caps, aiBlocked)}</span></span>
      </label>
      <Btn variant="primary" size="lg" className="w-full" onClick={() => assess()}>Assess</Btn>
    </Panel>
  );
}

function ReaderDrawer({ E, ctx, setCtx, open, onClose }) {
  const setAud = (k, v) => setCtx(c => ({ ...c, audience: { ...c.audience, [k]: v } }));
  const arch = E.ARCH[ctx.archetype], role = ctx.role ? E.ROLE[ctx.role] : null;
  return (
    <Drawer open={open} onClose={onClose} title="Fine-tune the reader" subtitle="These settings shift how much each appeal matters."
      footer={<div className="flex gap-2"><Btn variant="secondary" onClick={() => setCtx(c => ({ ...c, audience: { ...DEFAULT_CTX.audience } }))}>Reset</Btn><Btn variant="primary" className="flex-1" onClick={onClose}>Done</Btn></div>}>
      <div className="p-5">
        {(arch?.primary || role) && (
          <div className="mb-5 p-4 rounded-2xl bg-surface2 text-[13px]">
            {arch?.primary && <p className="mb-1.5"><b>{arch.name}.</b> {arch.basis}. Persuaded by {arch.persuaded_by.join(", ")}; put off by {arch.backfires.join(", ")}.</p>}
            {role && <p><b>{role.name}.</b> Cares about {role.cares_about.join(", ")}. Red flags: {role.red_flags.join(", ")}.</p>}
          </div>
        )}
        {E.MODS.map(m => (
          <Field key={m.id} label={m.name} hint={m.options.find(o => o.id === ctx.audience[m.id])?.guidance}>
            <Select value={ctx.audience[m.id]} onChange={v => setAud(m.id, v)}>{m.options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</Select>
          </Field>
        ))}
      </div>
    </Drawer>
  );
}

/* ---------- results header ---------- */
function ResultsHeader({ E, r, text, downloads, onRewrite, canRewrite, onNew, aiStatus }) {
  const toast = useToast();
  const summary = () => [`HowDoesThisLand assessment: ${r.scores.overall} (${r.scores.band})`, ...APPEALS.map(a => `${E.APP[a].name}: ${r.scores[a]}`),
    ...r.balance_findings.map(b => `${b.name}: ${b.message}`),
    "", "Top recommendations:", ...r.recommendations.filter(x => x.impact === "high").slice(0, 5).map(x => `- ${E.DIM[x.dimension]?.name}: ${x.issue}`)].join("\n");
  const save = async () => {
    try { await downloads.save({ filename: "howdoesthisland_assessment.json", data: new Blob([JSON.stringify(E.toApi(r), null, 2)], { type: "application/json" }) }); toast("Assessment saved"); }
    catch (e) { if (!(e && e.code === "declined")) toast("Couldn't save the file here", "info"); }
  };
  const running = Object.values(aiStatus).some(s => s === "running");
  return (
    <div className="flex flex-wrap items-center gap-3 mb-4">
      <h2 className="font-read text-[28px] font-semibold tracking-tight mr-auto">The assessment</h2>
      <Btn variant="primary" icon="wand" onClick={onRewrite} disabled={!canRewrite} title={canRewrite ? "" : "Needs Claude access"}>Rewrite with Claude</Btn>
      <Menu trigger={({ toggle }) => <IconBtn icon="more" label="More actions" onClick={toggle} className="border border-line bg-surface" />}
        items={[
          { label: "Copy summary", icon: "copy", hint: "Scores and top recommendations", onSelect: async () => toast(await copyText(summary()) ? "Summary copied" : "Couldn't copy here", "ok") },
          { label: "Download as JSON", icon: "download", hint: "Same shape as the API", disabled: !downloads || running, onSelect: save },
          { divider: true },
          { label: "Start a new assessment", icon: "plus", onSelect: onNew },
        ]} />
    </div>
  );
}

/* ---------- score hero: four overlapping circles ---------- */
function VennScore({ E, r }) {
  const [grown, setGrown] = useState(reduceMotion());
  useEffect(() => { if (!grown) { const t = requestAnimationFrame(() => setGrown(true)); return () => cancelAnimationFrame(t); } }, []);
  const C = 160, off = 46, rad = v => 34 + 58 * (v / 100);
  const pos = { ethos: [-1, -1], logos: [1, -1], pathos: [-1, 1], kairos: [1, 1] };
  const maxW = Math.max(...APPEALS.map(a => r.effective_weights[a]));
  const lab = { ethos: [C - 118, 22, "start"], logos: [C + 118, 22, "end"], pathos: [C - 118, 312, "start"], kairos: [C + 118, 312, "end"] };
  return (
    <svg viewBox="0 0 320 324" className="w-full max-w-[300px] mx-auto block" role="img"
      aria-label={`Overall ${r.scores.overall}. ` + APPEALS.map(a => `${E.APP[a].name} ${r.scores[a]}`).join(", ") + ". Dashed rings show the target for this reader."}>
      {APPEALS.map(a => { const [dx, dy] = pos[a]; return <circle key={a + "t"} cx={C + dx * off} cy={C + 2 + dy * off} r={rad(92 * r.effective_weights[a] / maxW)} fill="none" stroke={`var(--${a})`} strokeOpacity=".55" strokeDasharray="3 4" />; })}
      {APPEALS.map(a => { const [dx, dy] = pos[a]; return (
        <circle key={a} cx={C + dx * off} cy={C + 2 + dy * off} r={grown ? rad(r.scores[a]) : 0} fill={`var(--${a})`} fillOpacity=".16" stroke={`var(--${a})`} strokeWidth="1.6"
          style={{ transition: "r .9s cubic-bezier(.2,.8,.2,1)" }} />
      ); })}
      <circle cx={C} cy={C + 2} r="40" fill="var(--surface)" stroke="var(--line)" />
      <text x={C} y={C + 14} textAnchor="middle" fontFamily="var(--read)" fontSize="38" fontWeight="600" fill="var(--ink)">{r.scores.overall}</text>
      {APPEALS.map(a => <text key={a + "l"} x={lab[a][0]} y={lab[a][1]} textAnchor={lab[a][2]} fontFamily="var(--ui)" fontSize="13" fontWeight="700" fill={`var(--${a})`}>{E.APP[a].name} {r.scores[a]}</text>)}
    </svg>
  );
}

function ScoreHero({ E, r, aiStatus, prevOverall }) {
  const running = Object.values(aiStatus).filter(s => s === "running").length;
  const done = Object.values(aiStatus).filter(s => s === "done").length;
  const delta = prevOverall !== null ? r.scores.overall - prevOverall : null;
  const bi = r.scores.balance_index;
  return (
    <Panel className="overflow-hidden">
      <div className="grid gap-x-8 gap-y-6 p-5 sm:p-7 md:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_minmax(0,0.9fr)] items-center">
        <VennScore E={E} r={r} />
        <div>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2 mb-1">
            <span className="font-read text-[30px] font-semibold leading-none">{r.scores.band}</span>
            {delta !== null && <span className={cx("text-sm font-semibold tabular-nums", delta > 0 ? "text-ok" : delta < 0 ? "text-warn" : "text-muted")}>{delta > 0 ? "+" : ""}{delta} on last time</span>}
          </div>
          <p className="text-sm text-muted mb-5 flex items-center gap-2">
            {running ? <><Spinner />AI judges reading: {done} of {JUDGE_GROUPS.length} done</> : done ? `Read by ${done} AI judges` : "Quick scan. Turn on AI judges for a reading of meaning."}
          </p>
          <div className="grid gap-3">
            {APPEALS.map(a => (
              <div key={a} className="grid grid-cols-[72px_1fr_32px] gap-x-3 items-center">
                <b className={cx("text-sm", tone(a).text)}>{E.APP[a].name}</b>
                <div className="relative h-2 bg-surface2 rounded-full">
                  <div className={cx("h-full rounded-full transition-[width] duration-700 motion-reduce:transition-none", tone(a).bg)} style={{ width: r.scores[a] + "%" }} />
                </div>
                <span className="text-right text-sm font-bold tabular-nums">{r.scores[a]}</span>
                <span className="col-start-2 col-span-2 text-xs text-muted mt-0.5">Matters {Math.round(r.effective_weights[a] * 100)}% for this reader</span>
              </div>
            ))}
          </div>
        </div>
        <div className="md:col-span-2 xl:col-span-1 xl:border-l xl:border-line xl:pl-8">
          <h3 className="text-sm font-semibold mb-3">Balance {bi} of 100</h3>
          <p className="text-sm text-muted mb-4">{bi >= 85 ? "The mix of appeals suits" : bi >= 70 ? "The mix is close to what works for" : "The mix is off for"} {E.CT[r.content_type].name.toLowerCase()} with this reader. Dashed rings show the target.</p>
          <ul className="grid gap-2.5">
            {r.balance_findings.map(b => (
              <li key={b.id} className="flex gap-2.5 text-sm"><span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-warn shrink-0" /><span><b>{b.name}.</b> {b.message}</span></li>
            ))}
            {!r.balance_findings.length && <li className="flex gap-2.5 text-sm"><span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-ok shrink-0" />No balance issues found.</li>}
          </ul>
        </div>
      </div>
      <div className="grid border-t border-line md:grid-cols-3">
        <ShareBlock E={E} r={r} /><DutiesBlock E={E} r={r} /><CraftBlock E={E} r={r} />
      </div>
    </Panel>
  );
}
const Block = ({ title, sub, children, last }) => (
  <div className={cx("px-5 sm:px-7 py-5 border-b md:border-b-0 border-line", !last && "md:border-r")}>
    <h3 className="text-sm font-semibold">{title}</h3><p className="text-xs text-muted mt-0.5 mb-4">{sub}</p>{children}
  </div>
);
function ShareBlock({ E, r }) {
  const keys = [...APPEALS, "neutral"], sh = r.appeal_share;
  return (
    <Block title="Where the words go" sub="Share of the text carried by each appeal.">
      <div className="flex h-3 rounded-full overflow-hidden bg-surface2 gap-0.5">{keys.map(k => sh[k] > 0 && <span key={k} className={tone(k).bg} style={{ width: sh[k] + "%" }} title={`${k} ${sh[k]}%`} />)}</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-4 text-[13px]">
        {keys.map(k => <span key={k} className="flex items-center gap-2"><Dot k={k} />{k === "neutral" ? "Neutral" : E.APP[k].name}<b className="ml-auto tabular-nums">{sh[k]}%</b></span>)}
      </div>
    </Block>
  );
}
function DutiesBlock({ E, r }) {
  const sf = r.duties, t = sf.target, prim = E.FN.find(f => f.id === sf.primary);
  return (
    <Block title="What the text is doing" sub={t ? `Mostly: ${prim.name.toLowerCase()}. Fit to this reader ${sf.fit} of 100.` : `Mostly: ${prim.name.toLowerCase()}. Pick a reader to see what they need.`}>
      {E.FN.map(f => (
        <div key={f.id} className="grid grid-cols-[76px_1fr_36px] gap-3 items-center text-[13px] mb-2.5" title={f.verb}>
          <span className={f.id === sf.primary ? "font-bold" : ""}>{f.name}</span>
          <div className="relative h-2 bg-surface2 rounded-full">
            <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: Math.min(100, sf.profile[f.id] * 2) + "%" }} />
            {t && <div className="absolute -top-1 -bottom-1 w-[3px] rounded-full bg-ink" style={{ left: `calc(${Math.min(98, t[f.id] * 2)}% - 1px)` }} title={`Target ${t[f.id]}%`} />}
          </div>
          <span className="text-right tabular-nums text-muted">{sf.profile[f.id]}%</span>
        </div>
      ))}
    </Block>
  );
}
function CraftBlock({ E, r }) {
  const c = r.craft, exec = ["exec_briefing", "sales_proposal", "pitch_deck"].includes(r.content_type) || r.audience.role;
  const fogT = exec ? 12 : 10, mm = Math.floor(c.speaking_sec / 60), ss = String(c.speaking_sec % 60).padStart(2, "0"), d = c.devices;
  const M = ({ v, label, cls }) => <div><b className={cx("block font-read text-2xl font-semibold tabular-nums leading-none", cls)}>{v}</b><span className="text-xs text-muted">{label}</span></div>;
  return (
    <Block title="Craft" sub="Readability and rhetorical devices." last>
      <div className="grid grid-cols-3 gap-x-3 gap-y-4">
        <M v={c.words.toLocaleString("en-GB")} label="words" />
        <M v={`${mm}:${ss}`} label="to say aloud" />
        <M v={c.gunning_fog} label={`Fog index, aim < ${fogT}`} cls={c.gunning_fog > fogT ? "text-warn" : "text-ok"} />
        <M v={c.passive_pct + "%"} label="passive" cls={c.passive_pct > 10 ? "text-warn" : ""} />
        <M v={c.emotional_pct + "%"} label="emotional" />
        <M v={`${c.you}:${c.we}`} label="you : we" />
      </div>
      <p className="text-xs text-muted mt-4">{d.tricolon} rule-of-three, {d.antithesis} contrast, {d.anaphora} repetition, {d.questions} questions, {d.alliteration} alliteration.</p>
    </Block>
  );
}

/* ---------- workspace: document + findings ---------- */
function Workspace({ E, r, text, ai, aiStatus, aiAvailable }) {
  const [filter, setFilter] = useState({ ethos: true, pathos: true, logos: true, kairos: true, lenses: false, weak: true });
  const [active, setActive] = useState(null);
  const [tab, setTab] = useState("ethos");
  const docRef = useRef(null);
  useEffect(() => setActive(null), [text]);

  const visible = useMemo(() => r.highlights.filter(h => filter[h.appeal || "lenses"] && (h.polarity === "strength" || filter.weak)), [r, filter]);
  const segments = useMemo(() => {
    const pts = new Set([0, text.length]); for (const h of visible) { pts.add(h.start); pts.add(h.end); }
    const P = [...pts].sort((a, b) => a - b), out = [];
    for (let i = 0; i < P.length - 1; i++) { const a = P[i], b = P[i + 1]; if (a < b) out.push({ a, b, act: visible.filter(h => h.start <= a && h.end >= b) }); }
    return out;
  }, [visible, text]);
  const activeHl = active ? r.highlights.filter(h => active.includes(hlKey(h))) : [];

  const jump = (a, b) => {
    const h = r.highlights.find(h => h.start <= a && h.end >= b) || r.highlights.find(h => h.start < b && h.end > a);
    if (!h) return;
    setFilter(f => ({ ...f, [h.appeal || "lenses"]: true, weak: f.weak || h.polarity === "weakness" }));
    setActive([hlKey(h)]);
    setTimeout(() => docRef.current?.querySelector("[data-active='1']")?.scrollIntoView({ block: "center", behavior: reduceMotion() ? "auto" : "smooth" }), 30);
  };

  const chips = [["ethos", "Ethos"], ["pathos", "Pathos"], ["logos", "Logos"], ["kairos", "Kairos"], ["lenses", "Lenses"], ["weak", "Weak spots"]];
  return (
    <div className="grid gap-5 mt-5 items-start lg:grid-cols-[minmax(0,1.25fr)_minmax(340px,1fr)]">
      <Panel className="overflow-hidden lg:sticky lg:top-6">
        <div className="flex flex-wrap items-center gap-1.5 px-4 py-3 border-b border-line">
          {chips.map(([k, label]) => (
            <button key={k} aria-pressed={filter[k]} onClick={() => setFilter(f => ({ ...f, [k]: !f[k] }))}
              className={cx("inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[13px] font-semibold border transition", filter[k] ? "border-line bg-surface text-ink" : "border-transparent bg-surface2 text-muted")}>
              <i className={cx("w-2 h-2 rounded-full inline-block", filter[k] ? tone(k === "weak" ? "warn" : k).bg : "bg-line")} />{label}
            </button>
          ))}
        </div>
        <div ref={docRef} tabIndex={0} aria-label="Your text with highlights" className="px-6 sm:px-8 py-6 font-read text-[17.5px] leading-[1.8] whitespace-pre-wrap break-words max-h-[68vh] overflow-auto">
          {segments.map(({ a, b, act }) => {
            const seg = text.slice(a, b);
            if (!act.length) return <React.Fragment key={a}>{seg}</React.Fragment>;
            const strong = act.filter(h => h.polarity === "strength"), lead = strong[0] || act[0], ap = lead.appeal || "lenses";
            const aps = [...new Set(strong.map(h => h.appeal || "lenses"))];
            const keys = act.map(hlKey), isActive = active && keys.some(k => active.includes(k));
            const style = aps.length > 1 ? { background: `linear-gradient(180deg,${aps.map((x, j) => `var(--${x}-hl) ${(j * 100) / aps.length}%,var(--${x}-hl) ${((j + 1) * 100) / aps.length}%`).join(",")})` } : undefined;
            const weakCls = !strong.length ? cx("underline decoration-wavy decoration-[1.5px] underline-offset-[5px]", act.some(h => h.flag) ? "decoration-warn" : tone(ap).deco) : tone(ap).hl;
            return (
              <span key={a} role="button" tabIndex={0} data-active={isActive ? "1" : undefined} style={style}
                onClick={() => setActive(keys)} onKeyDown={e => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setActive(keys))}
                className={cx("rounded-[4px] cursor-pointer py-0.5 transition-shadow", weakCls, isActive && "ring-2 ring-accent")}>{seg}</span>
            );
          })}
        </div>
        <div className="border-t border-line px-5 py-3.5 text-sm bg-surface2 min-h-[54px]">
          {activeHl.length ? activeHl.map((h, i) => {
            const d = E.DIM[h.dimension], ap = h.appeal || "lenses";
            const rec = r.recommendations.find(x => x.original && x.source === "ai" && locate(h.quote, x.original.slice(0, 40)));
            return (
              <div key={i} className="flex gap-2.5 items-baseline my-1">
                <Dot k={h.flag ? "warn" : ap} />
                <span><b className={tone(ap).text}>{d ? d.name : h.dimension}</b> <span className="text-muted">{h.polarity === "strength" ? "strength" : "weak spot"}{h.source === "ai" ? ", AI judge" : ""}</span>{h.note ? ". " + h.note : ""}
                  {rec && <><br /><span className="text-muted">Try:</span> <span className="font-read">{rec.rewrite}</span></>}</span>
              </div>
            );
          }) : <span className="text-muted">Shading marks a strength; a wavy underline marks a weak spot. Select one to see why.</span>}
        </div>
      </Panel>
      <Panel className="overflow-hidden">
        <Tabs value={tab} onChange={setTab} items={[
          ...APPEALS.map(a => ({ id: a, label: E.APP[a].name, count: r.scores[a], dot: a })),
          { id: "lenses", label: "Lenses", dot: "lenses" }, { id: "influence", label: "Influence", dot: "ink" },
          { id: "flags", label: "Red flags", count: r.red_flags.length },
        ]} />
        <div className="px-5 pt-5 pb-6 max-h-[78vh] overflow-auto">
          {tab === "flags" ? <FlagsTab E={E} r={r} /> : tab === "influence" ? <InfluenceTab E={E} r={r} ai={ai} status={aiStatus.influence} aiAvailable={aiAvailable} text={text} jump={jump} />
            : <AppealTab E={E} r={r} g={tab} status={aiStatus[tab]} aiAvailable={aiAvailable} text={text} jump={jump} />}
        </div>
      </Panel>
    </div>
  );
}

/* ---------- rewrite drawer ---------- */
function RewriteDrawer({ open, onClose, E, r, text, ctx, sample, onReassess }) {
  const [focus, setFocus] = useState("balanced");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [view, setView] = useState("draft");
  const ctl = useRef(null);
  const toast = useToast();
  useEffect(() => { setDraft(""); setErr(""); }, [text]);
  const write = async () => {
    ctl.current = new AbortController(); setBusy(true); setErr(""); setDraft(""); setView("draft");
    try { const { text: t } = await sample(E.rewritePrompt(text, ctx, r, focus), { signal: ctl.current.signal, cache: false, onText: ({ text: t }) => setDraft(t) }); setDraft(t); }
    catch (e) {
      if (e && e.code === "refused") { setDraft(""); setErr("Claude declined to rewrite this text."); }
      else { if (e && e.text) setDraft(e.text); if (e && e.code !== "cancelled") setErr(AI_ERR[e.code] || "The draft stopped early. Try again."); }
    } finally { setBusy(false); }
  };
  const parts = draft.split(/(\[[^\]\n]{1,120}\])/g);
  const placeholders = (draft.match(/\[[^\]\n]{1,120}\]/g) || []).length;
  return (
    <Drawer open={open} onClose={onClose} width="max-w-[760px]" title="Rewrite with Claude" subtitle="Keeps your voice. Facts it can't know become [placeholders] for you to fill."
      footer={
        <div className="flex flex-wrap items-center gap-2">
          {busy ? <Btn onClick={() => ctl.current?.abort()}>Stop</Btn> : <Btn variant={draft ? "secondary" : "primary"} icon="wand" onClick={write} disabled={!sample}>{draft ? "Write again" : "Write improved draft"}</Btn>}
          {draft && !busy && <>
            <Btn icon="copy" onClick={async () => toast(await copyText(draft) ? "Draft copied" : "Couldn't copy here", "ok")}>Copy</Btn>
            <Btn variant="primary" className="ml-auto" onClick={() => onReassess(draft)}>Assess this draft</Btn>
          </>}
        </div>
      }>
      <div className="px-5 pt-4 pb-3 border-b border-line flex flex-wrap items-center gap-3">
        <span className="text-[13px] font-semibold">Focus</span>
        <Segmented label="Focus" value={focus} onChange={setFocus} items={[{ id: "balanced", label: "Balanced" }, ...APPEALS.map(a => ({ id: a, label: E.APP[a].name }))]} />
        {draft && <Segmented label="View" value={view} onChange={setView} className="ml-auto" items={[{ id: "draft", label: "Draft" }, { id: "original", label: "Original" }]} />}
      </div>
      <div className="px-6 sm:px-8 py-6 font-read text-[17.5px] leading-[1.8] whitespace-pre-wrap">
        {view === "original" ? text : (
          <>
            {busy && !draft && <span className="flex items-center gap-2 font-ui text-sm text-muted"><Spinner />Writing the improved draft…</span>}
            {draft ? parts.map((s, i) => /^\[.*\]$/.test(s) ? <mark key={i} className="bg-kairos-hl text-kairos rounded px-1">{s}</mark> : <React.Fragment key={i}>{s}</React.Fragment>)
              : !busy && (
                <div className="font-ui text-sm text-muted max-w-[52ch]">
                  {sample ? <>Claude will apply the recommendations from this assessment, aiming for {focus === "balanced" ? "the best balance for this reader" : `stronger ${focus}`} without inventing facts or using pressure tactics.</> : "Rewriting needs Claude access. Open this page in Claude to use it. The recommendations in the assessment still apply."}
                </div>
              )}
            {err && <p className="font-ui text-[13px] text-warn mt-3">{err}</p>}
            {draft && !busy && placeholders > 0 && <p className="font-ui text-[13px] text-muted mt-5">{placeholders} placeholder{placeholders > 1 ? "s" : ""} to fill before you use this.</p>}
          </>
        )}
      </div>
    </Drawer>
  );
}
