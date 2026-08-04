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
  - Accepted cost, recorded deliberately: consuming a signal before the operation it guards leaves a
    window where the browser holds no persistent record that anything was parked. On the claim path
    that window is the request itself, so a tab that dies mid-claim loses the question even though
    the credential stays valid for 24h. On the delivery path it is only synchronous — no `await`
    between the clear and the write-back, and a throw is caught — so a dying tab cannot hit it; what
    remains is a `localStorage` write that fails while reads still work (quota), which loses the
    stored copy while page state keeps the in-memory one. Both are the trade for closing the
    duplicate-ask window. Closing them properly means marking the record *in flight* with a short
    max-age instead of deleting it, which would cover both paths at once; ledgered, not done.

- **Auth: `AUTH=clerk-oidc` (Task 5 decision record, no code deviation):** login is Clerk, reached
  through LibreChat's stock OpenID strategy — **nothing in the source was changed for it.** The whole
  integration is configuration in the untracked `.env`: LibreChat's own auth off
  (`ALLOW_EMAIL_LOGIN=false`, `ALLOW_REGISTRATION=false`), social on, and the stock `OPENID_*` keys
  pointed at Clerk with `OPENID_CALLBACK_URL=/oauth/openid/callback`,
  `OPENID_SCOPE="openid profile email"`, `OPENID_AUTO_REDIRECT=true` (so `/login` never renders
  LibreChat's form — intended UX, not a bug) and the Romanian button label. Values live only in
  `.env` and are not recorded anywhere in this repo. The spike's gate was met on the Google leg
  (verified in a browser, Mongo user document carries `provider: openid`); the email/password leg,
  logout/re-login and the hosted page's Romanian localisation are **not** verified and belong to
  Task 11's e2e. Branch `clerk-oidc` was created for this work and holds **zero commits** — there was
  never anything to merge. Consequences worth knowing: local dev has no password login, which is why
  browser e2e is deferred by design and why `.env` is off limits to implementers; and the configured
  issuer is a Clerk **development** instance, so production needs a production instance — a new
  issuer, not just a rotated secret — plus its own Google OAuth client.

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

- **Partial TTL index on `anon_questions` (Task 10, committed):**
  `packages/data-schemas/src/schema/anonQuestion.ts` gained
  `index({ createdAt: 1 }, { name: 'anon_questions_unclaimed_ttl', expireAfterSeconds: 63072000,
  partialFilterExpression: { linkedUserId: null } })`. Unclaimed questions — free text belonging
  to no account, so no subject can ever ask for, correct, or erase it — now expire after 24
  months; a claimed question leaves the partial index the moment `linkedUserId` is set and is
  never a TTL candidate. This replaces the phase-1 plan's `retention.sh` cron: an index that
  ships with the schema survives a rebuild or a restore into an empty database, which a
  hand-typed `createIndex` on the server does not. Verified against MongoDB 8.0.20 (partial +
  TTL accepted; the filter selects null-valued *and* field-absent documents).

- **Cloudflare Web Analytics beacon (committed):** `client/index.html` gained one inline,
  host-gated script that injects the cookieless Cloudflare beacon
  (`static.cloudflareinsights.com/beacon.min.js`, token
  `c89221bfaa9f45428061c170b690fd28`, site `app.ai-aflat.ro`). The token is public by
  design — it ships in page source and identifies the site, not the visitor — so it is
  committed rather than passed through env.
  - **Why inline and not the upstream `analyticsGtmId` path.** Upstream carries the token
    in `buildPublicSharePayload()` (`api/server/routes/config.js`), which `/api/config`
    spreads **only into the authenticated branch** — `!req.user` gets `preLoginPayload`
    without it. The consumer (`client/src/hooks/Config/useAppStartup.ts`) is called only
    from `ChatRoute.tsx`. So that path never fires on login, register or shared
    conversations, which is exactly the first-touch traffic we want counted. Inlining in
    `index.html` covers every route, keeps the upstream-merge surface to one file, and
    sidesteps Vite's build-time env inlining entirely.
  - Gated on `location.hostname === 'app.ai-aflat.ro'`, so `frontend:dev` (port 3090),
    `backend:dev` (3080) and any preview host send nothing.
  - Uses the vendor's `type="module"` markup. The served `beacon.min.js` is currently a
    classic script (no import/export), so `defer` would also work — matching the vendor
    keeps it correct if Cloudflare converts the file to a real ES module.
  - Covered by `client/src/__tests__/analytics.spec.js`, which executes the shipped inline
    source against a spoofed hostname (not a string match). Verified by mutation: removing
    the host gate and swapping in the marketing-site token each fail the suite.
  - **Open compliance item:** the app's privacy policy is the website's
    (`interface.privacyPolicy.externalUrl` → `https://ai-aflat.ro/confidentialitate`).
    That page now discloses Cloudflare Web Analytics for the *website*. Before
    `app.ai-aflat.ro` serves real users, the Art. 13 notice must also cover the app —
    fold it into `docs/superpowers/specs/2026-07-28-consent-wording-v2.md` rather than
    editing the page twice.

- **`librechat.yaml` collection gate (Task 10, committed):** added a top-level `registration:`
  block with `allowedDomains: ['sapio.ro']`. Production may not take a question from the public
  while the code still carries the v1 consent/ack wording (`v1-2026-07`), and the flag that looks
  like it should do this — `ALLOW_SOCIAL_REGISTRATION=false` — does **not**: it is read only by
  `api/strategies/socialLogin.js:78`, while the Clerk path is `api/strategies/openidStrategy.js`,
  which calls `createUser` (line 699) with no such check. What does gate it is
  `isEmailDomainAllowed(email, baseConfig?.registration?.allowedDomains)` at `openidStrategy.js:583`,
  which runs *before* `findOpenIDUser` and therefore blocks new and existing users alike. Paired
  with `AFLAT_ANON_QUESTION_MAX=0` in the server env for the anonymous path. Remove this block (and
  set that var back to 5) when the v2 wording ships — see `.claude/tasks/task10-deploy-runbook.md`
  in the parent repo.

- **Consent + acknowledgement wording v2 (committed):** the copy the product actually asks people to
  accept, replacing the v1 placeholder wording that shipped with Tasks 5 and 8. Approved by the
  product owner and through two language-review passes; spec is
  `docs/superpowers/specs/2026-07-28-consent-wording-v2.md` in the parent repo. Both version
  constants move `v1-2026-07` → `v2-2026-08`:
  - `client/src/components/Aflat/anonStash.ts` — `ACK_VERSION`. `ACK_KEY` derives from it
    (`aflat_ack_v2-2026-08`) and is deliberately **not** edited separately: the version lives in the
    key *name*, so the bump alone re-asks every visitor with no migration, which is the intent. This
    supersedes the `aflat_ack_v1-2026-07` in the Task 5 entry above.
  - `client/src/components/Aflat/consent.ts` — `CONSENT_WORDING_VERSION`, which travels on every
    consent record. Old records keep saying `v1-2026-07`, which is the point of storing it verbatim.
    Supersedes the pin named in the Task 8 entry above.
  - `client/src/locales/{ro,en}/translation.json` — five keys rewritten in both catalogs
    (`com_aflat_ack_text`, `_consent_description`, `_consent_framing`, `_consent_gdpr_after`,
    `_consent_title`) and one added (`com_aflat_consent_marketing_note`). RO is the source copy, EN
    the fallback and the source of `TranslationKeys`, so both are hand-edited here — the upstream
    "only touch EN, other locales are automated" rule does not apply to `com_aflat_*`. Both files
    re-verified as parsing JSON and still strictly key-sorted after the edit. The substance of the
    change: the wording now states that the answer arrives **by email**, and that topic statistics
    are published from the questions while the question text never is.
  - `client/src/components/Aflat/ConsentModal.tsx` — `ConsentRow` gains an optional `note` prop,
    rendered in the right-hand column *below* the label span and therefore **outside** the element
    `aria-labelledby` points at. Only the marketing row passes one. Putting it in `children` would
    have folded it into the checkbox's accessible name and into its click target — someone reading
    "you get the answer either way" and tapping it would have opted themselves into marketing email.
    The label span and the note now share a `flex flex-col gap-1` wrapper so the note clears the
    checkbox by layout rather than by a hand-tuned margin. Styling is existing tokens
    (`text-xs text-text-secondary`); no hex, consistent with the rest of the fork.
  - Tests: the four deliberate version/copy pins updated in the same commit
    (`__tests__/anonStash.spec.ts`, `__tests__/ConsentModal.spec.tsx` ×2, `routes/__tests__/AnonAsk.spec.tsx`),
    plus one new `ConsentModal` case pinning that the note renders, is not inside the label span, is
    not part of the checkbox's accessible name, and does not toggle the box when clicked. Verified by
    mutation: folding the note back into `children` fails that case on the accessible-name query.
    The server-side tests (`api/server/routes/{consents,anonQuestions}.test.js`) needed **no** change
    — they use the version strings only as payload literals and deliberately assert the server stores
    whatever the client sends without validating it.
  - **Not done here, on purpose:** `client/src/**` changed, so this needs a client rebuild and a
    reship before it reaches production. The collection gate is also still shut — the `registration:`
    block in `librechat.yaml` and `AFLAT_ANON_QUESTION_MAX=0` — and that file's gate comment still
    reads "approved but not yet in the code", which is now stale. Opening the gate and correcting
    that comment are sequenced by the deploy runbook, not by this change.

- **Pânza visual identity (Task 9, committed):** the app now carries ai-aflat's identity in both
  themes instead of LibreChat's. Source of truth is `website/assets/tokens.css` in the parent repo —
  values are **copied**, never linked across repos, so a token change there needs a deliberate copy
  here. Nothing was renamed or deleted: every LibreChat custom property keeps its name and only its
  value moved, which is why ~2900 client tests and every untouched component still work.
  - `client/src/style.css`: the `--gray-*` ramp was repainted into a single scale that runs warm at
    the light end (`50 #fbf9f3` linen ground → `100 #f1ece1` flax → `200 #e3dccd` hairline →
    `400 #93876f` clay) and cool-navy at the dark end (`700 #1d3149` → `800 #152438` ink →
    `900 #0a1524` night). That works because light surfaces only ever read 20–300 and light text
    reads 500–800, while dark does the reverse — so one ramp serves both themes and every
    `bg-gray-*` / `text-gray-*` class in the tree comes along for free. `--green-*` was re-anchored
    on `--msg-ok`, `--red-*` on the folk red `#b42b30`, and `--amber-300/700` on `--msg-warn`.
  - **`--red` is feedback and destructive only, never a CTA or a primary button** — tokens.css says
    so explicitly and the comment is repeated in `style.css` so the next person does not "improve"
    it. The CTA is `--panza-cta` `#1e56a0` (light) / `#2a62be` (dark), reached through a new
    per-theme `--cta` / `--cta-hover` / `--link` set in the `html` and `.dark` blocks;
    `--surface-submit` and `--brand-purple` now point at it, as does the shadcn `--primary` HSL
    triple, so the default `Button` variant is CTA blue rather than near-black.
  - **Only four semantic remaps were needed**, all light-theme: `--presentation`,
    `--surface-primary`, `--surface-chat` and `--header-primary` moved off `--white` onto the linen
    ground, and `--surface-tertiary` moved from `--gray-100` down to `--gray-20`. That last one is
    not cosmetic — grounding primary on linen collapsed `--surface-secondary` and
    `--surface-tertiary` onto the same flax, which would have made the composer invisible inside a
    panel (154 and 134 usages respectively). The light ladder is now
    `#ffffff > #fbf9f3 > #f1ece1 > #e9e2d3 > #e3dccd`, monotone and distinct.
  - Dark `--text-tertiary` moved `--gray-500` → `--gray-400` and dark `--text-destructive`
    `--red-600` → `--red-400`. Both were **contrast fixes**: on the navy ground the upstream picks
    landed at 2.4:1 and 3.0:1. They are now 5.2:1 and 5.5:1.
  - **Known AA failure, deliberately not papered over:** the dark CTA fill `#2a62be` on the dark
    ground `#0a1524` is **3.13:1**, under the 4.5:1 bar the task set. Those are tokens.css's own
    dark values. It does clear WCAG 2.2 SC 1.4.11 (non-text contrast, ≥3:1), which is the criterion
    that actually governs a control fill against its background, and the button's white label sits
    at 5.85:1, so no text fails. The one in-palette alternative, `--cta-hover #4a8dff`, fixes the
    fill (5.71:1) but drops the white label to 3.21:1 — a net loss. Fixing it properly means moving
    the dark CTA in `website/assets/tokens.css`, which is a brand decision for the whole site and
    deliberately out of scope for the fork.
  - **Fonts are self-hosted, and must stay that way.** Albert Sans (UI/body) and Fraunces (display)
    ship as six variable woff2 in `client/public/fonts/`, declared with `@font-face` beside the
    existing Inter/Roboto Mono block and resolved through the `$fonts` vite alias. Two cuts per
    family — `latin` plus `latin-ext`, which is where Romanian's comma-below ș/ț and ă actually
    live; a latin-only subset would have rendered the product's own copy in a fallback face.
    Do **not** add a Google Fonts `<link>`: the website still has one and that is a live GDPR
    problem (`docs/backlog/2026-07-28-selfhost-website-fonts-gdpr.md`) that stops at this repo's
    boundary. `tailwind.config.cjs` gained `fontFamily.display`; `sans` keeps Inter as first
    fallback so a cold cache renders in metrics close to what the layout was built against.
  - Brand assets in `client/public/assets/` (that is where the favicons already lived — the plan's
    guess of a new directory was wrong): favicons, `icon-192x192`, `apple-touch-icon-180x180` and
    `maskable-icon` regenerated from `website/assets/icon.png`; the two lockups copied at 720px.
    New `client/src/components/Brand/` exports `BrandLockup` + `APP_NAME` and does the light/dark
    lockup swap **in CSS, not state** — the app supports a `system` theme where no React code knows
    which way the OS leans. Both images are in the DOM; only the visible one carries alt text.
  - **`website/assets/og-image.png` is corrupt** — truncated at exactly 196608 bytes with no IEND
    chunk, so only the top ~30% decodes. The live website links it as `og:image`, so ai-aflat's
    social card is currently broken *on the website*; that needs a fix in the parent repo. Rather
    than copy a broken file, the app's `og-image.png` was rebuilt at 1200×630 from the surviving
    palette (tricolor band, navy diagonal wash) plus the white lockup.
  - De-LibreChat: `index.html` (RO title/description/OG/twitter, `lang="ro-RO"`, per-scheme
    `theme-color`, Pânza pre-hydration splash colours), the PWA manifest in `vite.config.ts`,
    `Startup.tsx` and `Marketplace.tsx` document titles, `About.tsx`'s diagnostics blob (its spec
    pin moved with it), `AuthLayout.tsx`, and both footers. `Chat/Footer.tsx` no longer defaults to
    a LibreChat version badge linking to librechat.ai — it renders the legal-framing line, as does
    the auth `Footer.tsx`, which also lost its `if (!startupConfig) return null` early exit so the
    disclaimer and the privacy link survive a config fetch failure. New key
    `com_aflat_footer_tagline` in `ro`/`en`; `LibreChat` → `ai-aflat` in
    `com_agents_mcp_trust_subtext` / `com_ui_api_keys_description` across all 42 catalogues.
  - **What deliberately still says LibreChat:** every `librechat-data-provider` / `@librechat/*`
    module specifier; `application/vnd.librechat.*` artifact MIME types and the
    `librechat:message-content-layout-change` event name (wire formats — renaming them breaks the
    server contract); `window.__LIBRECHAT_CONFIG__`; the `librechat-rum-proxy` API key; code
    comments and test fixtures; `client/public/assets/logo.svg` (now referenced by nothing but the
    upstream READMEs); the 29 `com_ui_admin_access_warning` translations that name `librechat.yaml`,
    because the file really is called that; and the admin-only `librechat.ai` docs link in
    `AdminSettingsDialog.tsx`, whose visible text is `com_ui_more_info`. **The MIT LICENSE and the
    upstream READMEs are untouched — that is a licence obligation, not an oversight.**
  - Not done here: `client/dist` is a build artifact and is gitignored, so this needs a rebuild and
    a reship before it reaches production. `packages/client/src/theme/themes/{default,dark}.ts`
    still carry upstream's RGB triples — they are dead code in this fork (nothing imports
    `applyTheme`), so they were left alone rather than forked into a second source of truth.

