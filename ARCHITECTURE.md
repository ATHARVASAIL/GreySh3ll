<!--
  ARCHITECTURE.md — a map of the GreySh3ll codebase.
  Read this first if you're new to the code. It explains WHAT each file does
  and HOW the pieces fit together, so you can find the right file fast.
-->

# GreySh3ll — Architecture & Code Map

GreySh3ll is a **100% client-side** VAPT (Vulnerability Assessment & Penetration
Testing) assessment console. There is **no backend and no build step** — it is
static HTML, CSS and vanilla JavaScript that runs entirely in the browser and
saves all state to `localStorage`. It is served as static files (GitHub Pages).

```
Browser ──▶ index.html (Dashboard)      ──▶ localStorage (progress, identity, theme)
        └─▶ assessment.html (Workspace)  ──▶ fetch() data/*.json  (the 817 test cases)
```

---

## 1. The two pages

| File | Role |
|------|------|
| **`index.html`** | The **landing / dashboard**. A premium marketing hero + a live dashboard (coverage ring, severity breakdown, charts, the 10 domain cards). Read-only overview; links into the Workspace. |
| **`assessment.html`** | The **assessment workspace**. The full interactive checklist: sidebar (coverage, filters, categories), the test-case list with expandable detail panels, the Analyst Toolkit, and the PDF report generator. This is where the actual work happens. |

Both pages share a strict **Content-Security-Policy** (`script-src 'self';
style-src 'self'` — no `unsafe-inline`). That single rule shapes the whole
codebase: **no inline `<style>` or `style="..."`, no inline `<script>` or
`onclick`.** Dynamic styling is done with `data-*` attributes + CSS custom
properties, resolved by `applyCspStyles()` (see `core.js`). See `SECURITY.md`.

---

## 2. JavaScript (`js/`)

Scripts load in dependency order and share globals (no module system — this is
deliberately dependency-free). Grouped by concern:

### Shared foundation (loaded on both pages)
| File | What it does |
|------|--------------|
| **`storage.js`** | The data layer. Defines `CATEGORIES`, `SEVERITIES`, status/remediation vocab; loads `data/*.json` into `allData`; loads/saves progress, identity, engagement profiles and theme to `localStorage`; import/export validation. |
| **`core.js`** | Shared state (`state`), CVSS scoring, small format/escape helpers, and **`applyCspStyles()`** — the function that turns `data-pct`/`data-sev` attributes into CSS custom properties without inline styles. |
| **`effects-identity.js`** | The editable identity card (name/subtitle/tagline), avatar initials, typewriter effect. |

### Dashboard page (`index.html`)
| File | What it does |
|------|--------------|
| **`home.js`** | Builds the dashboard: stats, coverage ring, severity bars, the three SVG charts, the 10 domain cards, "Smart Continue" CTA, dashboard search, theme toggle. |
| **`landing-motion.js`** | The landing's motion layer: ambient background, scroll-reveal (`IntersectionObserver`), pointer-glow on cards, magnetic buttons, hero parallax, the domain ticker, stat count-ups. Pure enhancement — degrades gracefully and respects `prefers-reduced-motion`. |

### Workspace page (`assessment.html`)
| File | What it does |
|------|--------------|
| **`rendering.js`** | Renders the category sections and the test-case rows + detail panels (the big one). Uses chunked/lazy rendering so large domains don't block. |
| **`interactions.js`** | Wires up user actions: status changes, flagging, expand/collapse, the sidebar drawer + rail, theme toggle, keyboard shortcuts. |
| **`filters.js`** | Pure filter-matching (`matchesFilters`) and sort logic. No DOM. |
| **`search.js`** | Toolbar search — debounced, filters the visible list. |
| **`dashboard.js`** | The Workspace's own stats/badges overlays and progress/XP computation. |
| **`assessment.js`** | CSV export, and the **PDF report builder** (`buildReportHTML(opts)` + `generateReport()`) — cover, exec summary, findings, appendix. |
| **`report-options.js`** | The "Generate client report" dialog that scopes the PDF (domains / severity / confirmed-only / full vs summary) before `assessment.js` builds it. |
| **`toolkit.js`** | The Analyst Toolkit modal: CVSS calculator, payload cheat-sheet, OSCP-style drills, report-preview tab. |
| **`features.js`** | Scan-output ingestion (Nmap / Nuclei / Burp → suggested matching test cases) and attack-chain sequences. |
| **`primers.js`** | The per-domain "domain basics" primer content (mostly static HTML strings). |
| **`boot.js`** | Workspace boot sequence — loads data, restores state, renders, hides the loader. |

