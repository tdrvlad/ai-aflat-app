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
  `simple-search` (default) / `deep-search` (renamed from `cautare-simpla` /
  `cautare-aprofundata` — see the English-identifiers entry below). Non-product surfaces
  hidden via `interface`: `presets`, `prompts`, `bookmarks`, `multiConvo`, `agents` all
  `false`; `modelSelect` is now `false` (it was `true`) because the search-mode picker is
  the `modelSpecs` list, not the endpoint list.
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

- **Anonymous ask gate — `/ask` (Task 7, committed):** the client half of the pre-signup
  funnel. A visitor with no session types a legal question, it is parked server-side, and the gate
  asks for an account instead of showing an answer. **The gate never renders an answer and never
  cites anything** — it is a capture surface, not an assistant surface.
  - `client/src/routes/AnonAsk.tsx` — new public screen. Registered in `client/src/routes/index.tsx`
    as a *top-level* route (sibling of `share/:shareId` and `verify`), deliberately **outside**
    `AuthLayout`/`AuthContextProvider`: it must render with no session, no auth context and no
    authenticated queries. It also reads no chat store — the whole screen is local `useState`.
    State machine `idle → (send attempt without ack) needsAck → asking(1s) → gate`, plus an
    `isSending` flag for the in-flight POST and an error slot. `Enter` sends, `Shift+Enter` newlines.
  - `client/src/components/Aflat/anonStash.ts` — the localStorage contract Task 8 consumes:
    `aflat_anon_q` = `{id, text}` via `saveStash`/`readStash`/`clearStash`, and `ACK_KEY` =
    `aflat_ack_v1-2026-07` = ISO timestamp. The acknowledgement **version is in the key name**, so
    changing the ack wording (bump `ACK_VERSION`) re-asks every visitor without a migration, and
    the same constant is what the client sends as `ackVersion` — the server stores it verbatim.
    `readStash` and the ack helpers swallow storage failures (private mode) rather than block a send.
  - `client/src/components/Aflat/AckBar.tsx` — appears **only on a send attempt without a stored
    ack**, and the acknowledgement then releases the send the visitor already asked for (one tap,
    not two). If the ack is already stored it never renders.
  - `client/src/components/Aflat/StarterChips.tsx` — three example questions that **fill the
    composer without sending**: the send is what parks the question, so it stays an explicit act.
    Hidden once a question is in flight.
  - `client/src/components/Aflat/LoginGatePanel.tsx` — emits `gate_shown` on mount and
    `gate_login_clicked` on `Continuă`, both through one fire-and-forget `postAflatEvent` that
    never throws and never surfaces a failure. Uses `keepalive: true` so the click event survives
    the navigation that immediately follows it (verified: the event lands in `product_events`).
    Navigates via `loginPage()` from the data-provider rather than a literal `/login`, so a
    subdirectory deployment keeps working.
  - Styling is **entirely** the fork's existing tokens and Tailwind theme classes — no hex, no new
    palette. The composer shell/textarea/send-button classes are cloned verbatim from
    `client/src/components/Chat/Input/ChatForm.tsx` + `SendButton.tsx`, the chips from
    `Chat/Input/ConversationStarters.tsx`, and the thinking dots reuse the existing
    `.submitting .result-thinking` CSS. A later brand remap of the tokens restyles this screen for
    free.
  - i18n: 18 new `com_aflat_*` keys in **both** `client/src/locales/ro/translation.json` and
    `client/src/locales/en/translation.json` (RO is the source copy, EN is the fallback catalog and
    also what `TranslationKeys` is typed from, so a key missing there is a type error). No literal
    UI strings in the JSX. RO diacritics are comma-below ș/ț throughout.
  - Throttle handling: the 429 from `POST /api/aflat/anon-questions` (5/hour/IP, Task 6) renders as
    a plain RO line via `com_aflat_error_rate_limited` with the question left in the composer — no
    crash, no silent failure, no gate. A network failure gets `com_aflat_error_generic` the same way.
  - Tests: `client/src/components/Aflat/__tests__/anonStash.spec.ts` (7 cases — contract keys,
    corrupt-JSON tolerance, ack versioning) and `client/src/routes/__tests__/AnonAsk.spec.tsx`
    (7 cases — chips don't send, first send is blocked and POSTs nothing, post-ack send carries
    `ackVersion: 'v1-2026-07'` and ends at the gate rather than an answer, 429 and network failure).