- **Sidebar ground restored after the Pânza remap (committed):** reported as "the chat history
  sidebar is gone". It was never gone — nothing in this fork ever removed, gated or unmounted it,
  and none of the `interface:` flags can. `<UnifiedSidebar />` is mounted unconditionally in the
  authed shell (`client/src/routes/Root.tsx:97`) and the conversation-history panel is prepended
  *outside* `useSideNavLinks` in `client/src/hooks/Nav/useUnifiedSidebarLinks.ts:52-62`, so
  `modelSelect` / `presets` / `prompts` / `bookmarks` / `multiConvo` / `agents` — which only ever
  feed `useSideNavLinks` — cannot take it away. `git diff bf57ffcb0..HEAD` over
  `components/{UnifiedSidebar,Nav,SidePanel,Conversations}`, `hooks/Nav` and `routes/Root.tsx`
  is the About restyle, one locale selector line, and the additive `ConsentModal` mount.
  - What actually broke is a **light-theme token collapse** introduced by the identity commit.
    Moving `--presentation` / `--surface-primary` / `--surface-chat` onto the linen ground put them
    on `--gray-50`, which is exactly what `--surface-primary-alt` — the sidebar's own ground
    (`UnifiedSidebar.tsx`, `Sidebar.tsx`, `ExpandedPanel.tsx`, and `ConvoLink`'s title fade mask) —
    already was. Sidebar-against-chat went to **1.000:1** and there is no border at that seam, so
    the panel stopped existing as a surface: conversation titles floated on the same linen as the
    chat, and with an empty history there was nothing to see at all. This is the same class of
    collapse the entry above caught for `--surface-secondary`/`--surface-tertiary`;
    `--surface-primary-alt` was missed because it did not itself change.
  - Fix is **one token**: light `--surface-primary-alt` `--gray-50` → `--gray-100` (flax, the ramp's
    documented "raised beige band"). Browser-computed against the built CSS: sidebar
    `rgb(241,236,225)` vs chat `rgb(251,249,243)` = **1.12:1**, where upstream's `#f7f7f8`-on-white
    seam was 1.07:1. The active-conversation highlight stays `--surface-active-alt` `#e3dccd`, still
    distinct from the new ground. **Dark was never affected** (`#0f1d30` on `#0a1524` = 1.08:1,
    matching upstream's 1.08:1) and was left alone. No config flag was changed — the deliberate
    suppressions all stand.
  - `client/src/components/UnifiedSidebar/Sidebar.tsx`: the expanded `<nav>` gained
    `border-r border-border-light`. The icon strip already carried its own right border, so the
    sidebar's *outer* edge had none; with both grounds now inside one warm ramp a hairline is what
    makes the seam unambiguous. It fades with the nav, so the collapsed strip still shows exactly
    one border.
  - Tests: `client/src/components/UnifiedSidebar/__tests__/ConversationsPanel.spec.tsx` (7 cases).
    Three pin the mount — the conversations link is first even when `useSideNavLinks` yields only
    the unconditional files panel, the real `SidePanelNav` mounts it by default, and
    `resolveActivePanel` falls back to it when `localStorage` still points at a panel our flags
    removed (a real stale-state path, since `side:active-panel` outlives a config change). Four
    parse `style.css` and assert, per theme, that `--surface-primary-alt` differs from
    `--presentation` / `--surface-primary` / `--surface-chat` and that `--surface-active-alt`
    differs from it. Verified by mutation: restoring `--gray-50` fails the light case only.
  - Unrelated observation, not introduced here:
    `client/src/components/Skills/dialogs/__tests__/UploadSkillDialog.spec.tsx` is
    run-order-fragile. Its three `container.querySelector('input[type=file]')` cases failed in some
    full-suite runs once a 234th suite shifted jest's sequencing, and passed in others (including
    cold-cache) with the identical tree; adding an inert probe suite, or a one-line edit to that
    spec, flips it either way. The two `screen.getByText` cases never fail, which points at its
    `jest.mock('@librechat/client', …, { virtual: true })` intermittently not applying, so the real
    Radix `OGDialog` portals out of `container`. Not touched — Skills is a surface this deployment
    disables.

- **Citation boxes — the `sources` content part (2026-07-29, committed):** when the search engine
  is wired in, the legislative sources behind an answer render as discrete numbered citation boxes
  under the message, not as a footnote list. Built against fixtures — the engine is not reachable
  and nothing emits this shape yet; the renderer takes a `sources[]` array and does not care where
  it came from. Shape is the one proposed in the parent repo's
  `docs/integration/2026-07-29-answer-event-envelope-PROPOSAL.md`, which is itself the search
  contract's Entity result (`entity_id`, `entity_type`, `title`, `act_title`, `snippet`, `url`,
  `in_force`) plus `cited`.
  - `packages/data-provider/src/types/runs.ts`: `ContentTypes.SOURCES = 'sources'`, appended after
    `ERROR`. Purely additive — these are persisted values, so nothing above it may be reordered or
    renamed.
  - `packages/data-provider/src/types/assistants.ts`: `TAflatSource` + `SourcesContentPart`, and
    the part added to the `TMessageContentParts` union so `Part.tsx` narrows on it.
  - `client/src/components/Chat/Messages/Content/Parts/Sources.tsx` (new), exported from
    `Parts/index.ts` and dispatched from `Part.tsx` next to the `THINK` branch, the same way
    `Reasoning.tsx` is.
  - **The URL is never constructed, completed or repaired.** `linkHref()` returns the string
    retrieval sent, unmodified, and only when it is already an absolute `http(s)` address;
    anything else — missing, empty, whitespace, a bare relative fragment, a `javascript:` scheme —
    renders the box with **no anchor at all** rather than a guessed one. This is the product's
    hard invariant (every reference traces to something retrieval actually returned), so it is
    pinned by two tests, not left to review.
  - `in_force: false` is unmissable: the box's 2px left spine turns `--border-destructive`, an
    „ABROGAT" badge sits next to the article label, and a red line says
    „Acest text nu mai este în vigoare." `cited: false` sources never mix with the rest — they sit
    in a `<details>` under „Alte surse consultate (n)", on a transparent ground so they read as
    secondary, numbered continuously after the cited ones. An array with no `cited` field anywhere
    is treated as all-cited. `sources: []` renders **nothing** — empty retrieval is a normal
    outcome, not an empty state to announce.
  - Style is Pânza semantic tokens only, no hex: box `bg-surface-secondary` on the message's
    `bg-presentation` ground — browser-computed against the built CSS, `rgb(241,236,225)` on
    `rgb(251,249,243)` light and `rgb(21,36,56)` on `rgb(10,21,36)` dark, so the box is a box in
    both themes (the standing constraint from the two token-collapse entries above). The numeral
    sits in its own gutter in `font-display` (Fraunces) — the numbering is load-bearing, not
    decoration: a later phase references boxes from the answer text by number.
  - Locale keys `com_aflat_sources_*` (5) added to **both** `ro` and `en` — RO 1820 → 1825,
    EN 1957 → 1962, both still sorted, RO still zero cedilla. RO is the shipped copy; the fork's
    en-only rule in `CLAUDE.md` is upstream's, and this product's user-facing language is Romanian.
  - Tests: `client/src/components/Chat/Messages/Content/Parts/__tests__/Sources.test.tsx`
    (12 cases) — box count, empty array, continuous numbering, exact `href` + `target="_blank"` +
    `rel="noopener noreferrer"`, no anchor without a url, no anchor for an unusable one, the
    repealed marker, the secondary group, absent-`cited` handling, the Romanian copy, and the
    `Part.tsx` dispatch. `src/components/Aflat`, `src/routes`, `src/components/UnifiedSidebar`
    stay at 93/93.
  - Build gotcha, environment not repo: `npm run build:data-provider` fails on a clean checkout
    here because tsdown 0.22.2 loads its config through the optional peer `unrun`, which this
    install does not have — and its `rimraf dist` runs first, so a failed build leaves the package
    with no `dist` and every consumer broken. Fixed locally by dropping `unrun@0.3.1` into
    `node_modules/` (no `package.json` / lockfile change) and building under node v24.16.0.

