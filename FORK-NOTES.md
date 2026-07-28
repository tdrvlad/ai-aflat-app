# ai-aflat fork notes

Base: upstream tag v0.8.7. Work branch: aflat-main.
Upstream merge cadence: monthly + security releases (`git fetch upstream && git merge <tag>`).
Rule: every deviation from upstream = one line here, same commit.

## Deviations
- **`.gitignore` (Task 3, committed):** upstream ignores `librechat.yaml` by default
  (assumes it holds secrets). Added `!librechat.yaml` after the `librechat.yml` ignore
  line so our config — which holds only `${VAR}` references, no secrets — is trackable.
- **`librechat.yaml` (Task 3, committed):** added, single custom endpoint `ai-aflat`
  wired to the Task-2 orchestrator (`http://127.0.0.1:8085/v1`), models
  `cautare-simpla` (default) / `cautare-aprofundata`. Non-product surfaces hidden via
  `interface`: `presets`, `prompts`, `bookmarks`, `multiConvo`, `agents` all `false`;
  `modelSelect` left at its default `true` so users can switch search modes.
  `fileConfig.endpoints.custom.disabled: true` hides the composer's file-attach
  control for the custom endpoint. `titleConvo: false` on the endpoint (not just a
  global default) — titling would otherwise call the orchestrator and park a
  spurious job. `.env` gained `ENDPOINTS=custom` (no built-in providers exposed),
  `ORCHESTRATOR_API_KEY`, `ORCHESTRATOR_BASE_URL` (`.env` stays untracked;
  `librechat.yaml` has no secrets, only `${VAR}` refs, so it IS committed).
  - **Key-name differences from the task brief's draft yaml**, confirmed against
    `packages/data-provider/src/config.ts` `interfaceSchema` and
    `packages/data-provider/specs/config-schemas.spec.ts` in this v0.8.7 tree:
    - `interface.endpointsMenu` does **not exist** — it was removed upstream
      (`ea28dbfa8`, "chore: remove unused `interface.endpointsMenu` config field")
      as dead code (it never controlled anything) and is now a legacy key the
      schema silently strips. Omitted from our yaml entirely; the endpoint switcher
      is hidden by having only one endpoint configured (`ENDPOINTS=custom`, one
      `custom` entry), not by an interface flag.
    - `version: 1.2.1` in the brief's draft → used `1.3.13` instead, the actual
      `Constants.CONFIG_VERSION` for this tree (a version mismatch is non-fatal,
      just an "Outdated Config version" log line, but there's no reason to ship
      stale).
    - All other keys in the brief's draft (`presets`, `prompts`, `bookmarks`,
      `multiConvo`, `agents`, `fileConfig.endpoints.custom.disabled`, and the
      `endpoints.custom[]` fields `name`/`apiKey`/`baseURL`/`headers`/`models`/
      `titleConvo`/`modelDisplayLabel`) matched the schema as drafted — no changes.
  - Header placeholders `{{LIBRECHAT_USER_ID}}` / `{{LIBRECHAT_BODY_CONVERSATIONID}}`
    are real, resolved by `packages/api/src/utils/env.ts` for custom-endpoint
    `headers:` (see `packages/api/src/endpoints/custom/initialize.spec.ts` and
    `packages/api/src/utils/env.spec.ts`) — confirmed working end-to-end via the
    `jobs.db` row captured in the Task 3 report.

