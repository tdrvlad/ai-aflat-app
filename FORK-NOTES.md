# ai-aflat fork notes

Base: upstream tag v0.8.7. Work branch: aflat-main.
Upstream merge cadence: monthly + security releases (`git fetch upstream && git merge <tag>`).
Rule: every deviation from upstream = one line here, same commit.

## Deviations
- (none yet — no LibreChat code or config changed in Task 1)

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
