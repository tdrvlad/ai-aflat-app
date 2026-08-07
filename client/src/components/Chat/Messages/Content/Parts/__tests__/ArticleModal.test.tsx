import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import type { TAflatSource } from 'librechat-data-provider';
import ArticleModal from '../ArticleModal';

/**
 * The modal shows a user the actual text of a cited article, so the thing it must
 * never do is show the WRONG one — or anything it did not read out of the document
 * the reader itself serves. These cases pin exactly that: the article is cut from
 * the fetched blob at the anchor the orchestrator resolved, an anchor that is not
 * in the document produces an honest failure rather than a nearby article, an
 * act-level citation never pretends to be article-level, and markup that arrives
 * with the blob cannot execute.
 *
 * The reader URL shape is the one measured against production on 2026-08-07:
 * `/v1/viewer/{id}#{anchor}` is the only form that lands on the article, so the
 * document to fetch is that URL without its fragment.
 */

const READER = 'https://legislatie.ai-aflat.ro';

/** Shaped like the real blob, including the reader's own fold control (`TAG_COLLAPSED`). */
const BLOB = `<!doctype html><html><body>
  <span id="id_artA139">Articolul 21 — o altă prevedere.</span>
  <span class="S_ART" id="id_artA140">
    <span class="TAG_COLLAPSED" id="id_cllpsdA140">&nbsp;+&nbsp;</span>
    <span id="id_artA140_ttl">Articolul 22</span>
    <span id="id_artA140_bdy">(1) Funcţionarii publici au dreptul anual la un concediu de odihnă platit.</span>
    <a href="https://legislatie.just.ro/Public/DetaliiDocument/250">Hotărârea nr. 250/1992</a>
  </span>
</body></html>`;

const PROVISION: TAflatSource = {
  ref: 'S1',
  entity_id: '62424:id_artA140:0:100',
  act_id: 62424,
  act_title: 'ORDONANŢA DE URGENŢĂ nr. 92 din 10 noiembrie 2004',
  title: 'art. 22–25',
  path: 'Capitolul II › Secţiunea a 4-a',
  snippet: 'Fragmentul returnat de căutare.',
  why: 'matched: concediu, odihn',
  url: 'https://legislatie.just.ro/Public/DetaliiDocument/62424',
  viewer_url: `${READER}/v1/viewer/62424#id_artA140`,
  in_force: true,
};

const mockFetch = (body: string, ok = true) =>
  jest.fn().mockResolvedValue({ ok, status: ok ? 200 : 502, text: async () => body });

/**
 * A distinct act per case, on purpose.
 *
 * The component caches one fetch per act document so that four cited provisions of
 * the Labour Code do not pull ~200 kB four times. That cache is module-level and
 * therefore outlives an individual test — reusing an act id here would silently
 * serve the previous case's blob and make an assertion pass for the wrong reason.
 */
let nextAct = 62424;
const forAct = (over: Partial<TAflatSource> = {}): TAflatSource => {
  const actId = ++nextAct;
  return {
    ...PROVISION,
    act_id: actId,
    viewer_url: `${READER}/v1/viewer/${actId}#id_artA140`,
    url: `https://legislatie.just.ro/Public/DetaliiDocument/${actId}`,
    ...over,
  };
};

const renderModal = (provision: TAflatSource) =>
  render(
    <ArticleModal
      provision={provision}
      actTitle={provision.act_title}
      open={true}
      onOpenChange={() => undefined}
    />,
  );

describe('ArticleModal', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('fetches the document without the fragment and shows the article at the anchor', async () => {
    const fetchMock = mockFetch(BLOB);
    global.fetch = fetchMock as unknown as typeof fetch;

    const provision = forAct();
    renderModal(provision);

    expect(await screen.findByTestId('aflat-article-text')).toHaveTextContent('Articolul 22');
    // The fragment identifies the element inside the document; it is never sent to the server.
    expect(fetchMock).toHaveBeenCalledWith(
      `${READER}/v1/viewer/${provision.act_id}`,
      expect.anything(),
    );
  });

  it('shows only the cited article, not its neighbours', async () => {
    global.fetch = mockFetch(BLOB) as unknown as typeof fetch;

    renderModal(forAct());

    const body = await screen.findByTestId('aflat-article-text');
    expect(body).toHaveTextContent('Articolul 22');
    expect(body).not.toHaveTextContent('Articolul 21');
  });

  // The reader's fold controls render as a bare „+" in front of the title and do
  // nothing without its script — they are chrome, not law.
  it('drops the reader’s own fold controls', async () => {
    global.fetch = mockFetch(BLOB) as unknown as typeof fetch;

    renderModal(forAct());

    const body = await screen.findByTestId('aflat-article-text');
    expect(body.querySelector('.TAG_COLLAPSED')).toBeNull();
    expect(body.textContent?.trim().startsWith('+')).toBe(false);
    expect(body).toHaveTextContent('Articolul 22');
  });

  it('says so rather than showing a different article when the anchor is not in the document', async () => {
    global.fetch = mockFetch(
      '<!doctype html><html><body><span id="id_artA999">Altceva</span></body></html>',
    ) as unknown as typeof fetch;

    renderModal(forAct());

    await waitFor(() =>
      expect(screen.getByText(/could not load the article text/i)).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('aflat-article-text')).not.toBeInTheDocument();
    // The excerpt retrieval returned is the honest fallback.
    expect(screen.getByText('Fragmentul returnat de căutare.')).toBeInTheDocument();
  });

  it('never fetches, and never claims an article, for an act-level citation', async () => {
    const fetchMock = mockFetch(BLOB);
    global.fetch = fetchMock as unknown as typeof fetch;

    const actLevel = forAct();
    renderModal({ ...actLevel, viewer_url: `${READER}/viewer/${actLevel.act_id}` });

    expect(await screen.findByText(/cannot be pinpointed/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('aflat-article-text')).not.toBeInTheDocument();
  });

  it('carries the anchor on the way out, so the act opens AT the article', async () => {
    global.fetch = mockFetch(BLOB) as unknown as typeof fetch;

    const provision = forAct();
    renderModal(provision);

    const openAct = await screen.findByTestId('aflat-article-open-act');
    expect(openAct).toHaveAttribute('href', `${READER}/v1/viewer/${provision.act_id}#id_artA140`);
    expect(openAct).toHaveAttribute('target', '_blank');
    expect(openAct).toHaveAttribute('rel', 'noopener noreferrer');

    // The official source travels alongside, act-level and verbatim.
    expect(screen.getByTestId('aflat-article-open-official')).toHaveAttribute(
      'href',
      `https://legislatie.just.ro/Public/DetaliiDocument/${provision.act_id}`,
    );
  });

  it('falls back honestly when the reader cannot be reached', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;

    renderModal(forAct());

    await waitFor(() =>
      expect(screen.getByText(/could not load the article text/i)).toBeInTheDocument(),
    );
  });

  it('strips script and event handlers that arrive with the blob', async () => {
    global.fetch = mockFetch(
      `<!doctype html><html><body><span id="id_artA140">Articolul 22` +
        `<script>window.__pwned = true;</script>` +
        `<img src="x" onerror="window.__pwned = true" />` +
        `</span></body></html>`,
    ) as unknown as typeof fetch;

    renderModal(forAct());

    const body = await screen.findByTestId('aflat-article-text');
    expect(body).toHaveTextContent('Articolul 22');
    expect(body.querySelector('script')).toBeNull();
    expect(body.querySelector('img')?.getAttribute('onerror')).toBeNull();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
  });
});