- **Romanian locale + `ro` as the app default (Task 4, committed):** the product's audience is
  the Romanian general public, so the UI ships in Romanian by default with English kept as the
  per-key fallback and as a selectable language.
  - `client/src/locales/ro/translation.json` — new locale, 1791 of the EN catalog's 1928 keys.
    Untranslated keys are **absent, not copied from EN**, so i18next's `fallbackLng: en`
    resolves them. The 137 absent keys are all `com_agents_*` (94) and `com_assistants_*` (43) —
    surfaces this deployment disables (`interface.agents: false` in `librechat.yaml`; the
    assistants endpoints are not configured at all). Diacritics are comma-below ș/ț
    (U+0219/U+021B) throughout; zero cedilla ş/ţ (U+015F/U+0163).
  - `client/src/locales/en/translation.json` — one key added, `com_nav_lang_romanian: "Română"`
    (upstream has no Romanian locale, so it has no label for one).
  - `client/src/components/Nav/SettingsTabs/General/Selectors.tsx` — `ro` added to
    `languageOptions`, placed above `en-US` since it's the default.
  - `client/src/locales/i18n.ts` — four deviations:
    - `ro` is bundled **eagerly** into `resources` (and pre-seeded in `loadedLocales` /
      short-circuited in `ensureLocale`) instead of being lazy-loaded like every other locale,
      because it's the default: lazy-loading it would flash English on first paint. `ro` still
      has a `localeLoaders` entry so the lazy path stays consistent if it's ever selected
      after another language.
    - `lng: 'en'` → `lng: 'ro'` in `i18n.init`.
    - `normalizeLocale()`'s two "nothing matched" fallbacks `'en'` → `'ro'`. This is the
      function both the initial detection and `LanguageSync` run through, so it's what makes a
      visitor whose stored/requested locale maps to nothing we ship land on Romanian.
    - `detectInitialLanguage()` no longer falls through to `getNavigatorLanguage()`. Upstream
      made the browser language the effective default (which left `lng` inert); we default a
      visitor who has made no explicit choice — no `lang` cookie, nothing in localStorage — to
      Romanian regardless of browser. An explicit choice is still honored, including the
      selector's `auto`, which resolves to the browser language on demand.
  - `client/src/store/language.ts` — same reason: upstream seeded the `lang` atom from
    `navigator.language`, which would have had `LanguageSync` switch a first-time visitor back
    to their browser language right after `detectInitialLanguage()` settled on Romanian. Both
    paths must agree, so the no-explicit-choice default is `'ro'` here too.
  - `client/src/locales/Translation.spec.ts` — the upstream case "should fallback to English
    for an invalid language code" asserted the behaviour we deliberately changed; it now
    asserts the fallback is Romanian. Added a companion case proving per-key `fallbackLng: en`
    still resolves keys we leave out of the RO catalog.
  - `client/test/setupTests.js` — pins the **test** language to `en` in a global `beforeAll`.
    Upstream's component specs assert English UI strings and would all fail against a Romanian
    default; pinning here keeps ~46 assertions across 17 upstream spec files unmodified and
    merging cleanly. Wrapped in try/catch because a few specs (e.g.
    `src/components/Agents/tests/Accessibility.spec.tsx`) replace `react-i18next` with a bare
    stub and never touch the real i18n instance.
- **`client/src/locales/ro/translation.json` (Task 4, committed):** language-checker register pass — replaced the stub placeholder value in `com_endpoint_preset_custom_name_placeholder` (upstream EN source is itself junk text).
- **`client/src/locales/Translation.spec.ts` (Task 4 follow-up, committed):** added the describe
  block "Romanian as the app default (upstream-merge regression guards)" — the RO default lives in
  two files we re-merge from upstream (`detectInitialLanguage()` here, the `lang` atom seed in
  `client/src/store/language.ts`) and had no test, so restoring either `navigator.language`
  fallback would have gone unnoticed; jsdom's non-Romanian `navigator.language` is the lever that
  makes each guard fail (verified by reverting each change independently).

