> **In this repo** this folder is the original Claude artefact, kept as the reference the
> app is built from. Nothing outside it imports from it. Start with [`BRIEF.md`](./BRIEF.md).
> The build below runs from this folder.

# HowDoesThisLand prototype (React + Tailwind)

Persuasion assessment against ethos, pathos, logos and kairos, with lenses, five rhetorical duties and thirteen influence perspectives.

## Structure
- `src/engine.js`: framework-agnostic engine (quick scan, craft metrics, scoring, judge and rewrite prompts, calibration). No DOM. Reuse it in the API service.
- `src/shell.part.jsx` + `src/App.jsx`: React UI. `App.jsx` is the assembled file; the shell part holds the app frame (sidebar, drawers, menus, toasts, theme), the Assess flow and the score visual.
- `src/views3.part.jsx`: home page (copy written to the HowDoesThisLand model and scored live), sample report, and the model area with charts. Already merged into `App.jsx`.
- `src/greek.part.jsx`: Greek visual system (coin emblems for each appeal and for Peitho, Greek-key divider, lineage timeline, About page). GFS Didot is used only for Greek words. Already merged into `App.jsx`.
- Theme "Tyrian & Graphite": Instrument Serif for display, Geist for text. Colours are CSS variables in `shell.html` with light and dark sets; the sidebar switch sets `data-theme` on `<html>` (Light, Dark or Auto) and is remembered.
- `src/main.jsx`: reads the model and eval set from JSON script tags and mounts the app.
- `tailwind.config.js`: theme colours map to CSS variables, so light and dark mode switch in one place.
- `shell.html` + `build.py`: assemble one self-contained HTML file with the model, eval set, compiled JS and CSS inlined.

## Build
    npm i -D esbuild@0.23.1 tailwindcss@3.4.17
    npx esbuild src/main.jsx --bundle --format=iife --jsx-factory=React.createElement --jsx-fragment=React.Fragment --target=es2020 --minify --outfile=dist/app.js
    npx tailwindcss -c tailwind.config.js -i src/input.css -o dist/app.css --minify
    python3 build.py   # expects howdoesthisland_model.json and howdoesthisland_eval_set.json alongside

## AI judges
In claude.ai the page uses the artifact `sample` capability (`claude.use("sample")`). Outside Claude, swap that for calls to your own API: `engine.judgePrompt(group, text, ctx)` builds each prompt and `engine.validJudgeOutput` checks replies.
