import { createEngine, APPEALS, ALL_JUDGES, DEFAULT_CTX, wordCount, locate } from "./engine.js";

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
  craft: { text: "text-craft", bg: "bg-craft", hl: "bg-craft-hl", deco: "decoration-craft", border: "border-craft" },
  audience: { text: "text-audience", bg: "bg-audience", hl: "bg-audience-hl", deco: "decoration-audience", border: "border-audience" },
  culture: { text: "text-culture", bg: "bg-culture", hl: "bg-culture-hl", deco: "decoration-culture", border: "border-culture" },
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
  home: "M3.5 9 10 3.5 16.5 9M5.5 8v8h9V8",
  report: "M5.5 3h6l3 3v11h-9zM11.5 3v3h3M8 10h4.5M8 13h4.5",
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
            <div className="min-w-0 flex-1"><h2 className="font-display text-[28px] leading-tight">{title}</h2>{subtitle && <p className="text-[13px] text-muted mt-1">{subtitle}</p>}</div>
            <IconBtn icon="close" label="Close" onClick={onClose} className="-mr-1.5 -mt-1" />
          </div>
        )}
        {!title && <IconBtn icon="close" label="Close" onClick={onClose} className="absolute right-3 top-4 z-10" style={{ marginTop: "env(safe-area-inset-top, 0px)" }} />}
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
  return { text: s.text || "", ctx: { contentType: E.CT[s.ctx?.contentType] ? s.ctx.contentType : "general", archetype: E.ARCH[s.ctx?.archetype] ? s.ctx.archetype : "general", role: E.ROLE[s.ctx?.role] ? s.ctx.role : "", audience: { ...DEFAULT_CTX.audience, ...(s.ctx?.audience || {}) }, culture: { ...DEFAULT_CTX.culture, ...(s.ctx?.culture || {}) } } };
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
const ROUTES = ["home", "assess", "report", "model", "calibrate", "api", "about"];
function useRoute() {
  const get = () => { const v = (location.hash || "#home").slice(1); return ROUTES.includes(v) ? v : "home"; };
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
  const [judges, setJudges] = useState(() => ({ craft: true, audience: true, culture: true, lenses: true, influence: true, ...store.get("judges", {}) }));
  useEffect(() => { store.set("judges", judges); }, [judges]);
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
    const list = ALL_JUDGES.filter(g => APPEALS.includes(g) || judges[g]);
    const st = {}; list.forEach(g => (st[g] = "running")); setAiStatus(st);
    for (const g of list) {
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
  }, [caps.sample, E, judges]);

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
  const assessText = (t, c) => {
    const nc = { ...DEFAULT_CTX, ...c, audience: { ...DEFAULT_CTX.audience, ...(c?.audience || {}) } };
    setText(t); setCtx(nc); setSource("");
    location.hash = "#assess";
    setTimeout(() => assess(t, nc, ""), 0);
  };
  const newAssessment = () => { setText(""); setSource(""); setAssessed(null); setAi({}); setAiStatus({}); setPrevOverall(null); location.hash = "#assess"; window.scrollTo(0, 0); };

  const sidebar = <Sidebar route={route} theme={theme} setTheme={setTheme} history={history} onRestore={restore} onNew={newAssessment}
    onClearHistory={() => { setHistory([]); toast("History cleared"); }} activeId={assessed?.id} />;

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[272px_minmax(0,1fr)]">
      <aside className="hidden lg:flex sticky top-0 h-screen flex-col border-r border-line bg-surface pt-safe">{sidebar}</aside>
      <Drawer open={navOpen} onClose={() => setNavOpen(false)} side="left" width="max-w-[300px]">{sidebar}</Drawer>
      <div className="min-w-0">
        <div className="lg:hidden sticky top-0 z-30 flex items-center gap-2 h-14 px-3 border-b border-line bg-surface pt-safe box-content">
          <IconBtn icon="menu" label="Open menu" onClick={() => setNavOpen(true)} />
          <a href="#home" className="flex items-center gap-2 text-ink no-underline"><Mark size={24} /><b className="font-display text-[26px]">HowDoesThisLand</b></a>
          <div className="ml-auto"><ThemeMenu theme={theme} setTheme={setTheme} /></div>
        </div>
        <main className="max-w-[1240px] mx-auto px-4 sm:px-6 lg:px-8 pt-6 lg:pt-9 pb-20">
          {route === "assess" && (
            <AssessView E={E} EVAL={EVAL} text={text} setText={setText} ctx={ctx} setCtx={setCtx} setSource={setSource}
              assess={() => assess()} result={result} assessedText={assessed?.text || ""} ai={ai} aiStatus={aiStatus}
              useAi={useAi} setUseAi={setUseAi} judges={judges} setJudges={setJudges} caps={caps} aiBlocked={aiBlocked} aiAvailable={aiAvailable}
              prevOverall={prevOverall} resultsRef={resultsRef} onNew={newAssessment}
              reassessDraft={d => { setText(d); setSource("improved draft"); assess(d, ctx, "improved draft"); }} />
          )}
          {route === "home" && <HomeView E={E} EVAL={EVAL} onAssessText={assessText} />}
          {route === "report" && <ReportView E={E} EVAL={EVAL} onAssessText={assessText} />}
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
const NAV = [["home", "Home", "home"], ["assess", "Assess", "assess"], ["report", "Sample report", "report"], ["model", "The model", "model"], ["calibrate", "Calibrate", "calibrate"], ["api", "API", "api"], ["about", "About", "about"]];
function Sidebar({ route, theme, setTheme, history, onRestore, onNew, onClearHistory, activeId }) {
  return (
    <div className="flex flex-col h-full min-h-0">
      <a href="#home" className="flex items-center gap-2.5 px-5 h-[72px] text-ink no-underline shrink-0">
        <Mark size={28} /><span><b className="block font-display text-[28px] leading-none">HowDoesThisLand</b><span className="block text-xs text-muted mt-1">The art of changing minds</span></span>
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
            <span className="w-9 h-9 shrink-0 rounded-full grid place-items-center font-display text-[18px] border border-line tabular-nums">{h.score}</span>
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
        <h1 className="font-display text-[42px] sm:text-[52px] leading-[1] tracking-[-.01em]">{title}</h1>
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
      <PageHeader title="How will this land?" lead="Paste a CV, landing page, deck or email. HowDoesThisLand scores it on ethos, pathos, logos and kairos, shows where each appears, and suggests how to make a case your reader can trust." />
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
            className="block w-full min-h-[340px] resize-y px-6 py-5 bg-surface font-read text-[16px] leading-[1.75] placeholder:text-muted focus:outline-none" />
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
function ReaderCard({ E, ctx, setCtx, assess, useAi, setUseAi, judges, setJudges, caps, aiBlocked, aiAvailable, onMore }) {
  const set = patch => setCtx(c => ({ ...c, ...patch }));
  const pickRole = v => {
    if (!v) return set({ role: "" });
    const r = E.ROLE[v], f = E.ARCH[r.archetype].focus;
    setCtx(c => ({ ...c, role: v, archetype: r.archetype, audience: { ...c.audience, focus: c.audience.focus === "unknown" && f ? f : c.audience.focus } }));
  };
  const arch = E.ARCH[ctx.archetype];
  return (
    <Panel className="p-5 xl:sticky xl:top-6">
      <h2 className="font-display text-[26px] mb-4">The reader</h2>
      <Field label="What is it?"><Select value={ctx.contentType} onChange={v => set({ contentType: v })}>{E.MODEL.content_types.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
      <Field label="Who reads it?" hint={arch?.key_question ? `They ask: ${arch.key_question}` : undefined}>
        <Select value={ctx.archetype} onChange={v => set({ archetype: v, role: ctx.role && E.ROLE[ctx.role].archetype !== v ? "" : ctx.role })}>
          {E.MODEL.archetypes.map(a => <option key={a.id} value={a.id}>{a.name}{a.motto ? `: ${a.motto}` : ""}</option>)}
        </Select>
      </Field>
      <Field label="Their role"><Select value={ctx.role} onChange={pickRole}><option value="">No specific role</option>{E.MODEL.exec_roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
      <Field label="Their culture" hint={ctx.culture?.reader && ctx.culture.reader !== "global" ? E.lewisLabel(E.COUNTRY[ctx.culture.reader].lewis) + " (Lewis model)" : "Clear, courteous writing that travels well."}>
        <CultureSelect E={E} value={ctx.culture?.reader || "global"} onChange={v => setCtx(c => ({ ...c, culture: { ...c.culture, reader: v } }))} globalLabel="Global or mixed audience" />
      </Field>
      <button onClick={onMore} className="w-full flex items-center gap-2 h-10 px-3 -mt-1 mb-4 rounded-xl text-sm font-semibold text-muted hover:text-ink hover:bg-surface2 transition">
        <Icon name="sliders" />Fine-tune the reader<span className="ml-auto text-xs font-medium">{E.MODS.filter(m => ctx.audience[m.id] !== DEFAULT_CTX.audience[m.id]).length || ""}</span>
      </button>
      <label className={cx("flex gap-3 items-start p-3 rounded-xl border mb-4 cursor-pointer", aiAvailable && useAi ? "border-accent bg-accent-soft" : "border-line")}>
        <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={useAi && aiAvailable} disabled={!aiAvailable} onChange={e => setUseAi(e.target.checked)} />
        <span><b className="text-sm">AI judges</b><br /><span className="text-xs text-muted">{aiNote(caps, aiBlocked)}</span></span>
      </label>
      <JudgePicker E={E} judges={judges} setJudges={setJudges} disabled={!(useAi && aiAvailable)} />
      <Btn variant="primary" size="lg" className="w-full" onClick={() => assess()}>Assess</Btn>
    </Panel>
  );
}

function ReaderDrawer({ E, ctx, setCtx, open, onClose }) {
  const setAud = (k, v) => setCtx(c => ({ ...c, audience: { ...c.audience, [k]: v } }));
  const arch = E.ARCH[ctx.archetype], role = ctx.role ? E.ROLE[ctx.role] : null;
  return (
    <Drawer open={open} onClose={onClose} title="Fine-tune the reader" subtitle="These settings shift how much each appeal matters."
      footer={<div className="flex gap-2"><Btn variant="secondary" onClick={() => setCtx(c => ({ ...c, audience: { ...DEFAULT_CTX.audience }, culture: { ...DEFAULT_CTX.culture, reader: c.culture?.reader || "global" } }))}>Reset</Btn><Btn variant="primary" className="flex-1" onClick={onClose}>Done</Btn></div>}>
      <div className="p-5">
        <Field label="Your culture (the writer's)" hint="HowDoesThisLand flags habits from your culture that may read differently to this reader.">
          <CultureSelect E={E} value={ctx.culture?.writer || ""} onChange={v => setCtx(c => ({ ...c, culture: { ...c.culture, writer: v } }))} globalLabel="Not specified" globalValue="" />
        </Field>
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
      <h2 className="font-display text-[36px] leading-none mr-auto">The assessment</h2>
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
      <text x={C} y={C + 14} textAnchor="middle" fontFamily="var(--display)" fontSize="46" fill="var(--ink)">{r.scores.overall}</text>
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
            <span className="font-display text-[38px] leading-none">{r.scores.band}</span>
            {delta !== null && <span className={cx("text-sm font-semibold tabular-nums", delta > 0 ? "text-ok" : delta < 0 ? "text-warn" : "text-muted")}>{delta > 0 ? "+" : ""}{delta} on last time</span>}
          </div>
          <p className="text-sm text-muted mb-5 flex items-center gap-2">
            {running ? <><Spinner />AI judges reading: {done} of {Object.keys(aiStatus).length} done</> : done ? `Read by ${done} AI judges` : "Quick scan. Turn on AI judges for a reading of meaning."}
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
      <GroupStrip E={E} r={r} />
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
  const M = ({ v, label, cls }) => <div><b className={cx("block font-display text-[30px] tabular-nums leading-none", cls)}>{v}</b><span className="text-xs text-muted">{label}</span></div>;
  return (
    <Block title="Readability" sub="The numbers behind clarity, and rhetorical devices." last>
      <div className="grid grid-cols-3 gap-x-3 gap-y-4">
        <M v={c.words.toLocaleString("en-GB")} label="words" />
        <M v={`${mm}:${ss}`} label="to say aloud" />
        <M v={c.gunning_fog} label={`fog (target ${fogT})`} cls={c.gunning_fog > fogT ? "text-warn" : "text-ok"} />
        <M v={c.passive_pct + "%"} label="passive" cls={c.passive_pct > 10 ? "text-warn" : ""} />
        <M v={c.emotional_pct + "%"} label="emotional" />
        <M v={`${c.you}/${c.we}`} label="you / we" />
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
        <div ref={docRef} tabIndex={0} aria-label="Your text with highlights" className="px-6 sm:px-8 py-6 font-read text-[16.5px] leading-[1.85] whitespace-pre-wrap break-words max-h-[68vh] overflow-auto">
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
          ...E.GROUPS.map(g => ({ id: g.id, label: g.name, count: r.group_scores[g.id], dot: g.id })),
          { id: "lenses", label: "Lenses", dot: "lenses" }, { id: "influence", label: "Influence", dot: "ink" },
          { id: "flags", label: "Trust risks", count: r.red_flags.length },
        ]} />
        <div className="px-5 pt-5 pb-6 max-h-[78vh] overflow-auto">
          {tab === "flags" ? <FlagsTab E={E} r={r} /> : tab === "culture" ? <CultureTab E={E} r={r} status={aiStatus.culture} aiAvailable={aiAvailable} text={text} jump={jump} /> : tab === "influence" ? <InfluenceTab E={E} r={r} ai={ai} status={aiStatus.influence} aiAvailable={aiAvailable} text={text} jump={jump} />
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
    <Drawer open={open} onClose={onClose} width="max-w-[760px]" title="Rewrite with Claude" subtitle="Keeps your voice and your facts. Anything it can't know becomes a [placeholder] for you to fill."
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
      <div className="px-6 sm:px-8 py-6 font-read text-[16.5px] leading-[1.85] whitespace-pre-wrap">
        {view === "original" ? text : (
          <>
            {busy && !draft && <span className="flex items-center gap-2 font-ui text-sm text-muted"><Spinner />Writing the improved draft…</span>}
            {draft ? parts.map((s, i) => /^\[.*\]$/.test(s) ? <mark key={i} className="bg-kairos-hl text-kairos rounded px-1">{s}</mark> : <React.Fragment key={i}>{s}</React.Fragment>)
              : !busy && (
                <div className="font-ui text-sm text-muted max-w-[52ch]">
                  {sample ? <>Claude will apply the recommendations from this assessment, aiming for {focus === "balanced" ? "the best balance for this reader" : `stronger ${focus}`} using only claims you can stand behind, and leaving the decision with your reader.</> : "Rewriting needs Claude access. Open this page in Claude to use it. The recommendations in the assessment still apply."}
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

function StatusLine({ status, label, aiAvailable }) {
  if (status === "running") return <div className="flex items-center gap-2 text-[13px] text-muted mb-3"><Spinner />The {label} judge is reading. Showing the quick scan until it finishes.</div>;
  if (status === "done") return <div className="text-[13px] text-muted mb-3">Assessed by the AI judge.</div>;
  if (status && status.startsWith("error:")) return <div className="text-[13px] text-warn mb-3">{status.slice(6)}</div>;
  return <div className="text-[13px] text-muted mb-3">Quick scan: pattern matching, not reading.{aiAvailable ? " Turn on AI judges for a reading of meaning." : ""}</div>;
}
function Expandable({ head, children, sub }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button aria-expanded={open} onClick={() => setOpen(o => !o)} className="flex w-full justify-between items-center gap-2.5 text-left">{head}</button>
      {sub}
      {open && <div className="text-[13px] mt-2.5 px-3.5 py-3 bg-surface2 rounded-xl">{children}</div>}
    </>
  );
}
function DimList({ E, r, dims, k }) {
  return (
    <ul className="border-t border-line mb-4">
      {dims.map(d => {
        const x = r.dimensions.find(y => y.id === d.id);
        return (
          <li key={d.id} className="border-b border-line py-2.5">
            <Expandable head={<><b className="font-semibold text-sm">{d.name}{d.aristotle_link && <span className="font-display italic text-muted"> {d.aristotle_link}</span>}</b><Pips value={x.score} k={k} /></>}
              sub={<div className="text-[13px] text-muted mt-1">{x.rationale}</div>}>
              <p className="mb-1.5">{d.description}</p>
              {d.rubric && <p className="mb-1.5"><b>What 4 looks like:</b> {d.rubric["4"]}</p>}
              {d.group ? <p className="text-muted">Typical fix: {d.advice}</p> : <p className="text-muted">Based on {E.thinkers(d.grounded_in).slice(0, 5).join(", ")}. Evidence: {d.evidence_basis}.</p>}
            </Expandable>
          </li>
        );
      })}
    </ul>
  );
}
const IMPACT = { high: 0, medium: 1, low: 2 };
function RecCards({ E, recs, k, text, jump }) {
  if (!recs.length) return <p className="text-muted">Nothing pressing here.</p>;
  return [...recs].sort((a, b) => (IMPACT[a.impact] ?? 1) - (IMPACT[b.impact] ?? 1)).map((rc, i) => {
    const d = E.DIM[rc.dimension], m = rc.move ? E.MOVE[rc.move] : null, col = k === "influence" ? E.appealOf(rc.dimension) || "lenses" : k;
    const basis = m ? E.thinkers(m.grounded_in).slice(0, 3).join(", ") : "";
    const found = rc.original && !rc.example && locate(text, rc.original);
    return (
      <div key={i} className={cx("border border-line rounded-2xl px-4 py-3.5 mb-3", rc.source === "library" ? "bg-surface2" : "bg-surface")}>
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-muted mb-1.5"><Dot k={col} />{d ? d.name : rc.dimension}<span>{rc.impact} impact</span>{m && <span>Move: {m.name}</span>}</div>
        <p className="text-sm mb-2">{rc.issue}</p>
        {rc.original && <p className="font-read text-[15px] text-muted border-l-[3px] border-line pl-2.5 py-0.5 mb-1.5">{rc.example ? "Example: " : ""}{rc.original}</p>}
        <p className={cx("font-read text-[15px] border-l-[3px] pl-2.5 py-0.5 mb-2", tone(col).border)}>{rc.rewrite}</p>
        <div className="flex justify-between items-center gap-2">
          <span className="text-xs text-muted">{basis && "Based on " + basis}</span>
          {found && <button className="text-accent font-semibold text-[13px] hover:underline underline-offset-2" onClick={() => jump(found[0], found[1])}>Show in text</button>}
        </div>
      </div>
    );
  });
}
function AppealTab({ E, r, g, status, aiAvailable, text, jump }) {
  const isL = g === "lenses";
  const role = isL && r.audience.role ? E.ROLE[r.audience.role] : null;
  return (
    <>
      <StatusLine status={status} label={isL ? "lenses" : (E.APP[g] || E.GROUP[g]).name.toLowerCase()} aiAvailable={aiAvailable} />
      <p className="font-display text-[21px] leading-snug mb-4">{r.judges[g] || (isL ? "Purpose, worldview and fit: what the four appeals leave out." : (E.APP[g] || E.GROUP[g]).question)}</p>
      {role && (
        <div className="text-[13px] mb-3.5"><b>Reading as {role.name}.</b> Their question: {role.question}<br />
          They care about: {role.cares_about.join(", ")}. Red flags for them: <span className="text-warn">{role.red_flags.join(", ")}</span>.</div>
      )}
      <DimList E={E} r={r} k={g} dims={isL ? E.LENSES : E.GROUP[g] ? E.EXTRA.filter(d => d.group === g) : E.DIMS.filter(d => d.appeal === g)} />
      <h3 className="font-display text-[22px] mt-2 mb-2">Recommendations</h3>
      <RecCards E={E} k={g} text={text} jump={jump} recs={r.recommendations.filter(x => x.appeal === g)} />
    </>
  );
}
const ST_STYLE = { present: "bg-logos-hl text-logos", absent: "bg-surface2 text-muted", misused: "bg-pathos-hl text-warn", not_applicable: "bg-surface2 text-muted opacity-70", unknown: "border border-dashed border-line text-muted" };
const ST_LABEL = { present: "present", absent: "absent", misused: "misused", not_applicable: "n/a", unknown: "not checked" };
function InfluenceTab({ E, r, ai, status, aiAvailable, text, jump }) {
  const recs = r.recommendations.filter(x => x.appeal === "influence");
  return (
    <>
      <StatusLine status={status} label="influence panel" aiAvailable={aiAvailable} />
      <p className="font-display text-[21px] leading-snug mb-4">{ai.influence?.summary || "The same text read through thirteen schools of influence and critical thought. Each lever is marked present, absent or misused."}</p>
      {r.perspectives_source === "quick" && <p className="text-[13px] text-muted -mt-1.5 mb-3">The quick scan can only spot some levers ("not checked" otherwise) and gives a rough score where it can. The AI panel assesses all of them.</p>}
      {r.perspectives.map(p => {
        const P = E.PV[p.id];
        return (
          <div key={p.id} className="border-t border-line py-2.5">
            <Expandable head={<><span><b className="font-semibold text-sm">{P.name}</b><br /><span className="text-xs text-muted">{P.school}</span></span><Pips value={p.score} k="ink" /></>}
              sub={p.summary && <div className="text-[13px] text-muted mt-1">{p.summary}</div>}>
              <p className="text-muted mb-2">{P.question}</p>
              <ul className="grid gap-1.5">
                {p.levers.map(l => {
                  const L = E.LEVER[l.id], st = l.status || "unknown";
                  return (
                    <li key={l.id} className="grid grid-cols-[92px_1fr] gap-2 items-baseline">
                      <span className={cx("text-[11px] font-bold rounded px-1.5 py-px text-center whitespace-nowrap", ST_STYLE[st])}>{ST_LABEL[st]}</span>
                      <span><b>{L.name}</b> <span className="text-[11px] text-muted">evidence: {L.evidence}</span>
                        {l.quote && <><br /><span className="font-read">“{l.quote}”</span></>}{l.note && <span className="text-muted"> {l.note}</span>}
                        {(st === "misused" || st === "absent") && <><br /><span className="text-muted">{st === "misused" ? "Misuse: " + L.misuse : "Look for: " + L.look_for}</span></>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Expandable>
          </div>
        );
      })}
      {recs.length > 0 && <><h3 className="font-display text-[22px] mt-5 mb-2">Recommendations from the panel</h3><RecCards E={E} k="influence" text={text} jump={jump} recs={recs} /></>}
    </>
  );
}
function FlagsTab({ E, r }) {
  return (
    <>
      <p className="font-display text-[21px] leading-snug mb-4">Moments that could cost you the reader's trust once they notice them. Each is checked against the TARES test: would the reader still feel fairly treated if they saw everything?</p>
      {!r.red_flags.length && <p className="text-muted">Nothing here that would cost you the reader's trust.</p>}
      {r.red_flags.map((f, i) => { const m = E.FLAG[f.id]; return (
        <div key={i} className="border-l-[3px] border-warn pl-2.5 py-1 mb-3 text-sm">
          <b>{m ? m.name : f.id}</b> <span className="text-muted text-[13px]">{f.severity}</span><br />
          <q className="font-read">{f.quote}</q><br /><span className="text-muted text-[13px]">{f.note || (m && m.description)}</span>
        </div>
      ); })}
    </>
  );
}


/* ================= Model ================= */
function Section({ title, lead, children }) {
  return <div className="mt-12"><h2 className="font-display text-[34px] leading-tight mb-1.5">{title}</h2>{lead && <p className="text-muted mb-4 max-w-[70ch]">{lead}</p>}{children}</div>;
}
const Card = ({ children, className }) => <div className={cx("bg-surface border border-line rounded-2xl p-5", className)}>{children}</div>;
const Th = ({ children }) => <th className="text-left px-3 py-2 border-b border-line font-semibold text-[13px] text-muted bg-surface2 align-top">{children}</th>;
const Td = ({ children, className }) => <td className={cx("text-left px-3 py-2 border-b border-line align-top", className)}>{children}</td>;
const TableWrap = ({ children }) => <div className="overflow-x-auto border border-line rounded-2xl bg-surface"><table className="w-full border-collapse text-sm">{children}</table></div>;

function SaveButton({ downloads, filename, data, label }) {
  const [msg, setMsg] = useState("");
  const go = async () => {
    try { await downloads.save({ filename, data: new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }) }); setMsg("Saved."); }
    catch (e) { setMsg(e && e.code === "declined" ? "" : "Couldn't save the file here."); }
  };
  return <span className="inline-flex items-center gap-2.5"><Btn size="sm" icon="download" disabled={!downloads || !data} onClick={go}>{label}</Btn><span className="text-[13px] text-muted">{downloads === null ? "Downloads aren't available in this view." : msg}</span></span>;
}

/* ================= Calibrate ================= */
function CalibrateView({ E, EVAL, onOpen, downloads }) {
  const [res, setRes] = useState(null);
  const mark = { ok: "✓", near: "~", miss: "✗" }, cls = { ok: "text-ok", near: "text-kairos", miss: "text-warn" };
  const t = res?.totals;
  return (
    <section>
      <PageHeader title="Calibration" lead="Eighteen test texts with expected score bands, red flags and primary rhetorical duty. Run the quick scan across all of them, or open any case to assess it with the AI judges."
        actions={<><Btn variant="primary" size="md" onClick={() => setRes(E.calibrate(EVAL))}>Run all cases</Btn><SaveButton downloads={downloads} filename="howdoesthisland_eval_set.json" data={EVAL} label="Download set" /></>} />
      <div className="mb-5">
        {t && <p className="text-sm px-4 py-3 rounded-2xl bg-accent-soft"><b>Quick scan:</b> {t.appealHits} of {t.appealN} appeal bands exact, {t.appealNear} one band away; red flags {t.flagHits} of {t.flagN}; primary duty {t.fnHits} of {t.fnN}.</p>}
      </div>
      <TableWrap>
        <thead><tr><Th>Case</Th>{APPEALS.map(a => <Th key={a}>{E.APP[a].name}<br /><span className="font-normal">got / expected</span></Th>)}<Th>Overall</Th><Th>Red flags</Th><Th>Primary duty</Th><Th /></tr></thead>
        <tbody>{EVAL.cases.map((c, i) => {
          const row = res?.rows[i];
          return (
            <tr key={c.id}>
              <Td><b>{c.title}</b><br /><span className="text-muted text-[13px]">{E.CT[c.content_type].name}</span></Td>
              {APPEALS.map((a, j) => { const x = row?.appeals[j]; return <Td key={a} className={x ? cx("font-bold", cls[x.result]) : ""}>{x ? <>{mark[x.result]} {x.score}<br /></> : null}<span className="text-muted text-[13px] font-normal">{c.expect.appeals[a]}</span></Td>; })}
              <Td className={row ? cx("font-bold", cls[row.overall.result]) : ""}>{row && <>{row.overall.score}<br /></>}<span className="text-muted text-[13px] font-normal">{c.expect.overall}</span></Td>
              <Td className="text-[13px]">{row ? `${row.flags.found}/${row.flags.of} found, ${row.flags.clear}/${row.flags.ofClear} clear` : `${c.expect.flags_present.length} expected`}</Td>
              <Td className="text-[13px]">{row?.fn ? <><span className={row.fn.ok ? "text-ok" : "text-warn"}>{row.fn.got}</span> <span className="text-muted">({row.fn.expected})</span></> : c.expect.primary_duty || "n/a"}</Td>
              <Td><Btn size="sm" onClick={() => onOpen(c)}>Open</Btn></Td>
            </tr>
          );
        })}</tbody>
      </TableWrap>
      <p className="text-[13px] text-muted mt-2.5">Bands: low 0 to 44, mid 45 to 70, high 71 to 100. A tick means the band matches; a tilde means one band away. Expectations were set by hand and should be reviewed before being treated as ground truth.</p>
    </section>
  );
}

/* ================= API ================= */
function ApiView({ E, text, ctx, result, downloads }) {
  const [g, setG] = useState("ethos");
  const req = { content: text ? text.slice(0, 160) + (text.length > 160 ? "…" : "") : "Your content here", content_type: ctx.contentType, audience: { archetype: ctx.archetype, role: ctx.role || null, ...ctx.audience }, mode: "full", include: ["lenses", "influence", "duties", "craft"] };
  const api = E.toApi(result);
  const prompt = E.judgePrompt(g, text || "(your content)", ctx).replace(/<content>[\s\S]*<\/content>/, "<content>\n" + (text ? text.slice(0, 600) + (text.length > 600 ? "\n…" : "") : "(your content)") + "\n</content>");
  const Pre = ({ children }) => <pre className="m-0 p-4 overflow-auto font-mono text-[12.5px] leading-normal bg-surface2 rounded-xl max-h-[60vh] whitespace-pre-wrap">{children}</pre>;
  return (
    <section>
      <PageHeader title="API" lead="Every assessment here is produced in the shape the planned API returns. The engine behind this page is the same code the service will run." />
      <div className="grid gap-3.5 md:grid-cols-2">
        <Card className="min-w-0"><h3 className="font-display text-[26px]">Request</h3><p className="text-muted text-[13px] mb-2">POST /v1/assess</p><Pre>{JSON.stringify(req, null, 2)}</Pre></Card>
        <Card className="min-w-0"><h3 className="font-display text-[26px]">Response</h3><div className="my-2"><SaveButton downloads={downloads} filename="howdoesthisland_assessment.json" data={api} label="Download assessment JSON" /></div><Pre>{api ? JSON.stringify(api, null, 2) : "Run an assessment first."}</Pre></Card>
      </div>
      <Section title="Judge prompts" lead="The exact prompt each judge receives, built from the model and your current settings.">
        <select value={g} onChange={e => setG(e.target.value)} className={cx(selectCls, "max-w-xs mb-3")} style={chevronBg}>
          {ALL_JUDGES.map(x => <option key={x} value={x}>{x === "lenses" ? "Lenses and rhetorical duties" : x === "influence" ? "Influence panel" : x === "craft" ? "Craft editor" : (E.APP[x] || E.GROUP[x]).name}</option>)}
        </select>
        <Pre>{prompt}</Pre>
      </Section>
    </section>
  );
}

/* ================= shared chart bits ================= */
const EVID_ORDER = ["strong", "good", "mixed", "practitioner", "weak"];
const EVID_LABEL = { strong: "Strong", good: "Good", mixed: "Mixed", practitioner: "Practitioner", weak: "Weak" };
const EVID_TONE = { strong: "logos", good: "lenses", mixed: "kairos", practitioner: "ink", weak: "pathos" };
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
    sub: "HowDoesThisLand reads your CV, pitch or proposal the way your reader will. It scores credibility, emotion, logic and timing, shows you where each one works, and helps you strengthen the case so your reader can say yes for their own reasons. You can try it now, free, in under a minute.",
    story: "It's eleven at night, the deadline is tomorrow, and you've reread your proposal so many times you can't tell if it's any good.",
    story2: "You're not alone: most people struggle to judge their own writing, because they already know what they meant. Psychologists call it the curse of knowledge, and it's why a second reader helps.",
    compare: "Unlike a grammar checker, which tells you whether a sentence is correct, or a colleague, who tells you whether they like it, HowDoesThisLand tells you whether it will persuade the person you're sending it to, and why.",
    example: `When we tested one cold email, it opened with the sender's job title and asked for a 45-minute call. HowDoesThisLand scored it ${s.rb.scores.overall}. After four changes, starting with the reader's own problem and ending with a smaller ask, it scored ${s.ra.scores.overall}.`,
    nowH: "Fluent writing is now free. Trust isn't.",
    now: "Since anyone can now produce polished text in seconds, polish no longer persuades. Readers have learned to spot the formula, and research on persuasion knowledge shows that when people notice a tactic, they push back. What wins now is what was always hardest to fake: real evidence, honest limits and a clear reason to act. The best persuasion still works when the reader can see exactly how it's done.",
    steps: [
      ["Paste or upload", "Text, Word, PDF or slides. Tell HowDoesThisLand who will read it, because a sceptical CTO reads differently from a time-poor board."],
      ["Six judges read it", `Separate judges for ethos, pathos, logos and kairos, one for purpose and fit, and an influence panel drawing on ${M.perspectives.length} schools of research. Every finding quotes your text, so you can check it.`],
      ["Rewrite, then check again", "Claude rewrites in your voice. Anything it can't know becomes a placeholder, never an invented fact. Assess the new version and see what changed."],
    ],
    honestH: "Built on evidence, and honest about its limits.",
    honest: `You might be wondering whether a score can capture something as human as persuasion. It can't, entirely. Most message tweaks make a small difference, and some popular advice doesn't replicate. That's why HowDoesThisLand shows how strong the evidence is behind every check, and saves its best scores for text that earns them with real proof and honest limits. The model draws on ${M.knowledge_refs.thinkers.length} thinkers, from Aristotle and Cicero to Cialdini, Kahneman and Godin, and on ${M.research.length + M.knowledge_refs.studies.length} published studies, each marked by how well it has held up. In our test set, the quick scan caught all 27 planted red flags.`,
    good: "But what if your writing is already good? Then HowDoesThisLand will say so, and show you why it works, so you can do it again.",
    who: "Built for people who write things that matter: founders, consultants, job seekers and anyone with a pitch to make.",
    ctaH: "Your next important message deserves a second reader.",
    cta: "In short: every week you send important messages without a second reader, some of them miss. Try it now with the message that matters most this week. The quick scan takes 10 seconds and costs nothing; the AI judges take about a minute. Make a case you'd be happy for them to examine.",
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

      <RootsSection E={E} />

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
  const P = { auditor: [0.74, 0.8], builder: [0.5, 0.62], pathfinder: [0.4, 0.2], connector: [0.14, 0.34], sceptic: [0.9, 0.42] };
  const W = 540, H = 400, L = 30, T = 34, R = 30, B = 58;
  const x = v => L + 30 + v * (W - L - R - 60), y = v => T + 26 + v * (H - T - B - 70);
  const col = { auditor: "ethos", builder: "logos", pathfinder: "kairos", connector: "pathos", sceptic: "lenses" };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Map of the five reader archetypes by appetite for evidence and by growth or safety focus">
      <rect x={L} y={T} width={W - L - R} height={H - T - B} rx="16" fill="var(--surface-2)" />
      <line x1={W / 2} y1={T} x2={W / 2} y2={H - B} stroke="var(--line)" strokeDasharray="3 5" />
      <line x1={L} y1={(T + H - B) / 2} x2={W - R} y2={(T + H - B) / 2} stroke="var(--line)" strokeDasharray="3 5" />
      <text x={L + 14} y={T + 22} fontSize="12" fill="var(--muted)" fontFamily="var(--ui)">Growth: drawn to gains</text>
      <text x={L + 14} y={H - B - 12} fontSize="12" fill="var(--muted)" fontFamily="var(--ui)">Safety: avoids mistakes</text>
      <text x={L} y={H - 24} fontSize="12" fill="var(--muted)" fontFamily="var(--ui)">Skims, decides on cues</text>
      <text x={W - R} y={H - 24} fontSize="12" fill="var(--muted)" textAnchor="end" fontFamily="var(--ui)">Reads closely, wants evidence</text>
      <line x1={L + 150} y1={H - 28} x2={W - R - 190} y2={H - 28} stroke="var(--muted)" strokeOpacity=".5" markerEnd="url(#arr)" />
      <defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--muted)" fillOpacity=".6" /></marker></defs>
      {Object.entries(P).map(([id, [px, py]]) => {
        const a = E.ARCH[id]; if (!a) return null;
        return (
          <g key={id}>
            {id === "sceptic" && <circle cx={x(px)} cy={y(py)} r="29" fill="none" stroke={`var(--${col[id]})`} strokeDasharray="2 4" />}
            <circle cx={x(px)} cy={y(py)} r="17" fill={`var(--${col[id]})`} fillOpacity=".2" stroke={`var(--${col[id]})`} strokeWidth="1.5" />
            <text x={x(px)} y={y(py) + 40} textAnchor="middle" fontFamily="var(--display)" fontSize="20" fill="var(--ink)">{a.name.replace("The ", "")}</text>
            <text x={x(px)} y={y(py) + 55} textAnchor="middle" fontFamily="var(--ui)" fontSize="11" fill="var(--muted)">{a.motto}</text>
          </g>
        );
      })}
    </svg>
  );
}
function PerspectivePetals({ E }) {
  const ps = E.MODEL.perspectives, n = ps.length, C = 230, R0 = 44;
  const lens = ps.map(p => p.levers.length), mn = Math.min(...lens), mx = Math.max(...lens);
  return (
    <svg viewBox="-70 0 600 460" className="w-full h-auto" role="img" aria-label="Thirteen influence perspectives, sized by number of levers">
      {ps.map((p, i) => {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2, len = R0 + 52 + ((p.levers.length - mn) / Math.max(1, mx - mn)) * 70, w = 0.21;
        const pt = (ang, r) => `${C + Math.cos(ang) * r},${C + Math.sin(ang) * r}`;
        const tip = pt(a, len), l = pt(a - w, R0 + 26), rr = pt(a + w, R0 + 26), base = pt(a, R0 - 2);
        const lx = C + Math.cos(a) * (len + 14), ly = C + Math.sin(a) * (len + 14);
        const anchor = Math.abs(Math.cos(a)) < 0.25 ? "middle" : Math.cos(a) > 0 ? "start" : "end";
        const hot = p.id === "pv_critical" || p.id === "pv_ethics";
        return (
          <g key={p.id}>
            <path d={`M${base} Q${l} ${tip} Q${rr} ${base}Z`} fill={hot ? "var(--accent)" : "var(--ink)"} fillOpacity={hot ? ".6" : ".1"} stroke={hot ? "var(--accent)" : "var(--muted)"} strokeOpacity={hot ? "1" : ".6"} strokeWidth="1" />
            <text x={lx} y={ly + 4} textAnchor={anchor} fontFamily="var(--ui)" fontSize="12" fill={hot ? "var(--ink)" : "var(--muted)"}>{p.name} <tspan fill="var(--muted)" fillOpacity=".7">{p.levers.length}</tspan></text>
          </g>
        );
      })}
      <circle cx={C} cy={C} r={R0 - 6} fill="var(--surface)" stroke="var(--line)" />
      <text x={C} y={C + 4} textAnchor="middle" fontFamily="var(--display)" fontSize="32" fill="var(--ink)">{lens.reduce((x, y) => x + y, 0)}</text>
      <text x={C} y={C + 20} textAnchor="middle" fontFamily="var(--ui)" fontSize="10" fill="var(--muted)">levers</text>
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
          <div className="flex items-center justify-between gap-3">
            <div><h3 className={cx("font-display text-[34px] leading-none", tone(a.id).text)}>{a.name}</h3><Greek className="block text-muted text-lg mt-1">{a.greek}</Greek></div>
            <Coin id={a.id} size={64} />
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

      <JudgesSection E={E} />
      <CultureModelSection E={E} />

      <Section title="Lenses and rhetorical duties" lead="Reported beside the appeals, not folded into the overall score.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {E.LENSES.map(l => (
            <Card key={l.id}>
              <div className="flex items-baseline justify-between"><h3 className="font-display text-[26px] text-lenses">{l.name}</h3><Greek className="text-muted text-lg">{l.greek}</Greek></div>
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
      <defs><path id={"arc" + uid} d="M27 84A53 53 0 0 1 133 84" /></defs>
      <circle cx="80" cy="80" r="77" fill="var(--surface-2)" stroke="var(--line)" />
      <circle cx="80" cy="80" r="70" fill="none" stroke={col} strokeOpacity=".35" strokeWidth="2.2" strokeDasharray="0.1 5.2" strokeLinecap="round" />
      <circle cx="80" cy="80" r="64" fill="none" stroke={col} strokeOpacity=".25" />
      <text fill={col} fontFamily="var(--greek)" fontSize="17" letterSpacing="6"><textPath href={"#arc" + uid} startOffset="50%" textAnchor="middle">{LEGEND[id]}</textPath></text>
      <g transform="translate(29 36) scale(1.02)" fill="none" stroke={col} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ color: col }}>{EMBLEMS[id]}</g>
    </svg>
  );
}
function Meander({ className }) {
  const uid = React.useId().replace(/:/g, "");
  return (
    <svg className={cx("w-full h-[18px] block", className)} aria-hidden="true">
      <defs>
        <pattern id={"mx" + uid} width="24" height="18" patternUnits="userSpaceOnUse">
          <path d="M0 17H24M2 17V1H18V13H6V5H14V9H10" fill="none" stroke="var(--muted)" strokeOpacity=".45" strokeWidth="1.3" strokeLinecap="square" strokeLinejoin="miter" />
        </pattern>
      </defs>
      <rect width="100%" height="18" fill={`url(#mx${uid})`} />
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
        <figure className="mx-auto text-center"><Coin id="peitho" size={220} /><figcaption className="text-xs text-muted mt-2">Peitho, the Greek goddess of persuasion</figcaption></figure>
        <div>
          <p className="font-display italic text-xl text-muted mb-2">The question to ask before you press send</p>
          <h1 className="font-display text-[52px] sm:text-[80px] leading-[.95] tracking-tight mb-4 break-words">{B.name}</h1>
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
            <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${ds.length}, minmax(0, 1fr))` }}>
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
      {showAll && (() => {
        const base = points.map(p => xy(p.lewis)), pos = base.map(([x, y]) => [x, y]), R = 11;
        for (let it = 0; it < 120; it++) {
          for (let i = 0; i < pos.length; i++) for (let j = i + 1; j < pos.length; j++) {
            let dx = pos[j][0] - pos[i][0], dy = pos[j][1] - pos[i][1], d = Math.hypot(dx, dy);
            if (d < 0.5) { dx = Math.cos(j * 2.4); dy = Math.sin(j * 2.4); d = 1; }
            if (d < 2 * R + 2) { const push = (2 * R + 2 - d) / 2, ux = dx / d, uy = dy / d; pos[i][0] -= ux * push; pos[i][1] -= uy * push; pos[j][0] += ux * push; pos[j][1] += uy * push; }
          }
          for (let i = 0; i < pos.length; i++) { pos[i][0] += (base[i][0] - pos[i][0]) * 0.03; pos[i][1] += (base[i][1] - pos[i][1]) * 0.03; }
        }
        return points.map((p, i) => (
          <g key={p.label}>
            <line x1={base[i][0]} y1={base[i][1]} x2={pos[i][0]} y2={pos[i][1]} stroke="var(--muted)" strokeOpacity=".5" />
            <circle cx={base[i][0]} cy={base[i][1]} r="2" fill="var(--ink)" />
            <circle cx={pos[i][0]} cy={pos[i][1]} r={R} fill="var(--surface)" stroke="var(--culture)" strokeOpacity=".7"><title>{p.label}</title></circle>
            <text x={pos[i][0]} y={pos[i][1] + 3.5} textAnchor="middle" fontFamily="var(--ui)" fontSize="9.5" fontWeight="600" fill="var(--ink)" style={{ pointerEvents: "none" }}>{p.code}</text>
          </g>
        ));
      })()}
      {!showAll && points.map((p, i) => { const [x, y] = xy(p.lewis); return (
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
            {c.gaps.slice(0, 4).map(g => { const s = scaleName(g.scale), pole = (g.diff > 0 ? s.high : s.low), [lab, ...rest] = pole.split(":"); return <li key={g.scale}><b>More {lab.toLowerCase()}.</b> {rest.join(":").trim().replace(/^./, m => m.toUpperCase())}</li>; })}
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
          <LewisTriangle size={460} showAll points={C.countries.map(c => ({ lewis: c.lewis, label: c.name, code: c.id.toUpperCase() }))} />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 mt-4 text-[11.5px] text-muted">
            {[...C.countries].sort((a, b) => a.id.localeCompare(b.id)).map(c => <span key={c.id}><b className="text-ink font-semibold inline-block w-6">{c.id.toUpperCase()}</b>{c.name}</span>)}
          </div>
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
