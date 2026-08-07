const fs = require('fs-extra');

/**
 * The service worker that retires the service worker — WITHOUT reloading the page.
 *
 * `vite-plugin-pwa`'s `selfDestroying: true` emits an activate handler that ends with
 * `client.navigate(client.url)`, i.e. a full reload of every open tab. That is the
 * bug it was supposed to fix, wearing a different hat: measured in production
 * 2026-08-07, a browser holding an old registration got reloaded on arrival, and a
 * reload lands in the middle of the Clerk exchange — sign-in fails and the parked
 * question goes with it. `nginx` logged the exchange as 499 (client closed request)
 * while the server had already created the user.
 *
 * So the generated worker is overwritten here with one that unregisters itself and
 * drops its caches and then stops. Existing registrations still get retired — that
 * is the whole point of still serving `/sw.js` — but retirement costs nothing
 * visible. There is no fetch handler, so it never serves a stale document either.
 *
 * Overwritten in post-build rather than configured away because the plugin owns the
 * filename and the manifest, and this is the one file whose contents must not be
 * whatever the plugin thinks is helpful.
 */
const SILENT_RETIREMENT_SW = `/* ai-aflat: retires this worker silently. No fetch handler, no navigate. */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        await self.registration.unregister();
        const names = await caches.keys();
        await Promise.all(names.map((name) => caches.delete(name)));
      } catch (err) {
        /* A browser that will not let us tidy up is not a reason to break the page. */
      }
      /**
       * DELIBERATELY NO client.navigate(). Reloading the page here is what broke
       * sign-in in production — see post-build.cjs. The next navigation the user
       * makes for their own reasons is soon enough; this worker is already gone.
       */
    })(),
  );
});
`;

async function postBuild() {
  try {
    await fs.copy('public/assets', 'dist/assets');
    await fs.copy('public/robots.txt', 'dist/robots.txt');

    await fs.writeFile('dist/sw.js', SILENT_RETIREMENT_SW, 'utf8');
    /* If this ever reappears it re-arms the worker on every load — see vite.config.ts. */
    await fs.remove('dist/registerSW.js');

    console.log('✅ PWA icons and robots.txt copied successfully. Glob pattern warnings resolved.');
    console.log('✅ sw.js replaced with the silent-retirement worker (no client.navigate).');
  } catch (err) {
    console.error('❌ Error copying files:', err);
    process.exit(1);
  }
}

postBuild();
