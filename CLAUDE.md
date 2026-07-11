# CLAUDE.md

Guidance for AI assistants (Claude Code and others) working in this repository.

## What this project is

**Effyra** (formerly / internally still called **NEXA**) is a German-language "personal
AI everyday-life manager" web app. It does not just surface information — it takes work off
the user's plate: photograph a letter/invoice/contract → it explains it in plain words,
detects deadlines, and proposes tasks & calendar entries; plus an AI chat that plans the day.

- **Live:** https://darekkk80-neuss.github.io/Nexa/ (GitHub Pages)
- **Repo:** `Darekkk80-Neuss/Nexa`
- **License:** Proprietary — all rights reserved (public repo only so Pages can serve it; **not** open source).

> **Naming note:** The user-facing brand is now **Effyra** (see `README.md`, `manifest.webmanifest`,
> and all in-app UI strings). Older docs (`KONZEPT.md`, `ZUSAMMENFASSUNG.md`, `BACKEND.md`) and all
> `localStorage`/Supabase identifiers still say **NEXA/nexa**. Both refer to the same product.
> Do **not** mass-rename storage keys or the `nexa_*` prefixes — doing so would orphan every
> existing user's data. Premium codes are `Effyra-XXXX-XXXX` / `NEXA-XXXX-XXXX`.

## Architecture at a glance

This is a **single-file, zero-build, zero-dependency** front end plus an **optional** Supabase backend.

```
index.html          ← THE ENTIRE APP (~5,900 lines: HTML + <style> + one <script>)
translation/*.json  ← i18n dictionaries (de, en, fr, es, it, pl) loaded at runtime
supabase/           ← optional cloud backend (Edge Functions + config)
  functions/claude-proxy/    ← server-side Anthropic key + quota enforcement
  functions/stripe-checkout/ ← create Stripe checkout sessions
  functions/stripe-webhook/  ← apply plan/quota after payment
supabase-setup.sql   ← accounts, profiles, premium_codes, RLS (Phase-1 backend)
supabase-family.sql  ← optional family-sync tables
supabase-tiers.sql   ← Phase-2: tiers, AI quota, RPCs (get_entitlements/consume_ai/apply_purchase)
manifest.webmanifest + icon.svg + bg.jpg   ← PWA / "add to home screen"
README.md · KONZEPT.md · ZUSAMMENFASSUNG.md · BACKEND.md   ← German product/setup docs
```

There is **no package.json, no bundler, no framework, no test suite, no CI**. The app is Vanilla
JavaScript. The only runtime dependency is the `@supabase/supabase-js` UMD bundle loaded from a CDN
(`<script src="...supabase.min.js">`), and Google Fonts. Everything else — routing, state, i18n,
AI calls, PDF/CSV export, weather — is hand-written in `index.html`.

## `index.html` internal structure

One HTML file with three sections. Line numbers drift as the file grows; find sections by their
`/* === SECTION === */` banner comments rather than by fixed line numbers.

1. **`<style>`** (~lines 16–933) — all CSS. Design tokens live under the `TOKENS` banner; theming is
   driven by `document.documentElement.dataset.theme` (`light`/`dark`) plus RTL support via `[dir=rtl]`.
   Each screen/module has its own banner (`DASHBOARD`, `DOKUMENTE`, `CHAT`, `SCHULE`, `FAMILIE`, …).
2. **Markup** (~lines 934–1388) — the auth gate, onboarding, top bar, sidebar/tab-bar nav, and one
   `<section class="view" id="view-*">` per screen (all hidden except the active one).
3. **`<script>`** (~lines 1390–5878) — ~200 functions, no modules. Roughly ordered: helpers → i18n →
   store/state → auth/tiers/quota → per-module renderers → AI layer → weather → boot.

### State & persistence

- Central mutable object **`store`** (defined ~line 1459), merged over `localStorage['nexa_data']`.
  `save()` writes it back. The initializer documents the shape of each collection inline — read those
  comments before touching a data model. Key collections: `tasks`, `events`, `docs`, `chat`, `kids`,
  `profile`, `docFavs`, `life`, `family`, `budget`, `emergency`, `vehicles`, `work`, `settings`.
