import fs from 'fs';
import path from 'path';

/**
 * The Cloudflare Web Analytics beacon lives inline in `client/index.html` so it also
 * covers the pre-login routes. Nothing else exercises that file, so these assertions
 * are the only thing standing between a bad edit and silently losing all app traffic.
 */

const INDEX_HTML = path.join(__dirname, '../../index.html');
const APP_TOKEN = 'c89221bfaa9f45428061c170b690fd28';
const BEACON_SRC = 'https://static.cloudflareinsights.com/beacon.min.js';

/** The inline analytics script, taken verbatim from the shipped HTML. */
function analyticsSource() {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const blocks = html.match(/<script>(?:(?!<\/script>)[\s\S])*<\/script>/g) || [];
  const analytics = blocks.find((block) => block.includes('cloudflareinsights'));
  if (!analytics) {
    throw new Error('no inline Cloudflare Web Analytics script found in client/index.html');
  }
  return analytics.replace(/^<script>/, '').replace(/<\/script>$/, '');
}

/** Runs that script with a spoofed hostname; returns whatever it appended to <head>. */
function scriptsInjectedOn(hostname) {
  const appended = [];
  const doc = {
    createElement: (tag) => document.createElement(tag),
    head: { appendChild: (node) => appended.push(node) },
  };
  new Function('location', 'document', analyticsSource())({ hostname }, doc);
  return appended;
}

describe('Cloudflare Web Analytics beacon', () => {
  it('loads with the app token on app.ai-aflat.ro', () => {
    const injected = scriptsInjectedOn('app.ai-aflat.ro');
    expect(injected).toHaveLength(1);

    const [beacon] = injected;
    expect(beacon.src).toBe(BEACON_SRC);
    expect(beacon.type).toBe('module');
    expect(JSON.parse(beacon.getAttribute('data-cf-beacon'))).toEqual({ token: APP_TOKEN });
  });

  it('stays inert off the production host', () => {
    for (const host of ['localhost', '127.0.0.1', '', 'ai-aflat.ro', 'preview.example.com']) {
      expect(scriptsInjectedOn(host)).toEqual([]);
    }
  });

  it('does not reuse the marketing site token', () => {
    expect(analyticsSource()).not.toContain('a6addd8ac8f64aab847c8e4e3b41bc99');
  });
});