### 2026-07-29 — `--surface-active` collision (light theme)

A token sweep across all 50 semantic surface/text/border custom properties, in both themes, found
`--surface-active` resolving to the same `#f1ece1` as `--surface-secondary`,
`--surface-primary-alt`, `--surface-primary-contrast`, `--header-hover` and `--header-button-hover`.

Two of those were reachable defects, both light-theme only:

- `ui/TermsAndConditionsModal.tsx:92` — `bg-surface-secondary hover:bg-surface-active`: no hover.
- `Chat/Input/MentionItem.tsx:37` — `hover:bg-surface-secondary active:bg-surface-active`: no press
  feedback.

Same root cause as the sidebar regression earlier the same day, one domino further along. Upstream
light ran `secondary(gray-50) → active(gray-100) → hover(gray-200)`. The Pânza restyle moved
`--surface-secondary` from `gray-50` to `gray-100` — necessary, because `gray-50` had become the
linen ground under `--surface-primary` — and that landed it exactly on `--surface-active`.

Fixed by moving light `--surface-active` to `var(--gray-200)`. Safe: `--surface-active` is used
**only** behind an interaction modifier (`hover:` / `active:`) — 2 occurrences, zero resting-state
uses — so nothing changes at rest. Dark was never affected (`gray-500` #4e5b68 vs secondary
`gray-800` #152438). `--surface-active-alt` (25 uses, the sidebar's row hover) was already correct
at `gray-200` and is untouched.

**Standing hazard for anyone re-theming this fork:** collapsing two semantic tokens onto one value
is invisible to the test suite and can be invisible in one theme only. Sweep the computed values,
don't read the class names.

### 2026-07-29 — `stage_label` on THINK content parts (thinking vs. querying)

The product owner wants the streamed answer to visually distinguish "thinking" from "querying
legislation" — not just one generic reasoning box for both. The fork already carries reasoning
over the existing `THINK` content type / `customParams.reasoningKey` channel (no new transport
needed for that part — see
`docs/integration/2026-07-29-answer-event-envelope-PROPOSAL.md` in the parent repo), but
`Reasoning.tsx` only ever rendered a hardcoded "Gândesc…"/"Gânduri" header regardless of what the
segment actually was.

Added one additive, optional field instead of a new content type: `stage_label?: string` on the
`THINK` member of `TMessageContentParts`
(`packages/data-provider/src/types/assistants.ts`). When a THINK part carries it, `Reasoning.tsx`
shows that label instead of the generic one — e.g. `stage_label: "Caut în legislație…"` for a
retrieval step. Absent, everything renders exactly as before; this is why it didn't need to wait
on the search-engine session's still-open questions about `reasoningKey`/`reasoningFormat` values.

- Changed: `packages/data-provider/src/types/assistants.ts` (field), `client/src/components/Chat/Messages/Content/Parts/Reasoning.tsx` (renders it), `client/src/components/Chat/Messages/Content/Part.tsx` (passes `part.stage_label` through).
- Tests: `client/src/components/Chat/Messages/Content/Parts/__tests__/Reasoning.test.tsx` (7 cases)
  — generic label idle/submitting with no `stage_label`, `stage_label` overriding both while
  submitting and once done, empty reasoning still renders nothing, and the `Part.tsx` dispatch
  wiring both with and without the field. `npx tsc --noEmit` clean against the rebuilt
  `data-provider` package.
- Not done here: the engine side of this (do orchestrator/search-engine emissions actually set
  `stage_label`?) is the integration session's call — flagged in `integration-handoff.md`
  (repo root) and the envelope proposal.

### 2026-07-29 — chat UX pass: composer placeholder, error-box tokens, error copy

Polish + verify pass on the chat surface (composer, message list, empty/error states) ahead of the
search-engine wiring session — see `.claude/tasks/chat-ux-pass.md` (parent repo) for the full
brief. Verified live against a seeded local instance (own scratch Mongo DB + a locally-registered
test account, `.env` untouched) rather than jsdom alone, so the fixes below are confirmed against
the real component tree, not just unit assertions.

- **Composer placeholder (`com_aflat_chat_placeholder`).** The authenticated chat composer
  (`ChatForm.tsx`) had no placeholder of its own outside a project landing page — it fell through
  to `useTextarea`'s generic per-endpoint fallback, which rendered "Mesaj ai-aflat" (the
  `modelDisplayLabel` from `librechat.yaml` substituted into upstream's generic
  `com_endpoint_message_new` template). New key added to both `ro`/`en` catalogs: „Scrie
  întrebarea ta despre legislație" / "Write your question about legislation", voiced to match
  `customWelcome` and `AnonAsk`'s `com_aflat_ask_placeholder`. The project-landing-page override
  (`com_ui_new_chat_in_project`) is unchanged and still wins there. Split into a pure helper,
  `client/src/components/Chat/getChatFormPlaceholder.ts`, called from `ChatView.tsx`, so the
  project-vs-default branch is unit-testable without the component's provider stack — 5 cases in
  `client/src/components/Chat/__tests__/getChatFormPlaceholder.spec.ts`.