- **`localStorage` keys** (all `nexa_`-prefixed): `nexa_data` (app state), `nexa_account` (login/plan),
  `nexa_trial0` (trial start, survives account reset so the 3-day trial can't be renewed), `nexa_key`
  (user's own Anthropic key), `nexa_i18n_cache` (machine-translation cache).
- **All user data (tasks/events/docs/chat) stays on-device** by design — the privacy promise. Only
  accounts, trial, and premium status ever touch the cloud. The emergency section is deliberately
  local-only.

### Navigation / views

`showView(id)` toggles the `.active` class on `#view-*` sections. Screens: `dashboard`, `work`
(Arbeitszeit), `docs` (AI document scanner), `docgen` (letter templates), `life` (Lebenslagen),
`tasks`, `calendar`, `school` (Kinder), `family` (Familienzentrale), `emergency` (Notfallbereich),
`vehicles` (Auto & Motorrad), `chat` (Effyra AI), `settings`. Each has renderer functions and,
where applicable, a `ensure*()` initializer that lazily seeds its slice of `store`.

### Internationalization (i18n)

- Supported/translated: **de, en, fr, es, it, pl** (`translation/*.json`, ~220 keys each, kept in sync).
  ~20 more languages are *selectable* in the UI (`LANGS` array) and fall back to English/German or
  on-the-fly machine translation cached in `nexa_i18n_cache`.
- Static text uses `data-i18n` (and `data-i18n-*` for `placeholder`/`title`/`aria-label`); `t(key)`
  resolves at runtime. A MutationObserver (`startI18nObserver`/`i18nSweep`) re-translates dynamically
  inserted DOM. The `I18N` object in `index.html` holds the built-in dictionaries; `translation/*.json`
  are the external, editable copies loaded via `loadLangFile`.
- **When adding UI text:** add a `data-i18n` key and add that key to *all six* `translation/*.json`
  files (and the German entry in the in-file `I18N` map). RTL languages (ar/he/fa) rely on the
  `[dir=rtl]` CSS — keep layouts direction-agnostic.

### AI layer (two modes)

- **`aiCall(payload)`** is the router: if the user has their own key (`usingOwnKey()`), it calls
  **`callClaude`** directly against `https://api.anthropic.com/v1/messages` (BYOK, from the browser,
  using `anthropic-dangerous-direct-browser-access`). Otherwise it calls **`callClaudeHosted`** →
  the Supabase `claude-proxy` Edge Function (server-side key + quota).
- **Demo mode** (no key, backend off) uses `demoAnalyses`/`demoReply` — simulated analyses and scripted
  chat scenarios. The vacation-planning flow genuinely works even in demo.
- Models: `claude-sonnet-5` (default, recommended) and `claude-haiku-4-5-20251001` (fast/cheap),
  chosen in Settings (`store.settings.model`). The proxy allow-lists exactly these two.
- Document analysis (`aiAnalyze`) prompts Claude to return a strict JSON object with a `findings[]`
  array; findings are typed (`expense`, `task`, `event`, `deadline`, `vehicle`, `work`, `child`,
  `family`, `life`, `emergency`, `note`) and routed into the matching module. `extractJSON` /
  `normalizeFindings` parse and sanitize the response — keep that contract if you touch the prompt.

## Feature flags — read before changing behavior

Three constants near the Supabase config (~line 2071–2091) gate major behavior. Their **current
committed state** is the important part:

| Flag | Current | Meaning |
|---|---|---|
| `CLOUD` (derived) | **active** | Real Supabase project is configured (`SUPABASE_URL`/`SUPABASE_ANON_KEY` set) **and** the host is in `ALLOWED_HOSTS`. |
| `BACKEND_V2` | **`false`** | Phase 2 off → no hosted-AI proxy, no Stripe. Payments fall back to premium codes; real AI needs the user's own key. Flip to `true` only after the Phase-2 setup in `BACKEND.md` is fully deployed. |
| `ENFORCE_TIERS` | **`false`** | Permission concept off → **all modules open, no paywall, no trial expiry**. This is the testing state. Set `true` to arm Free/Medium/Premium gating, the 3-day trial, and module locks. |

- **Domain lock:** `ALLOWED_HOSTS = ['darekkk80-neuss.github.io', 'localhost', '127.0.0.1']`. Copies of
  the app on other domains automatically run local-only (no backend access). Add a new host here to
  enable the backend on a new domain.
- `SUPABASE_ANON_KEY` is a **public** publishable key — it is meant to live in the repo. Security comes
  from Row Level Security in the SQL scripts, not from hiding this key. Never commit the *service role*
  key or the real `ANTHROPIC_API_KEY`/Stripe secrets — those live only as Supabase function secrets.

## Permission / plan model

Tiers: **free** (rank 0) → **medium** (1) → **premium** (2), tracked in `nexa_account`. `currentTier()`,
`moduleAllowed(view)`, `isTrialExpired()`, and the AI quota helpers (`aiLimit`/`aiUsed`/`aiRemaining`,
500/month, reset on the 1st) implement it. Free is the 3-day trial; `MODULE_MIN_TIER` marks which
modules need Medium. Premium unlock codes are validated against `PREMIUM_HASHES` (SHA-256 of the code —
codes themselves are never in source). All of this is **client-side and honest about it**: it's a
comfort/product gate, not real security. Server-enforced protection only exists once `BACKEND_V2` is on
(the proxy enforces quota via the `consume_ai` RPC).

## Supabase backend (optional)

Auto-detected: no config → fully local; configured → cloud accounts. Setup is documented step-by-step
in **`BACKEND.md`** (Phase 1 = accounts/trial/codes; Phase 2 = hosted AI proxy + Stripe). SQL is applied
by pasting the `.sql` files into the Supabase SQL editor. Edge Functions are Deno/TypeScript, deployed
with the Supabase CLI (`supabase functions deploy ...`). The functions rely on RPCs defined in
`supabase-tiers.sql` (`consume_ai`, `apply_purchase`, `set_stripe_customer`, `get_entitlements`) which
are `security definer` and locked to the service role.

## Development workflow

- **Run locally:** just open `index.html` in a browser, or serve the folder statically
  (`python3 -m http.server`). Use `localhost`/`127.0.0.1` so the domain lock lets the backend work.
  No install, no build step.
- **Editing:** almost all work happens in `index.html`. It's large — locate code by the `/* === === */`
  banner comments and by function name (`grep`), not by memorized line numbers.
- **i18n changes:** update the `data-i18n` markup **and** all six `translation/*.json` files together.
- **Testing:** there is no automated test suite. Verify changes by exercising the affected screen in the
  browser (both light and dark theme; check a non-German language for layout/RTL if you touched UI text).
- **Language:** UI, comments, commit messages, and docs are predominantly **German**. Match that. Keep
  copy plain and friendly (the app "duzt" the user — informal "du").

## Git & deployment conventions

- **Deployment is automatic:** a push to `master` triggers GitHub Pages to rebuild the live site.
  (Manual kick if needed: `POST repos/Darekkk80-Neuss/Nexa/pages/builds`.) There is no other build.
- **This assistant's branch:** develop on **`claude/claude-md-docs-atj8dx`**; commit with clear
  messages and push with `git push -u origin claude/claude-md-docs-atj8dx`. Do **not** push to `master`
  or open a PR unless explicitly asked.
- Commit-message style (see `git log`): short, imperative, often German, scoped by module
  (e.g. `Familienzentrale: family tasks assigned to members`).
- `.gitignore` excludes `.claude/` and `.commitmsg.tmp`.

## Guardrails for AI assistants

- **Don't add a build system, framework, or npm dependency** without being asked — the zero-build,
  single-file nature is a deliberate design choice and a selling point.
- **Don't rename `nexa_*` storage keys or Supabase identifiers** — it would wipe existing users' data.
- **Never hard-code or commit secrets:** the anon/publishable key is fine; the service-role key,
  `ANTHROPIC_API_KEY`, and Stripe secrets must stay as Supabase function secrets only.
- **Preserve the AI JSON contract** (`findings[]` schema in `aiAnalyze`) — modules parse it directly.
- **Keep the privacy model intact:** tasks/events/docs/chat/emergency stay in `localStorage`; only
  account/trial/plan data goes to the cloud.
- When changing gating, remember the flags above are intentionally `false` for the testing phase —
  don't flip `ENFORCE_TIERS`/`BACKEND_V2` as a side effect.