- **`client/src/routes/useAuthRedirect.ts` + `client/src/hooks/AuthContext.tsx` (Task 7, committed):**
  an unauthenticated visitor now lands on `/ask` instead of `/login`. Signing in is the
  *outcome* of parking a question, not the price of admission, so the sign-in prompt lives inside
  the gate.
  - `useAuthRedirect.ts` — the brief's named change: `navigate(buildLoginRedirectUrl(…))` →
    `navigate('/ask')`. The authenticated path is untouched.
  - `AuthContext.tsx` — **not in the brief's file list, but changing `useAuthRedirect` alone does
    not work.** `AuthContextProvider.silentRefresh` fires on mount for a logged-out visitor and,
    on "no token" / refresh error, navigates to `buildLoginRedirectUrl()` — it wins the race
    against `useAuthRedirect`'s 300ms timer, so `/` still landed on `/login` (reproduced in the
    browser: console logs "Token is not present…" at 484ms, then `/login`). Its three anonymous
    bounce sites now go through one `anonRedirectTarget()` helper. That helper **keeps upstream's
    recursion guard**: `/login` and `/login/2fa` render inside this provider, so when the current
    path already matches `/(?:^|\/)login(?:\/|$)/` it still defers to `buildLoginRedirectUrl()` —
    otherwise the provider would bounce visitors off the sign-in page and make login impossible.
    The login/logout *mutation* redirects are untouched. **Task 5 (Clerk) should re-check this file
    — if it replaces the auth flow, `anonRedirectTarget` is the one thing that must survive.**
  - Deliberate loss: upstream carried the source deep link as `?redirect_to=…`; the gate drops it.
    An anonymous visitor has no session to resume, and everything past sign-in is owned by the
    gate's own hand-off (Task 8 claims the parked question). Pinned by two replacement cases so it
    can't silently come back.
  - `client/src/routes/__tests__/useAuthRedirect.spec.tsx` — upstream's six `/login` assertions
    retargeted at `/ask`; its four `redirect_to`-construction cases replaced by two that
    assert the deep link is dropped (plain and subdirectory deployments).
  - `client/src/hooks/__tests__/AuthContext.spec.tsx` — new describe block "anonymous visitors land
    on the ask gate": no-token and refresh-error both go to `/ask`, `/login` and `/login/2fa`
    are left alone. Upstream's existing cases are untouched (they cover the login-mutation paths,
    which did not change).

- **`client/src/routes/AnonAsk.tsx` (Task 7 review fix, committed):** the gate dead-ended returning
  users — since `useAuthRedirect` + `AuthContext` now bounce *every* anonymous visitor here, an
  account holder whose session expired on a bookmarked link had no way to reach `/login` at all
  (the only sign-in affordance was behind asking a question and hitting the gate panel). Added a
  visually secondary `com_aflat_signin_link` anchor in the header, `href={loginPage()}` for the same
  subdirectory-safety reason as `LoginGatePanel`. The header became a
  `grid-cols-[1fr_auto_1fr]` so the logo stays optically centred with the link at the right edge.
  New key in both catalogs; pinned by a case in `AnonAsk.spec.tsx`.

- **`client/src/components/Aflat/anonStash.ts` + `client/src/routes/AnonAsk.tsx` (Task 7 review fix,
  committed):** `saveStash`/`clearStash` were the only unguarded `localStorage` writes left (the ack
  helpers already swallowed failures). In a browser with site data blocked or quota exhausted,
  `saveStash` threw *after* the `201` and the throw was caught by the submit's outer `catch`, so the
  visitor saw "couldn't save your question" for a question that **was** saved — and each retry
  parked another orphan document nobody could ever claim while burning the 5/hour budget.
  `saveStash` now returns a boolean and never throws, `clearStash` swallows likewise, and the submit
  is restructured so the `try` ends at the response parse: **past the 2xx nothing can route back to
  an error state**. A missing/unparseable `id` skips the stash and still gates (the only cost is the
  post-signup auto-link, which Task 8 already treats as optional). Covered by storage-failure cases
  in `anonStash.spec.ts` and an end-to-end blocked-storage case in `AnonAsk.spec.tsx`.

