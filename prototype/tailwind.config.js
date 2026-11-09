const v = n => `var(--${n})`;
const plugin = require("tailwindcss/plugin");
module.exports = {
  content: ["./src/App.jsx", "./src/main.jsx"],
  theme: {
    extend: {
      colors: {
        bg: v("bg"), surface: v("surface"), surface2: v("surface-2"), ink: v("ink"), muted: v("muted"), line: v("line"),
        accent: v("accent"), "accent-ink": v("accent-ink"), "accent-soft": v("accent-soft"), scrim: v("scrim"),
        ethos: v("ethos"), "ethos-hl": v("ethos-hl"), pathos: v("pathos"), "pathos-hl": v("pathos-hl"),
        logos: v("logos"), "logos-hl": v("logos-hl"), kairos: v("kairos"), "kairos-hl": v("kairos-hl"),
        lenses: v("lenses"), "lenses-hl": v("lenses-hl"), craft: v("craft"), "craft-hl": v("craft-hl"), audience: v("audience"), "audience-hl": v("audience-hl"), culture: v("culture"), "culture-hl": v("culture-hl"), warn: v("warn"), ok: v("ok"),
      },
      fontFamily: { ui: [v("ui")], read: [v("read")], display: [v("display")], greek: [v("greek")] },
      boxShadow: {
        pop: "0 16px 40px -12px var(--shadow), 0 2px 6px -2px var(--shadow)",
        drawer: "0 0 0 1px var(--line), -24px 0 60px -24px var(--shadow)",
      },
      keyframes: {
        pop: { from: { opacity: 0, transform: "translateY(-4px) scale(.98)" }, to: { opacity: 1, transform: "none" } },
        fade: { from: { opacity: 0 }, to: { opacity: 1 } },
        "slide-l": { from: { transform: "translateX(100%)" }, to: { transform: "none" } },
        "slide-r": { from: { transform: "translateX(-100%)" }, to: { transform: "none" } },
      },
      animation: {
        pop: "pop .16s ease-out", fade: "fade .2s ease-out",
        "slide-l": "slide-l .28s cubic-bezier(.2,.8,.2,1)", "slide-r": "slide-r .28s cubic-bezier(.2,.8,.2,1)",
      },
      opacity: { 45: ".45" },
    },
  },
  plugins: [plugin(({ addUtilities }) => addUtilities({
    ".pt-safe": { paddingTop: "env(safe-area-inset-top, 0px)" },
    ".pb-safe": { paddingBottom: "env(safe-area-inset-bottom, 0px)" },
    ".scrollbar-none": { scrollbarWidth: "none" },
    ".scrollbar-none::-webkit-scrollbar": { display: "none" },
  }))],
};