- **Anonymous question API + consents + product events (Task 6, committed):** the pre-signup
  "colectorul" funnel — a visitor parks a question, signs up, and claims it — plus the consent
  ledger and the funnel telemetry it needs. Three new collections, three new routers, all mounted
  under `/api/aflat/`. **Hard invariant across every file below: no request IP, user agent, or
  other network identifier is ever persisted or logged.** The visitor's IP exists only as an
  ephemeral rate-limiter key.
  - `packages/data-schemas/src/schema/anonQuestion.ts`, `consentLog.ts`, `productEvent.ts` — new
    schemas for collections `anon_questions`, `consent_logs`, `product_events`. These are the only
    schemas in the tree that set mongoose's `collection` option explicitly; every upstream schema
    relies on mongoose pluralizing the model name (`Banner` → `banners`), which would have given
    us `anonquestions` / `consentlogs` / `productevents`. The snake_case names are the product
    contract these collections are read under, so they are pinned in the schema.
  - `packages/data-schemas/src/models/anonQuestion.ts`, `consentLog.ts`, `productEvent.ts` +
    registration in `models/index.ts` and `schema/index.ts` (both follow the existing export/
    create pattern exactly, appended under an `/* ai-aflat */` marker). None of the three applies
    `applyTenantIsolation`, following the documented `auditLog` / `systemGrant` precedent: an anon
    question and an anon product event are written on an *unauthenticated* request, so there is no
    tenant context to stamp, and the later authenticated `:id/link` read (which does run inside
    one) would never match a document the plugin had filtered. Consents are already scoped by
    `userId` on every query. Each model file carries this rationale inline.
  - `api/server/routes/anonQuestions.js` — `POST /api/aflat/anon-questions` (no auth, 5/hour/IP)
    and `POST /api/aflat/anon-questions/:id/link` (`requireJwtAuth`). `ackVersion` is stored
    verbatim as the client sends it and is deliberately never validated against a constant, so
    changing the acknowledgement wording needs no code change and never invalidates old records.
    `:id/link` returns 404 for an unknown id, a malformed id, *and* a question already claimed by
    a different user (so ids can't be probed for existence); re-linking by the same user is
    idempotent and emits no second event.
  - `api/server/routes/consents.js` — `GET /me` + `POST /`, both behind `requireJwtAuth` applied
    as `router.use` (a consent without a subject is meaningless). `gdprAccepted` and
    `framingAccepted` must both be literally `true`; the legal-information framing acknowledgement
    is not optional, so a truthy-but-not-true value is rejected as a client bug.
  - `api/server/routes/aflatEvents.js` — `POST /api/aflat/events` (no auth, 30/hour/IP), accepting
    exactly `gate_shown` and `gate_login_clicked`; anything else is 400. The rest of the funnel
    (`question_submitted`, `gate_converted`, `consent_recorded`) is emitted server-side by the
    route that performed the action, so it can't be forged from a browser. Client-supplied `meta`
    is capped at 2 KB. This module also exports `recordProductEvent` alongside its router
    (`module.exports.recordProductEvent = ...`, the same secondary-export shape
    `api/server/middleware/requireJwtAuth.js` uses for `requireRumProxyAuth`) so the other two
    routers emit through one best-effort, never-throws writer instead of three copies.
  - `api/server/middleware/limiters/aflatLimiters.js` — new file, built exactly like
    `registerLimiter` (same `express-rate-limit` options, `removePorts` key generator,
    `limiterCache` store), with two deliberate differences: no `logViolation` call and no
    `ViolationTypes` entry. Both limited routes are unauthenticated, so `logViolation` would
    short-circuit on the missing `req.user` anyway; omitting it makes it structurally impossible
    for a violation record to ever carry a visitor IP. Requires are direct
    (`~/server/middleware/limiters/aflatLimiters`), following `banner.js`'s direct
    `~/server/middleware/optionalJwtAuth` require, so upstream's `limiters/index.js` and
    `middleware/index.js` stay untouched. Windows/limits are env-overridable
    (`AFLAT_ANON_QUESTION_WINDOW/_MAX`, `AFLAT_EVENT_WINDOW/_MAX`) with the product defaults
    5/hour and 30/hour baked in.
  - `api/server/routes/index.js` — three requires + three exports, appended under an
    `/* ai-aflat */` marker.
  - `api/server/index.js` — the three `app.use('/api/aflat/…')` mounts, placed as the *first* API
    routes, ahead of `/api/auth`. There is no app-level auth middleware in this tree (every router
    guards itself), but putting the anonymous surfaces first makes it impossible for a future
    global guard to be inserted in front of them by accident. Auth is applied inside the routers,
    per route, never at the mount.
  - The three routers read models straight from `~/db/models` rather than going through the
    `createMethods` accessor layer in `packages/data-schemas/src/methods/` that upstream routes
    use (`~/models` → `getBanner`, …). This keeps the fork's new surface inside `routes/` and
    `schema/` instead of adding to another upstream barrel; add methods later if a second consumer
    ever needs these collections.
  - Tests: `api/server/routes/anonQuestions.test.js`, `consents.test.js`, `aflatEvents.test.js` —
    46 cases over `mongodb-memory-server` + real models, following the `prompts.test.js` harness
    (memory server in `beforeAll`, models from `~/db/models`, `requireJwtAuth` mocked). The test
    apps set `trust proxy` so `X-Forwarded-For` drives `req.ip`: each test gets its own synthetic
    source IP, which isolates limiter buckets without module resets and lets the 429 cases assert
    the limit really is per-IP. Two cases assert the GDPR invariant directly by serializing the
    written documents and checking the request IP does not appear.

- **`api/server/routes/anonQuestions.js` + `api/server/middleware/limiters/aflatLimiters.js` (Task 6 review fix, committed):** `POST /:id/link` was an unthrottled, enumerable read of other visitors' question text — the claim is authorised by possession of the `_id` alone and a hit returns `text`, and Mongo ObjectIds are guessable once an attacker holds two of their own (constant 5-byte per-process random, bracketed 3-byte counter), so every *unclaimed* question in that window was brute-forceable. Added `anonQuestionLinkLimiter` (10/hour/IP via the existing `buildAnonLimiter`, env-overridable through `AFLAT_ANON_QUESTION_LINK_WINDOW`/`_MAX`), mounted ahead of `requireJwtAuth` so failed-auth attempts count against the same budget and `req.user` stays unset at limiter time. The claim itself was also find-then-save, so two concurrent claimers could both see `linkedUserId == null` and both get 200 plus the text; it is now one conditional `findOneAndUpdate` (`$or: [{linkedUserId: null}, {linkedUserId: userId}]`) whose pre-image gates the `gate_converted` emit — a losing claimer matches nothing and gets the same 404 as an unknown id, while same-user re-link stays 200 and idempotent.

## Local dev environment notes (not upstream deviations, but needed to boot)
- Node/npm: repo pins Node `24.16.0` (`.nvmrc`) and `npm@11.13.0` (`packageManager` in
  package.json); no `engines` field enforces this. Machine default via nvm was Node
  v20.20.2 / npm 10.8.2. Installed and used `nvm install 24.16.0` (brings npm 11.13.0
  along). Run `nvm use 24.16.0` in this repo before any npm/node command.
- `.env`: `MONGO_URI=mongodb://127.0.0.1:27017/LibreChat` is already the stock default in
  `.env.example` — no edit was actually required. Rest of `.env` left stock.
- Boot order matters: `npm run backend:dev` reads `client/dist/index.html` synchronously
  at startup (api/server/index.js) and crashes with ENOENT if it's missing, in both dev
  and prod `NODE_ENV`. Per `.github/CONTRIBUTING.md` §1 ("Build all compiled code:
  `npm run build`"), the packages must be built once before the dev servers work:
  `npm run build:data-provider && npm run build:data-schemas && npm run build:api && npm run build:client-package && npm run build:client`
  (the last one builds `client/dist`). After that, `backend:dev` (nodemon, port 3080) and
  `frontend:dev` (vite, port 3090) both boot; `frontend:dev` is only needed for HMR during
  UI work — port 3080 alone serves the app.
- Stock warnings/errors at boot that are expected and not blockers (no Meilisearch/RAG
  API/`librechat.yaml` configured yet): `[mongoMeili] Error checking index ... fetch
  failed`, `[indexSync] error fetch failed`, `Config file YAML format is invalid: ENOENT
  ... librechat.yaml`, `RAG API is either not running or not reachable`, default
  CREDS_KEY/CREDS_IV/JWT_SECRET/JWT_REFRESH_SECRET warnings.