---

## 3. CSS (`css/`) — loaded in cascade order

| File | What it styles |
|------|----------------|
| **`fonts.css`** | `@font-face` for **Carlito** (the self-hosted, metric-identical open clone of Calibri) so the same typography renders on every OS. |
| **`base.css`** | Design tokens (the `:root` custom properties — colours, spacing, radii, severity palette, the `--font-calibri` stack), reset, base typography. **Start here to change the look.** |
| **`layout.css`** | Page scaffolding: topbar, sidebar, main grid, toolbar, modals, the ambient backdrop. |
| **`components.css`** | The reusable pieces: category sections, test-item cards, status system, detail panels, assessor notes, engagement chips. |
| **`responsive-performance.css`** | Breakpoints, the mobile nav-drawer, reduced-motion rules, and the **`@media print`** block that turns the page into a clean PDF report. |
| **`theme-extras.css`** | The light theme, plus badges, the toolkit, command palette and drills. |
| **`landing-premium.css`** | The landing page's premium visual system (hero, ticker, storytelling, atmosphere) — `index.html` only. |
| **`app-cohesion.css`** | Loaded last on **both** pages: unifies the workspace with the landing (shared atmosphere, glass topbar), fixes the light theme, the sidebar full-height + mobile-close behaviour, and styles the report-options dialog. |

---

## 4. Data (`data/`) and the build pipeline (`tools/`)

The 817 test cases live in **`data/<domain>.json`** (one file per domain:
`web.json`, `net.json`, …). Each case carries ~28 fields (description, impact,
steps, payloads, mitigation, CWE/OWASP/MITRE mapping, engagement metadata).

Those source files are **enriched and compiled** by a small Python pipeline in
`tools/`, run in this order after any data change:

```
tools/map-categories.py   → assigns each case its standards category (OWASP/NIST)
tools/map-attack.py       → maps each case to a validated MITRE ATT&CK technique
tools/map-frameworks.py   → adds extra framework references (WSTG, ASVS, …)
tools/build-data.py       → compiles the runtime files the browser fetches:
                              data/index.json      (list, loaded on startup)
                              data/detail/*.json    (full detail, fetched per domain)
                              data/toolkit.json     (payloads for the toolkit)
                            …and re-sequences the case numbers to a contiguous 1..N
```

`tools/field-audit.py` and `tools/check-contrast.py` are quality gates (see below).

---

## 5. Tests & quality gates (`tests/`)

Run from `tests/` with `npm run <name>`:

| Command | Checks |
|---------|--------|
| `npm test` | 152 custom-harness tests (correctness of coverage/risk maths, filters, CSP, rendering, import). |
| `npm run fields` | Every case meets the 7 mandatory content fields (`field-audit.py --strict`). |
| `npm run audit` / `sync` / `categories` / `attack` / `frameworks` | Data-integrity and mapping gates. |
| `npm run fullcheck` | An 18-viewport Playwright sweep — no overflow, no clipped text, touch targets met, no console errors, on both pages. |
| `check-contrast.py` | Every text colour clears WCAG AA 4.5:1 in **both** themes. |

The GitHub Actions **verify** workflow (`.github/workflows/`) runs these on every
push, plus a "case counts match the data" consistency check.

---

## 6. Where to make a change

- **Change the colours / fonts** → `css/base.css` tokens (and `theme-extras.css` for light).
- **Add or edit a test case** → the right `data/<domain>.json`, then run the `tools/` pipeline.
- **Change the PDF report** → `buildReportHTML()` in `js/assessment.js` (+ the `@media print` block in `responsive-performance.css`).
- **Change the landing page** → `index.html` + `css/landing-premium.css` + `js/landing-motion.js`.
- **Change the workspace behaviour** → `js/interactions.js` / `js/rendering.js`.

Because there is no build step, editing a file and reloading the browser is the
entire dev loop. To run locally, serve the folder over HTTP (browsers block
`fetch()` on `file://`):

```bash
python3 -m http.server 8000    # then open http://localhost:8000
```
