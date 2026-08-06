
---

## 2026-08-06 — upstream cut loose

The `upstream` remote (`danny-avila/LibreChat`) has been **removed**. We no longer merge LibreChat
releases.

**Why.** The product is single-purpose: one endpoint, one assistant, Clerk identity, our own credit
system, our own Pânza UI. Every upstream release brought machinery we then had to switch off, and
keeping the merge path open was the reason we could not delete any of it — each deletion would have
become a permanent conflict. Holding the door open was costing more than it returned.

**What we give up, stated plainly.** Upstream security patches. Mitigation: most of that surface is
being deleted anyway (Clerk replaces the auth stack, uploads are off), and `npm audit` plus
Dependabot cover the dependency half. This is a real cost, not a free win — if a LibreChat CVE lands
in code we still run, we patch it ourselves.

**What this unlocks:** deleting unreachable upstream surfaces, and moving `orchestrator/` into this
repo so the contract between them can live in one place instead of being restated on both sides.

The local `main` branch still tracks `origin/main`, which mirrors upstream's history. It is inert;
delete it whenever convenient.

## 2026-08-06 — three live upstream features closed

Audit found these reachable by signed-in users, none of them ours:

- **Public share links.** `ALLOW_SHARED_LINKS` was unset, and `api/server/routes/share.js` reads
  *unset* as enabled; `sharedLinks` was absent from the interface config, so the schema default
  (`create`/`share`/`public`: true) applied. A user could publish a whole conversation to anyone
  with the URL. For a product whose users type health, criminal and family detail into the box —
  Article 9 and Article 10 material — that is a disclosure risk, not clutter. Now false in
  `librechat.yaml`, `librechat.local.yaml` **and** `.env`; all three, because either alone leaves a
  path open.
- **Temporary chat** — default-true upstream, wired into the header authenticated users see. A
  second conversation mode we never designed for and never explain. Off.
- **MCP builder panel** — reachable with zero servers configured. Off.