- **Error boxes were raw Tailwind red, not Pânza destructive tokens** — the exact hazard flagged
  earlier in this file, just never swept for this pair. `ErrorBox` and `ConnectionError` in
  `client/src/components/Chat/Messages/Content/MessageContent.tsx` carried
  `border-red-500/20 bg-red-500/5 text-gray-600 dark:text-gray-200` (and a second, differently-off
  pastel-red variant for the connection box) instead of `border-border-destructive
  bg-surface-secondary text-text-destructive` — the same trio `AnonAsk.tsx`'s inline error banner
  and `Sources.tsx`'s repealed-article marker already use. Confirmed by seeding real `error`
  content-part messages (`ContentTypes.ERROR`, the same path `Part.tsx` dispatches) into a live
  conversation and screenshotting both themes: the raw-red boxes read as a duller, inconsistent
  red against the rest of the app; the token-based boxes now match the repealed-article spine
  exactly, in both themes.
- **Two hardcoded English strings shown to Romanian users, fixed the same way.** Both are on the
  same generic-error render path `Part.tsx`'s `ContentTypes.ERROR` branch and the legacy
  text-message `error`/`unfinished` flags both go through, so a custom orchestrator error that
  doesn't match LibreChat's own `ErrorTypes`/`ViolationTypes` vocabulary — the expected case for
  ai-aflat's own error surface — hits this every time, not just on an edge case:
  - `client/src/components/Messages/Content/Error.tsx`'s `defaultResponse` fallback was a literal
    `` `Something went wrong. Here's the specific error message we encountered: ${errorMessage}` ``.
    Now `localize('com_aflat_error_generic_details', { 0: errorMessage })`. The interpolated detail
    string itself is untouched (still whatever the backend sent, verbatim) — only the wrapper
    sentence is localized.
  - `MessageContent.tsx`'s `UnfinishedMessage` (the "incomplete response" notice) was a hardcoded
    English sentence passed as `text` into `ErrorMessage`, which then routed it through the same
    `Error` component above — so it was double-narrated ("Something went wrong... The response is
    incomplete...") even before this pass touched anything. `UnfinishedMessage` now renders
    directly in `ErrorBox` with `localize('com_aflat_error_incomplete_response')`, bypassing
    `Error`'s JSON/generic-wrap logic entirely: the incomplete-response text is already a complete,
    human-authored sentence, not a raw code that needs a "here's the technical detail" frame.
  - Both new keys (`com_aflat_error_generic_details`, `com_aflat_error_incomplete_response`) added
    to both `ro`/`en` catalogs, RO drafted then passed through the `language-checker` agent
    unchanged (no register issues found).
  - `com_ui_error_connection`'s RO value was also checked by `language-checker` and flagged as
    tilting technical ("Eroare de conectare la server...") against the product's "explain to a
    neighbour" voice; replaced with „Nu mă pot conecta la server. Reîmprospătează pagina." The
    English value and the `ERROR_CONNECTION_TEXT` literal match-key in `MessageContent.tsx` are
    unchanged — only the RO display string moved.
  - Tests: `client/src/components/Messages/Content/__tests__/Error.spec.tsx` (3 cases) and
    `client/src/components/Chat/Messages/Content/__tests__/MessageContent.spec.tsx` (4 cases) —
    computed classes assert the destructive tokens and assert no `red-\d` class survives, both
    localized strings render in `en` and `ro`, and a recognized `ErrorTypes` JSON code still
    resolves to its own message rather than the generic wrapper.
- **Empty-state check:** `Landing.tsx` + `ConversationStarters` render correctly at the
  authenticated `/c/new` route (verified live, both themes) — greeting from `customWelcome`, no
  starter chips (the `conversation_starters` list in `librechat.yaml` is empty, so
  `ConversationStarters` correctly renders nothing). **This route is not what real users see
  today**: `librechat.yaml`'s `registration.allowedDomains: ['sapio.ro']` collection gate (Task 10)
  means only `@sapio.ro` accounts can sign in via Clerk at all, so the authenticated landing page is
  reachable only by the internal team; every public visitor lands on `/ask` (`AnonAsk.tsx`) instead,
  per the phase-1 plan's `STATUS` section. No `librechat.yaml` change made — adding starters to a
  route the public can't reach yet isn't a live gap, and the file is otherwise off limits per the
  task brief.
- **Mobile pass:** `Sources.tsx`'s citation-box grid confirmed stacking to a single column below the
  `sm:` breakpoint at 390×844 with no clipping or horizontal overflow, in both themes, verified
  against a real seeded conversation (not just the jsdom fixture test). A suspected sidebar
  default-visibility bug at 390px (drawer open covering most of the screen on load) turned out to
  be a **false alarm from this session's own test methodology**: `store.sidebarExpanded`
  (`unifiedSidebarExpanded` in localStorage) had been written `true` while the same browser session
  was still at a desktop viewport, and that persisted preference — not a fresh-visitor default —
  is what showed up after resizing down. With that key cleared, a genuinely fresh session at 390px
  defaults closed exactly as `client/src/store/settings.ts` intends
  (`window.matchMedia('(max-width: 768px)')`). Recorded here so the correction doesn't get
  rediscovered as a regression. The full mobile matrix (composer, sidebar open/close interaction,
  AnonAsk flow, empty state) at 390×844 in both themes, and the `e2e/playwright.config.ts`
  Mobile Chrome/Safari question, are deferred to one consolidated verification pass rather than
  interleaved through this session, per product-owner direction mid-task.
- Verified: full client suite `239/239 suites, 2898/2898 tests` green (no regressions from the
  locale JSON edits or the two touched render paths), `npx tsc --noEmit` clean, `npm run build`
  clean, `eslint` clean on every touched file.

### 2026-08-03 — credits metering (phase 1: ledger, lots, grants, cost log)

Design: `../docs/superpowers/specs/2026-08-03-credits-monetization-design.md`.
Commercial layer: `../documentation/business/business-model.md`.

- **New collections, upstream's billing left alone.** `credit_lots`, `credit_ledger`,
  `credit_balances`, `cost_logs` (schemas + model factories in `packages/data-schemas`,
  wired into `schema/index.ts`, `models/index.ts` and the `AllMethods` type).
  We deliberately do **not** reuse `Balance.tokenCredits` / `Transaction`: those are
  denominated in dollar-mills and auto-debited by upstream's token-spend machinery,
  and two units behind one mutable scalar is how billing bugs are born. It also keeps
  our delta from entangling with upstream on rebase.
- **`packages/data-schemas/src/methods/credits.ts`** — ledger primitives
  (`grantCredits`, `holdCredits`, `settleHold`, `releaseHold`, `releaseStaleHolds`,
  `reverseGrant`, `expireCredits`, `rebuildBalance`, `recordJobCost`), composed into
  `createMethods` and therefore reachable from `~/models` in `/api`.
  Money is integer **micro-lei**; there are no floats and no Decimal128 anywhere.
- **No multi-document transactions.** Production runs a standalone `mongod`, so
  correctness rests on per-lot guarded atomic updates (`creditsRemaining: {$gte: n}`)
  plus a write order in which any crash leaves credits *reserved*, never double-spent.
  `rebuildBalance` repairs a drifted snapshot from the ledger.
- **`packages/api/src/credits/`** — `pricing.ts` (versioned price list; note the
  `isolatedDeclarations` build requires explicit type annotations on every exported
  const, including computed ones) and `service.ts` (price resolution + grant policy).
- **`api/server/routes/credits.js`** — thin wrapper, mounted at
  `/api/aflat/credits`. `GET /pricing`, `GET /balance`, `GET /ledger`,
  admin `POST /grant`, admin `POST /reconcile`.
- **Automatic grants are lazy, not scheduled.** The signup bonus and the monthly
  refill are both applied on demand in `ensureAutomaticGrants`, rather than via a
  hook in `AuthService` plus a cron. This covers OAuth signups (which never pass
  through `registerUser`), needs no scheduler on a VPS that has none, and grants
  nothing to dormant accounts — ~15k inactive v1 users cost nothing instead of
  accruing credits nobody asked for. Both grants are idempotency-keyed, so calling
  it on every request is safe. **This deviates from the spec's §6.2 wording**, which
  described a signup hook and a scheduled job; the spec has been corrected.
- **Not wired to chat yet.** No hold is taken on a real message: that needs the
  `effort` and `outcome` fields on the orchestrator seam, which are phase 2 and must
  be agreed with the search-engine session first.
- **Relevant for phase 2:** the effort selector already has a home. `librechat.yaml`
  `modelSpecs` currently lists two modes (`simple-search` / `deep-search`); the three
  effort levels replace that list rather than needing a new UI component.
- Verified: `credits.spec.ts` 22/22, `credits/service.spec.ts` 18/18,
  `credits.test.js` 15/15; `tsc --noEmit` clean in both packages; both builds clean.

### 2026-08-03 — legislative citations: the `SOURCES` side-channel transport

`Sources.tsx` and `ContentTypes.SOURCES` shipped on 2026-07-29 but had never rendered a real
citation, and could not: the orchestrator emits them out of band as `x_aflat.sources` on the
terminal SSE chunk, and `@langchain/openai`'s `convertCompletionsDeltaToBaseMessageChunk`
(`node_modules/@langchain/openai/dist/converters/completions.js`) rebuilds every chunk from a fixed
allowlist — `delta.content`/`role`/`tool_calls`/`function_call`/`reasoning_content`/`audio` plus
`rawResponse.usage`. A top-level sibling of `choices` is dropped there, before `@librechat/agents`,
before `run.ts`, before anything fork-owned. Re-verified in the tree today; the investigation is
written up in `../docs/integration/2026-07-29-answer-event-envelope-PROPOSAL.md` §"Answers", Q1.

**Chosen fix: don't parse it out of the stream at all — ask for it afterwards.** The fork tells the
orchestrator which assistant message a completion will become, and once the stream has finished it
fetches that message's citations from the orchestrator's own job record.

- **`librechat.yaml`** — one new header on the `ai-aflat` custom endpoint:
  `x-aflat-response-message-id: '{{LIBRECHAT_BODY_MESSAGEID}}'`. That placeholder resolves against
  `config.configurable.requestBody`, which `AgentClient.chatCompletion` populates with
  `messageId: this.responseMessageId` (`api/server/controllers/agents/client.js`) — i.e. the
  server-minted id of the assistant message being generated, unique per turn and known to the fork
  both before and after the run. `messageId` is one of only three fields
  `ALLOWED_BODY_FIELDS` (`packages/api/src/utils/env.ts`) permits in a header placeholder.
- **`packages/api/src/aflat/sources.ts`** (new, plus `aflat/index.ts` and an export from
  `packages/api/src/index.ts`) — `getAflatSourcesPart()` resolves the `ai-aflat` endpoint's own
  `baseURL`/`apiKey` out of the app config, `GET`s `{baseURL}/messages/{responseMessageId}/sources`
  with `Authorization: Bearer <ORCHESTRATOR_API_KEY>`, and returns a `SOURCES` content part.
  It never throws: an unreachable orchestrator, a 404, a malformed payload and `sources: []` all
  mean "no part", because empty retrieval is a normal answer, not an error.
  Each source crosses the boundary field by field — unknown keys are dropped, and a `url` that
  isn't a string is **omitted rather than repaired**. Nothing here ever constructs, completes or
  repairs a citation URL.
- **`api/server/controllers/agents/client.js`** — six lines at the end of `chatCompletion`'s try
  block: await `getAflatSourcesPart(...)` and push the part onto `this.contentParts`. Pushed last,
  so the boxes sit under the answer; pushed onto `contentParts` rather than emitted as its own SSE
  event, so it rides the existing persistence path (`sendCompletion` → `filterMalformedContentParts`
  → `responseMessage.content` → `saveMessage`) and is there on reload. Same shape of post-run
  content-part append as the skill-prime cards immediately above it.

**Why not the two alternatives.** (a) `__includeRawResponse` + a `customHandlers` callback: the raw
chunk would land on `additional_kwargs.__raw_response` on *every* delta, and LangChain's
`AIMessageChunk` concat merges `additional_kwargs` across chunks — merging N raw responses whose
`created`/`id` differ is at best garbage and at worst throws, and `@librechat/agents` has no concept
of the field either (`grep` over its `src/` finds nothing). It also leaves us hostage to the same
allowlist discipline on every `@langchain/openai` bump. (b) Smuggling `x_aflat` inside
`rawResponse.usage`, which *is* on the allowlist and is spread into `response_metadata`: it works
today, but it puts legal citations inside a token-accounting field that billing code reads, for no
gain over an explicit fetch.

**What the orchestrator must provide** (built on its side, `orchestrator/` in the parent repo):
store the `x-aflat-response-message-id` request header on the job, and serve
`GET /v1/messages/{responseMessageId}/sources` → `200 {"job_id", "query_id", "sources": [...]}`
(same `sources[]` `buildFinalSources` already produces), `404` when unknown, behind the existing
`/v1/*` bearer-key middleware. Sources must be committed to the job store *before* the terminal SSE
chunk is written, so the fork's lookup can't race the write — today's `runPipeline` already does
`store.complete()` before the stream's finish chunk, so this holds.

- Tests: `packages/api/src/aflat/sources.spec.ts` (21 cases — a real `node:http` stub orchestrator,
  not a mocked `fetch`: payload passthrough, auth header, empty/404/500/unreachable, unknown-field
  and non-string-url rejection, `${VAR}` resolution, endpoint gating, and a guard that
  `{{LIBRECHAT_BODY_MESSAGEID}}` still resolves — if upstream ever drops `messageId` from
  `ALLOWED_BODY_FIELDS`, citations would otherwise go quietly missing);
  `api/server/controllers/agents/__tests__/aflatSources.spec.js` (4 cases — drives the real
  `AgentClient.sendCompletion` against the stub orchestrator and asserts the returned completion's
  content parts); `packages/data-schemas/src/methods/message.aflat.spec.ts` (3 cases — the part
  round-trips through `saveMessage`/`getMessages` on a real in-memory Mongo, which is the
  survives-a-reload requirement).
- Verified: those three suites green, plus `api` `server/controllers/agents` 309/309 and
  `client` `Sources.test.tsx` 12/12 as regression; `tsc --noEmit` clean in `packages/api` and
  `packages/data-schemas`; `eslint` clean on every touched file; `librechat.yaml` still validates
  against `configSchema.strict()`.
- Not done here: `Sources.tsx`'s visual upgrade (owned separately), and `librechat.yaml`'s still-
  missing `customParams` block for `reasoningKey`/`reasoningFormat` (a separate open item from the
  envelope proposal's Q2, untouched to avoid colliding with whoever picks it up).

### 2026-08-04 — the citation seam widened, and citations rendered act-grouped

The transport landed on 2026-08-03 but the normaliser it fed was written against the 2026-07-29
fixture shape, so it accepted **8** fields of the **21** the orchestrator actually emits. Everything
else was dropped silently — including `viewer_url` and `anchor`, which the whole citation design
depends on, and the `sources_by_act` grouping. Measured against the live orchestrator on `:8085`
(a real query, `GET /v1/messages/{id}/sources`), not against the brief.

- **`packages/data-provider/src/types/assistants.ts`** — `TAflatSource` widened to all 21 fields
  (`ref`, `entity_id`, `entity_type`, `act_id`, `act_title`, `title`, `article_first`,
  `article_last`, `path`, `anchor`, `snippet`, `why`, `url`, `viewer_url`, `in_force`,
  `legdb_status`, `band`, `rank`, `degraded`, `likely_amending`, `cited`), new `TAflatSourceAct`
  for the act grouping, and `SourcesContentPart.sources_by_act?`.
  - **`entity_type` is now a plain `string`, not the `'article' | 'chapter' | 'act'` union.** The
    live engine emits `"provision"`, which that union silently rejected — the field had been
    dropped for a whole round without anyone noticing, and nothing in the fork branches on it.
    A closed union on an opaque engine label buys type safety over a value we never read, at the
    cost of losing data invisibly. Not a good trade; reverted to an open string.
  - `title` is the **provision** label (`art. 78–81`), not the act. `act_title` is the act. These
    were conflated in the earlier fixture shape, which is why the old renderer put `act_title` on
    top of each box and read as six duplicate boxes for one act.
- **`packages/api/src/aflat/sources.ts`** — the allowlist is now four typed field tables
  (`SOURCE_STRING_FIELDS` / `_NUMBER_` / `_BOOLEAN_` / `_URL_`, plus the act-level four), applied by
  `pickStrings` / `pickNumbers` / `pickBooleans` / `pickUrls`. Unknown keys still never cross, and
  a key added to the type but not to a table is still dropped — so the tables carry a comment
  saying so.
  - **The URL discipline moved up to the seam and got stricter.** `url` and `viewer_url` cross only
    when already absolute `http(s)`; a relative path, a bare host, `javascript:` and a non-string
    are **omitted, never repaired**. Previously the seam took any non-empty string and left the
    check to `Sources.tsx`'s `linkHref()` (which still runs — belt and braces).
  - `fetchAflatSources` now resolves `{ sources, sources_by_act? }` rather than a bare array, and
    `buildAflatSourcesPart` takes that payload. An act group whose provisions all fail
    normalisation is dropped rather than rendering an empty card.
- **`client/src/components/Chat/Messages/Content/Parts/Sources.tsx` — rebuilt act-grouped.**
  One card per act, provisions nested. **Several provisions of one act is the normal case**, not a
  bug: one measured query returned five provisions of the Labour Code across three acts.
  - Grouping comes from the orchestrator's `sources_by_act` when present; otherwise the flat list
    is grouped here by `act_id` (falling back to `act_title`). `Part.tsx` passes both through.
  - **Cited/uncited is decided at the ACT level, and this matters:** in the live payload every
    *provision* carries `cited: false` while its *act* carries `cited: true`. Splitting on the
    provision flag — what the old renderer did — would have buried every citation under „Alte surse
    consultate". There is also a floor: if **no** act is marked cited, all of them render in the
    main group rather than the whole citation block hiding itself.
  - **Link split (owner decision, 2026-08-04):** primary per provision → `viewer_url`, our reader,
    which scrolls to the exact article. The official `legislatie.just.ro` link is quieter and sits
    **once in the card footer** rather than repeating per provision — deliberate deviation from the
    brief's "secondary link per provision", because provision-level `url` is act-level in the data
    (identical for every provision of an act), so per-provision it was six copies of one link. A
    provision with no `viewer_url` gets its own official link inline, as the brief's fallback
    requires; a provision with neither, and whose act has neither, renders the „fără link verificat"
    badge and no anchor at all.
  - The numeral in the gutter is now the orchestrator's own `ref` (`S1` → `1`), not a positional
    count, so the number a user sees is the number the engine assigned. Sources arriving without a
    `ref` fall back to a running count that cannot collide with a real one.
  - `why` renders as a quiet always-visible provenance line (`… — matched: concedier, preaviz`) —
    the cheapest trust signal available, and a `<details>` per provision would have been heavier
    than the thing it hides.
  - `likely_amending: true` gets a visible „act de modificare" badge plus a one-line note that the
    act *changes* another act rather than being it. Live and real: the measured query returned
    OUG 93/2006, an amending ordinance, and the model has already misattributed such text to the
    Labour Code.
  - `in_force: false` keeps the „ABROGAT" treatment, now at both act and provision level.
  - `degraded: "rerank_budget_exhausted"` is carried but **never rendered** — the reranker is off by
    owner setting and it is present on essentially every hit. Pinned by a test.
  - **Provisions routinely arrive with no `title` and no `path`.** Every provision of the two
    non-code acts in the measured query did. The card renders those from the snippet alone; nothing
    is synthesised to fill the gap. Also pinned by a test.
  - Style is Pânza semantic tokens only — verified zero hex/rgb/palette classes in the file, and
    every token used (`--border-medium` included) is defined in both themes. `client/src/style.css`
    was **not** touched, so the collision sweep was not re-run.
  - 3 new locale keys in **both** `ro` and `en` (`com_aflat_sources_amending`, `_amending_note`,
    `_open_article`); `com_aflat_sources_open` — previously dead — is now the act footer link.
    RO 1839 → 1842, EN 1976 → 1979, both still sorted, RO still zero cedilla.
- **`librechat.yaml`** — two changes.
  - `customParams: { reasoningKey: reasoning_content, reasoningFormat: disabled }` on the `ai-aflat`
    endpoint. `reasoningKey` is what makes the orchestrator's stage narration render as reasoning;
    `reasoningFormat: disabled` stops the fork sending a reasoning parameter of its own, because the
    engine takes its effort from the model id.
  - **Three model specs, not two.** The engine takes `low | medium | high`; two exposed ids left
    `medium` — the intended default and the middle rung of the price ladder — unreachable.
    `simple-search` „Rapid" (low), `standard-search` „Normal" (medium, **default**), `deep-search`
    „Aprofundat" (high). Both pre-existing ids keep working; the ids are the contract with the
    orchestrator and must not be renamed. **The Romanian labels are provisional and have not had a
    `language-checker` register pass.**
  - Validated against `configSchema.strict()` from the built data-provider, not by eye.
- Tests: `packages/api/src/aflat/sources.spec.ts` 28/28 (7 new: the full 21-field live fixture and
  a key-set equality guard, the act grouping, an empty act group, `viewer_url`/`url` rejection for
  relative + `javascript:` + bare-host, non-string `anchor`/`act_id`);
  `client/.../__tests__/Sources.test.tsx` 18/18 (rewritten against act-grouped fixtures taken from
  the live payload); `packages/data-schemas/src/methods/message.aflat.spec.ts` 4/4 (+1: the act
  grouping round-trips through Mongo, since a reload that flattens the grouping is a regression the
  old case could not see). Regression: `api` `server/controllers/agents` 309/309, `client`
  `Messages/Content` + `Aflat` + `routes` + `UnifiedSidebar` 601/601. `tsc --noEmit` clean in
  `client`, `packages/api`, `packages/data-provider`, `packages/data-schemas`; `eslint` clean on
  every touched file.
- **Known cosmetic defect, orchestrator-side (not fixed here):** `act_title` arrives with literal
  markdown emphasis in it — `CODUL MUNCII din 24 ianuarie 2003 (**republicat**) ( Legea nr. 53/2003 )`
  — and the card renders it verbatim, asterisks and all. Deliberately not stripped in the renderer:
  `act_title` is part of how a citation is identified, and quietly rewriting it in one place and not
  another is how citations drift. Belongs on the emitting side.
- **Also observed:** act titles run to ~300 characters (the engine truncates there). The card
  clamps to three lines with the full title on `title=`; nothing is cut from the data.

- **Stripe purchasing — credits phase 3 (committed):** new TS module `packages/api/src/payments`
  (`basis` / `checkout` / `client` / `config` / `reconcile` / `webhook`), two new collections
  (`payments`, `payment_events`) with schemas + models + `methods/payments.ts` in `data-schemas`,
  `POST /api/aflat/credits/checkout` on the existing credits router, and a **new** unauthenticated
  raw-body router at `/api/aflat/webhooks/stripe`. Dependency `stripe@^22.4.0` added to `api`
  (runtime) and `packages/api` (peer + dev), matching how the monorepo declares every other runtime
  dep. Design: `docs/superpowers/specs/2026-08-04-stripe-payments-design.md`.
  - **`api/server/index.js` mounts the webhook router BEFORE `express.json()`** — the one change to
    `api/` that is not a thin wrapper, and it is load-bearing. Stripe signature verification can only
    run against unparsed bytes, so the router carries its own `express.raw()`. Moving the mount below
    the JSON parser breaks every webhook with an error that reads like a Stripe misconfiguration.
    A comment says so at the mount site; `server/routes/webhooks.test.js` mounts it the same way.
  - **Three deviations from the parent credits spec**, all argued in §3.3 of the payments design:
    (1) **no `stripePriceId`** — inline `price_data` instead, so `pricing.ts` stays the single source
    of truth and a reprice is a one-line change rather than a Stripe-dashboard ritual; (2) the cost
    basis may settle a beat after the grant — credits are granted immediately on an estimated fee
    flagged `costBasisPending` because Stripe's balance transaction is often not ready at
    `checkout.session.completed`, and `reconcileCostBases` writes the true figure later; (3) a
    **`payment_events`** collection, because `grantCredits`'s idempotency key does not cover the
    events that grant nothing (`payment_intent.payment_failed`, `charge.refunded`).
  - `payment_method_types` is deliberately **omitted** from the session so the enabled methods come
    from the Stripe Dashboard — that is what makes turning on **Revolut Pay** a toggle, not a deploy.
    Unverified: whether Revolut Pay supports RON. If it is EUR-only it simply will not render.
  - New `credits` primitive `correctLotCostBasis`, which **refuses on a lot already spent against**
    (guard expressed in the query, not checked first) — correcting a lot after a debit would leave it
    disagreeing with the ledger allocations that copied the old basis.
  - VAT is read from `AFLAT_VAT_RATE` (default 0.21) rather than hardcoded: the rate is still an open
    decision with the accountant, and a wrong one silently corrupts every margin figure.
  - **Nothing charges without operator setup** — `isPaymentsConfigured()` returns 503 rather than
    throwing, so the app boots and answers questions fine on a deployment that cannot take payments.
  - Tests: 27 in `packages/api/src/payments`, 5 checkout-route + 4 webhook-route in `api`. Full
    sweep green (45 `packages/api`, 22 `data-schemas`, 24 `api` routes); `tsc --noEmit` and
    `eslint` clean across every touched file.
  - **Wallet UI at `/credits` (committed):** `client/src/components/Aflat/Wallet/`
    (`Wallet.tsx`, `Bundles.tsx`, `History.tsx`, `credits.ts`), lazy-routed under `Root` in
    `client/src/routes/index.tsx`. Data layer calls `/api/aflat/credits` directly via `apiBaseUrl()`
    rather than through `librechat-data-provider`, matching `consent.ts` and `usePostLoginHandoff.ts`
    — keeping fork endpoints out of the shared package is what keeps rebases cheap. 45 RO + 45 EN
    locale keys added (`com_aflat_wallet_*`, `com_aflat_effort_*`).
    - **Commercial rules pinned by tests**, because they would otherwise soften unnoticed: the effort
      ladder is quoted in **credits only**, **RON appears on bundles and nowhere else**, and checkout
      cannot start without an explicit tick waiving the 14-day withdrawal right (never pre-ticked,
      adjacent to the buy buttons rather than buried in terms).
    - **The return page grants nothing.** Credits come from the webhook, which can land after the
      redirect, so `useReturnFromCheckout` polls briefly and says „Creditele apar în câteva secunde"
      rather than showing a stale balance that reads as "I paid and got nothing".
    - `request.post` is untyped upstream (unlike `request.get`), hence the single cast in `credits.ts`.
    - Tests: 9 in `client/src/components/Aflat/__tests__/Wallet.spec.tsx`. Aflat suite 67/67, routes
      22/22, `tsc --noEmit` clean, `npm run frontend` builds.
  - **Romanian register pass done.** Wallet copy moved off accounting register („mișcare de credite",
    „în lucru") onto plain spoken Romanian, and „Cum se consumă" became „Cât costă o întrebare".
    **Romanian pluralisation was simply wrong** and is now correct: three forms, with the 20+ form
    taking „de" („o întrebare" / „5 întrebări" / „20 de întrebări"). A single `{{count}} întrebări`
    string rendered „1 întrebări" on the balance chip for any user with fewer than 20 credits' worth.
    Base keys are retained beside the `_one`/`_few`/`_other` variants only because the generated
    `TranslationKeys` union is derived from the catalog; i18next still resolves the suffixed form.
    Pinned by `client/src/components/Aflat/__tests__/WalletCopy.spec.ts`, which also asserts
    comma-below diacritics (ș/ț, never ş/ţ).
  - **`POST /api/aflat/credits/reconcile-costs` (admin)** runs `reconcileCostBases`. Deliberately a
    manual/cron trigger rather than a schedule, matching `expireCredits` and `releaseStaleHolds` —
    this deployment has no scheduler.
    - **Run against the first real purchase, it corrected the basis from 0.11155 to 0.11028
      lei/credit.** Backing the fee out: Stripe actually charged **1.91 lei** on a 29 lei payment,
      against the **1.656 lei** the business model assumes (1.4% + 1.25). The documented fee
      assumption — and therefore the margin table resting on it — is optimistic. The estimate
      constants are left unchanged for now (one observation is not a fee schedule) but the
      misleading "deliberately pessimistic" comment on them was removed, because it was false.

- **Embedded Clerk sign-in (committed):** Clerk's `<SignIn/>` rendered inside our own login page
  instead of redirecting to Clerk's hosted page. New `packages/api/src/auth/clerk.ts` (JWKS token
  verification), `api/server/routes/clerkAuth.js` mounted at `/api/aflat/auth`, and
  `client/src/components/Aflat/Auth/ClerkSignIn.tsx`. Dependency `@clerk/clerk-react@^5.61.3` in
  `client`. Design: `docs/superpowers/specs/2026-08-04-clerk-embedded-auth-design.md`.
  - **The exchange is the only new security surface.** Embedding leaves the browser holding a
    *Clerk* token while the app needs a *LibreChat* one. `POST /api/aflat/auth/clerk` verifies the
    Clerk token against the instance JWKS and then hands off to **`setAuthTokens`** — the same
    primitive the OAuth callback already uses — so the existing refresh flow establishes the
    session. Deliberately minimal: the less bespoke session code on the login path, the fewer ways
    it fails. User creation reuses `createUser` with the exact shape `openidStrategy` writes, and
    lookup reuses `findOpenIDUser`; no parallel notion of a user is introduced.
  - **Issuer pinning is not optional.** A signature check alone proves only "some Clerk signed
    this" — anyone could sign up on their own Clerk instance and walk in. `clerk.spec.ts` pins all
    eight ways in: wrong key, wrong issuer, expired, no `sub`, `alg: none`, garbage, and that a
    missing `email_verified` reads as **false** (otherwise the signup bonus reaches unverified
    addresses, which is exactly what its gate exists to prevent).
  - `isEmailDomainAllowed` runs on this path too — a second front door that ignored the collection
    gate would silently defeat a deliberate product decision.
  - **An existing non-`openid` account with the same email is refused (409), never linked.**
    Linking would let anyone able to create a Clerk account with a known email take over the
    matching local account. This is why the ~15k v1 users need their own migration decision.
  - `CLERK_PUBLISHABLE_KEY` is served through `/api/config` rather than baked in as a `VITE_`
    variable, so one bundle serves dev and production instances. Publishable keys are public by
    construction (they encode the instance domain).
  - **Rollback is a config change:** unset `CLERK_PUBLISHABLE_KEY` and login falls back to the OIDC
    redirect, which this work leaves untouched. `?redirect=false` forces the fallback per-request.
  - **LibreChat's local auth is NOT yet deleted** — only bypassed, and already disabled by
    `ALLOW_EMAIL_LOGIN=false`. Removing the password/registration/reset/2FA machinery is the
    remaining half of the decision and is deliberately a separate change, so the embedded path can
    be proven in the browser before the fallback is destroyed.