- **`client/src/routes/index.tsx` + `useAuthRedirect.ts` + `hooks/AuthContext.tsx` (Task 7 rename,
  committed):** the gate's route is `/ask`, not `/intreaba`. Product owner's locked decision
  (2026-07-28): **all code identifiers are English, including user-visible URL slugs**; Romanian
  survives only as content, copy and labels. So the path is English while everything the visitor
  *reads* on it stays Romanian. Both bounce paths were renamed together and still agree on the same
  constant (`ANON_GATE_PATH`) — they race each other on a cold load, so a one-sided rename would
  have reopened the `/login` race described above. `anonRedirectTarget()` and its
  `/(?:^|\/)login(?:\/|$)/` recursion guard are unchanged. Verified live: logged-out
  `http://localhost:3080/` lands on `/ask`, RO heading and sign-in link render, and `intreaba`
  appears nowhere in the built bundle. No collision — every server mount is under `/api/` except
  `/oauth`, and no other client route claims `ask`.

- **`librechat.yaml` (Task 7 rename, committed):** model ids `cautare-simpla` → `simple-search`,
  `cautare-aprofundata` → `deep-search`, same English-identifiers decision — these ids are shared
  verbatim with the orchestrator, which is being renamed in parallel. The Romanian the user reads
  moved into a new `modelSpecs` section as `label`: „Căutare simplă" (`default: true`) and
  „Căutare aprofundată". Schema verified against `packages/data-provider/src/models.ts`
  (`specsConfigSchema` / `tModelSpecSchema` / `tModelSpecPresetSchema`) in this tree rather than
  from docs, and the whole file re-checked with `configSchema.strict()` — it parses with **no
  unknown keys stripped**, so there is no silent drift.
  - `interface.modelSelect` had to flip to `false`. `useEndpoints.ts` only empties its endpoint
    list when `modelSelect` is false (`addedEndpoints` is unset, so nothing filters it), while
    `ModelSelector.tsx` still renders the menu whenever `modelSpecs` is non-empty. Left at `true`
    the picker would have listed the two Romanian labels *and* the `ai-aflat` endpoint expanded to
    its raw English model ids — the labels would not have replaced the ids, just sat next to them.
  - `enforce` left at its schema default `false`: enforcing requires every send to carry a spec,
    and nothing outside the picker does yet (Task 8's claim flow included).
  - Behaviour otherwise preserved: `ENDPOINTS=custom`, one visible `ai-aflat` endpoint, no
    attachments, no balance. Confirmed by boot — the config loads with the labels intact, no
    "Outdated Config version" line and none of `checkInterfaceConfig`'s conflict warnings.

- **`client/src/routes/Root.tsx` (Task 8, committed):** mounts `<ConsentModal />` in the
  authenticated shell. The brief pointed at `ChatRoute.tsx`; Root was chosen instead because the
  consent gate has to block *every* authenticated route rather than only the chat view, and must not
  remount on conversation switches — Root renders once per session, and it already hosts
  `TermsAndConditionsModal`, which is the same kind of gate. The modal is deliberately
  non-dismissible (no close button; `onEscapeKeyDown`, `onPointerDownOutside` and `onInteractOutside`
  all prevented) while still being a real Radix dialog, so focus stays trapped and the rest of the
  page is inert — held by the boundary, not locked out of it.

- **`client/src/components/Chat/Input/ChatForm.tsx` (Task 8, committed):** mounts
  `usePostLoginHandoff()`, which claims the question parked at `/ask` before signup and submits it
  into the user's first conversation. It lives here rather than in a route component because it needs
  `useSubmitMessage`, which requires both the chat and chat-form contexts, and `ChatForm` is the
  innermost component inside both. Three guards are load-bearing: it waits for consent to be
  recorded (nothing is sent on the user's behalf before they accept the framing), for the
  conversation to be the *new* one with its `modelSpecs` endpoint already applied, and against double
  submission via a ref plus a module-level id set — `ChatForm` remounts on every conversation switch,
  so a ref alone would not survive. A 404 from the claim endpoint clears the stash; every other
  failure (429, offline, 5xx) leaves the question parked for a later mount and stays silent.

- **`client/src/components/Aflat/{ConsentModal,consent,usePostLoginHandoff}` (Task 8, committed):**
  new files, no upstream equivalent. Consent state is a single React Query key shared by the modal
  and the handoff so the two can never disagree about whether consent exists; the POST writes the new
  state straight into the cache rather than invalidating, so nothing sits between accepting and being
  let in. `wordingVersion` is pinned at `v1-2026-07` in `consent.ts` and travels on every record.

- **`client/src/components/Aflat/usePostLoginHandoff.ts` (Task 8 review fixes, committed):** the
  claim is a round trip and the chat underneath it can change while it is out, so every precondition
  is now mirrored into a ref and re-asserted on the far side of the await — still mounted, still
  ready, same conversation, no submission of the user's own in flight — and the parked question is
  put back (same `ts`, both guards released) whenever any of those fails. Before this, the values
  captured in the effect closure described the render that *started* the claim: a user who typed and
  sent their own message during it lost the parked one silently, because `ask` no-ops while
  `isSubmitting` and `submitMessage` reports that exactly like success. `submitMessage`'s `false`
  (`ask` refusing to append to a preliminary assistant message) is now treated as undelivered too.
  - **Deviation from the reviewer's prescription:** the "have we been torn down" flag is a
    mount-lifetime ref, not a `let cancelled` closed over by the effect run. React strict mode — and
    any `ready` flip — tears an effect down and runs it again on a component that never went away,
    so a per-run flag cancels claims that are still perfectly deliverable (it breaks the strict-mode
    case outright). Only a real unmount leaves the ref false, because nothing runs after it.
  - `clearStash()` now happens *before* the claim goes out rather than after it returns. The stash
    is `localStorage`, shared by every tab; `handledIds` is per page context; and the link route
    matches `linkedUserId: null` **or** the caller's own id, so it answers 200-with-text to a
    re-claim by the owner. Two tabs open after a signup therefore both claimed and both asked — two
    conversations, two orchestrator jobs, one question. Clearing first narrows that to a single
    synchronous storage write. Residual, accepted: a full page navigation *during* the claim loses
    the stash (nothing runs to put it back). That is a narrower failure than a duplicate ask, and
    the question is still parked server-side.
  - `handledIds` is kept and is no longer redundant-looking: with the clear moved before the POST it
    is specifically the guard for browsers where `removeItem` throws (site data blocked, Safari
    private mode) — `clearStash` swallows that by contract, the stash survives the whole claim, and
    a `ChatForm` remount mid-claim would otherwise read it and claim a second time. That is the case
    the new regression test pins; the reviewer's mutation (`if (false)`) previously passed the whole
    suite and now fails it.

- **`client/src/components/Aflat/anonStash.ts` (Task 8 review fixes, committed):** the stash carries
  a `ts` and expires after 24h (`STASH_MAX_AGE_MS`). Shared browsers are the reason: without it, a
  visitor who asked and never signed up leaves their question behind, and the next person to sign up
  on that machine has it shown to them, asked as theirs, and `anon_questions.linkedUserId` stamped
  with the wrong subject — a disclosure, not just a bug. A stash written by the deployed Task 7 code
  has no `ts` and no way to prove its age, so it is treated as expired and dropped rather than
  claimed; a stamp far in the future (corrected clock, hand-edited value) goes the same way.
  `saveStash` keeps its never-throws contract and accepts a caller-supplied `ts`, so the handoff
  re-parking an undelivered question does not restart the expiry clock.

- **`client/src/components/Aflat/consent.ts` (Task 8 review fixes, committed):** `retry: 1` +
  `refetchOnWindowFocus/Reconnect: false` made one failed GET terminal for the whole session — `data`
  stayed `undefined`, the modal never appeared, and the user got the product with no `consent_logs`
  row, which is the exact state the gate exists to prevent. Both surfaces still fail *open* (walling
  a user out on a flaky GET is the worse failure), but the query is now recoverable: `retry: 3` with
  backoff (base 250ms — this gate stands in front of the app), and refetch on focus and reconnect.
  Safe next to `staleTime: Infinity` because React Query treats a query that never resolved as stale
  (`dataUpdatedAt` is 0) and one that has as fresh forever, so those triggers can only fire while the
  answer is still missing; the POST writes `{recorded:true}` into the cache and a refetch after that
  can only re-confirm it.

- **`api/server/routes/anonQuestions.js` + `packages/data-schemas/src/schema/anonQuestion.ts`
  (Task 6/7/8 hardening, committed):** a parked question is now claimed by an opaque token in an
  httpOnly cookie instead of by its `_id`, and `POST /:id/link` is replaced by `POST /claim`, which
  takes no id at all. The id was the whole problem: ObjectIds are partially predictable — the 5-byte
  per-process random is constant and the 3-byte counter is bracketed by any two ids an attacker mints
  themselves — so an authenticated caller could walk the space and read back strangers' free-text
  legal questions, with only a 10/h/IP limiter in the way. With no id in the request there is nothing
  left to enumerate. The token is 32 random bytes, returned to the browser only as a cookie (never in
  a response body, so no client-side error reporter can log it) and stored only as its SHA-256, so a
  dump of the collection cannot be replayed into a claim. SHA-256 rather than bcrypt/argon2 is
  deliberate: the input is a high-entropy secret, not a password, and a work factor protects against
  nothing here. The claim looks the document up *by* that hash, which is also why a constant-time
  compare is moot. `sameSite: 'lax'` is load-bearing — the return from hosted sign-in is a top-level
  navigation, which Lax permits and Strict would drop, taking the handoff with it; `secure` follows
  the fork's own `shouldUseSecureCookie()` so dev on `http://localhost:3080` still works. Both cookies
  are cleared on a successful claim and on a 404: the claim is idempotent for its owner, so a cookie
  left in place would re-deliver the same question on every page load for 24h.
- **`aflat_claim_present` marker cookie (Task 6/7/8 hardening, committed):** a second, contentless
  cookie carrying `1`, readable by the client, set and cleared alongside the credential. It exists
  because the client otherwise cannot tell whether a claim is worth attempting — the credential is
  `httpOnly` by design and the local stash may be missing on exactly the storage-blocked browsers the
  cookie was introduced to rescue — so it would have to claim on **every** authenticated page load.
  That spends the shared 10/h/IP budget on users who parked nothing, and behind carrier NAT (common
  for Romanian mobile) ordinary browsing would throttle out the real claims. It is set at `path: '/'`,
  not the credential's `/api/aflat`: `document.cookie` only exposes cookies whose path matches the
  reading page, and the page that reads it is `/c/new`. Only the contentless flag is widened; the
  secret keeps the narrow scope.
- **`client/src/components/Aflat/anonStash.ts` (Task 6/7/8 hardening, committed):** the localStorage
  stash stops being a credential and becomes display state — `id` is no longer sent anywhere and
  proves nothing, so hand-editing the key gains an attacker nothing. The 24h expiry stays: it still
  stops a shared browser from showing the next visitor a stranger's question.
- **Marker spent client-side, and a `claimed` stash flag (Task 6/7/8 hardening, fix round,
  committed):** two corrections found by review of the above.
  - The marker is expired **synchronously in the browser, immediately before the claim request** —
    not left to the server's `Set-Cookie` on the response. The claim is idempotent for its owner, so
    while it is in flight a second tab (session restore, duplicate tab) with its own page-context
    state still saw the marker, claimed too, and got its own 200 + text: the same question asked
    twice, in two conversations, at the cost of two orchestrator jobs. Waiting for the response left
    that window open for the whole round trip — 0.3–2s on mobile. It is restored on a retryable
    failure, so a storage-blocked browser does not lose its only signal.
  - `AnonStash.claimed` records that the server has confirmed a question is this account's but it
    could not be asked yet (chat moved on, or `ask` refused). The credential is spent by then, so a
    reload in that window used to send the hook back for the 404 a spent credential earns — throwing
    away text that was sitting in `localStorage`. Page state is the fast path; this flag is the part
    that survives a reload. It is not a credential and grants nothing: anyone who can set it can
    already type whatever they like into the composer.
- **`AnonStash.uid` and the account-known gate (Task 6/7/8 hardening, second fix round, committed):**
  the `claimed` flag above deliberately delivers without asking the server, which removed the
  backstop that flag inherited: the 404 a spent credential earns was what stopped a leftover local
  copy from reaching the *next* account on a shared browser. Nothing clears the stash on logout, so
  within the 24h window — user X claims, delivery fails, X signs out, Y signs in — Y's first
  conversation would open with X's question, already stamped `linkedUserId: X` server-side and now
  stored under Y. The record therefore carries the account it was claimed for (`uid`, written only
  beside `claimed`), and direct delivery requires a match; anything else falls through to the normal
  claim, which 404s and drops it. `usePostLoginHandoff` reads `useAuthContext().user.id` for this and
  will not act at all until the account is known — a question held with no owner could never be
  matched by any later mount. `uid` grants nothing: forging it buys what typing into the composer
  buys. Also in this round: the `claimed` stash is consumed *before* the submit (same discipline as
  the claim path — `localStorage` is shared by every tab); the marker is restored only if it was
  present to begin with, and with the server's own attributes, since a bare `name=value` is a session
  cookie that a browser restart would drop on precisely the storage-blocked browser it exists for;
  and a held question keeps one `ts` across repeated failed deliveries instead of rolling the 24h
  window forward a step at a time.
  - Accepted cost, recorded deliberately: between spending both signals and the response landing,
    the browser holds no record that anything was parked, so a tab that dies mid-claim loses the
    question even though the credential stays valid. That is the trade for closing the duplicate-ask
    window, and it needs a page to die inside one request.

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
