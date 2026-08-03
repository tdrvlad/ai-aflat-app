import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { ContentTypes } from 'librechat-data-provider';
import type { TAflatSource, TAflatSourceAct } from 'librechat-data-provider';
import i18n from '~/locales/i18n';
import Sources from '../Sources';
import Part from '../../Part';

/**
 * The citation boxes are where the product's hard invariant is either kept or
 * broken: every legal reference a user sees must trace to something retrieval
 * actually returned. These cases pin the parts that must never soften — no link
 * is ever invented for a source that arrived without one, a repealed article says
 * so, an amending act is not passed off as the law it amends, and sources the
 * answer did not lean on stay out of the main group.
 *
 * Fixtures are the shape the live orchestrator emits, measured 2026-08-04:
 * several provisions of one act is the normal case, provisions of an act other
 * than a code routinely arrive with no `title` and no `path`, and the act-level
 * `cited` flag is true while its own provisions are individually false.
 * Test language is pinned to `en` in `client/test/setupTests.js`, so assertions
 * use the English catalog values unless a test switches the language itself.
 */

const CODE_TITLE = 'CODUL MUNCII din 24 ianuarie 2003 ( Legea nr. 53/2003 )';

const PROVISION_A: TAflatSource = {
  ref: 'S1',
  entity_id: '41627:id_artA620:132816:136035',
  entity_type: 'provision',
  act_id: 41627,
  act_title: CODE_TITLE,
  title: 'art. 78–81',
  article_first: '78',
  article_last: '81',
  path: 'Titlul II › Capitolul V',
  anchor: 'id_artA620',
  snippet:
    'Concedierea dispusă cu nerespectarea procedurii prevăzute de lege este lovită de nulitate.',
  why: 'Codul muncii › Titlul II › Capitolul V — matched: concedier, preaviz',
  url: 'https://legislatie.just.ro/Public/DetaliiDocument/41627',
  viewer_url: 'https://legislatie.ai-aflat.ro/viewer/41627?a=id_artA620',
  in_force: true,
  rank: 1,
  degraded: 'rerank_budget_exhausted',
  likely_amending: false,
  cited: false,
};

const PROVISION_B: TAflatSource = {
  ...PROVISION_A,
  ref: 'S2',
  entity_id: '41627:id_artA588:128603:132750',
  title: 'art. 73–77',
  article_first: '73',
  article_last: '77',
  anchor: 'id_artA588',
  snippet:
    'În perioada prevăzută la art. 72 alin. (1), agenția teritorială trebuie să caute soluții.',
  viewer_url: 'https://legislatie.ai-aflat.ro/viewer/41627?a=id_artA588',
  rank: 2,
};

const LABOUR_CODE: TAflatSourceAct = {
  act_id: 41627,
  act_title: CODE_TITLE,
  url: 'https://legislatie.just.ro/Public/DetaliiDocument/41627',
  viewer_url: 'https://legislatie.ai-aflat.ro/viewer/41627',
  in_force: true,
  likely_amending: false,
  cited: true,
  provisions: [PROVISION_A, PROVISION_B],
};

const REPEALED_ACT: TAflatSourceAct = {
  act_id: 12345,
  act_title: 'Legea nr. 12/1990 privind protejarea populației',
  url: 'https://legislatie.just.ro/Public/DetaliiDocument/12345',
  in_force: false,
  cited: true,
  provisions: [
    {
      ref: 'S3',
      entity_id: '12345:id_artA4',
      act_id: 12345,
      title: 'art. 4',
      snippet: 'Text care nu mai produce efecte.',
      url: 'https://legislatie.just.ro/Public/DetaliiDocument/12345',
      viewer_url: 'https://legislatie.ai-aflat.ro/viewer/12345?a=id_artA4',
      in_force: false,
      cited: true,
    },
  ],
};

const AMENDING_ACT: TAflatSourceAct = {
  act_id: 77268,
  act_title: 'ORDONANȚĂ DE URGENȚĂ nr. 93 din 22 noiembrie 2006 pentru modificarea Ordonanței…',
  url: 'https://legislatie.just.ro/Public/DetaliiDocument/77268',
  in_force: true,
  likely_amending: true,
  cited: false,
  provisions: [
    {
      ref: 'S5',
      entity_id: '77268:id_parA10',
      act_id: 77268,
      anchor: 'id_parA10',
      snippet: 'Text al ordonanței de modificare.',
      url: 'https://legislatie.just.ro/Public/DetaliiDocument/77268',
      viewer_url: 'https://legislatie.ai-aflat.ro/viewer/77268?a=id_parA10',
      in_force: true,
      likely_amending: true,
      cited: false,
    },
  ],
};

const cards = () => screen.getAllByTestId('aflat-source-act-card');
const flat = (acts: TAflatSourceAct[]): TAflatSource[] => acts.flatMap((act) => act.provisions);

describe('Sources', () => {
  it('renders one card per act, with that act’s provisions nested inside it', () => {
    render(<Sources sources={flat([LABOUR_CODE])} sourcesByAct={[LABOUR_CODE]} />);

    expect(cards()).toHaveLength(1);
    expect(screen.getByTestId('aflat-source-act')).toHaveTextContent(CODE_TITLE);
    expect(screen.getAllByTestId('aflat-provision-title')).toHaveLength(2);
    expect(screen.getByText('art. 78–81')).toBeInTheDocument();
    expect(screen.getByText('art. 73–77')).toBeInTheDocument();
    expect(screen.getAllByTestId('aflat-provision-path')[0]).toHaveTextContent(
      'Titlul II › Capitolul V',
    );
  });

  it('groups a flat source list by act when the orchestrator sent no grouping', () => {
    render(<Sources sources={flat([LABOUR_CODE])} />);

    expect(cards()).toHaveLength(1);
    expect(screen.getAllByTestId('aflat-provision-title')).toHaveLength(2);
  });

  it('renders nothing at all for an empty array', () => {
    const { container } = render(<Sources sources={[]} />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('aflat-sources')).not.toBeInTheDocument();
  });

  it('numbers provisions with the orchestrator’s own S<n> reference', () => {
    render(<Sources sources={flat([LABOUR_CODE])} sourcesByAct={[LABOUR_CODE]} />);

    const items = within(cards()[0]).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent(/^1/);
    expect(items[1]).toHaveTextContent(/^2/);
  });

  it('makes our article-level reader the primary link and the official act the quiet one', () => {
    render(<Sources sources={flat([LABOUR_CODE])} sourcesByAct={[LABOUR_CODE]} />);

    const provisionLinks = screen.getAllByTestId('aflat-provision-link');
    expect(provisionLinks).toHaveLength(2);
    expect(provisionLinks[0]).toHaveAttribute('href', PROVISION_A.viewer_url);
    expect(provisionLinks[0]).toHaveAttribute('target', '_blank');
    expect(provisionLinks[0]).toHaveAttribute('rel', 'noopener noreferrer');
    expect(provisionLinks[0]).toHaveTextContent('Open the article');

    const actLink = screen.getByTestId('aflat-act-link');
    expect(actLink).toHaveAttribute('href', LABOUR_CODE.url);
    expect(actLink).toHaveTextContent('Open on legislatie.just.ro');
  });

  it('falls back to the official link as primary when there is no viewer url', () => {
    const act: TAflatSourceAct = {
      ...LABOUR_CODE,
      url: undefined,
      provisions: [{ ...PROVISION_A, viewer_url: undefined }],
    };
    render(<Sources sources={act.provisions} sourcesByAct={[act]} />);

    const link = screen.getByTestId('aflat-provision-link');
    expect(link).toHaveAttribute('href', PROVISION_A.url);
    expect(link).toHaveTextContent('Open the text of the law');
    expect(screen.queryByTestId('aflat-act-link')).not.toBeInTheDocument();
  });

  it('renders no anchor at all when a provision has neither link', () => {
    const act: TAflatSourceAct = {
      act_id: 999,
      act_title: 'Legea nr. 53/2003 — Codul muncii',
      cited: true,
      provisions: [{ ref: 'S1', entity_id: 'x', title: 'art. 75', in_force: true }],
    };
    render(<Sources sources={act.provisions} sourcesByAct={[act]} />);

    expect(cards()).toHaveLength(1);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByTestId('aflat-source-unlinked')).toHaveTextContent('no verified link');
  });

  it('never invents a link for an empty or unusable url', () => {
    const act: TAflatSourceAct = {
      act_id: 999,
      act_title: 'Legea nr. 53/2003 — Codul muncii',
      url: '   ',
      cited: true,
      provisions: [
        { ref: 'S1', entity_id: 'a', url: '', viewer_url: '' },
        { ref: 'S2', entity_id: 'b', url: '   ', viewer_url: '   ' },
        { ref: 'S3', entity_id: 'c', viewer_url: 'DetaliiDocument/307791#id_artA26_ttl' },
        { ref: 'S4', entity_id: 'd', url: 'javascript:alert(1)', viewer_url: 'javascript:void(0)' },
      ],
    };
    render(<Sources sources={act.provisions} sourcesByAct={[act]} />);

    expect(cards()).toHaveLength(1);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders a provision that arrived without a label or a breadcrumb', () => {
    render(<Sources sources={flat([AMENDING_ACT])} sourcesByAct={[AMENDING_ACT]} />);

    expect(screen.queryByTestId('aflat-provision-title')).not.toBeInTheDocument();
    expect(screen.queryByTestId('aflat-provision-path')).not.toBeInTheDocument();
    expect(screen.getByText('Text al ordonanței de modificare.')).toBeInTheDocument();
  });

  it('shows the provenance line retrieval returned', () => {
    render(<Sources sources={flat([LABOUR_CODE])} sourcesByAct={[LABOUR_CODE]} />);

    const why = screen.getAllByTestId('aflat-provision-why');
    expect(why).toHaveLength(2);
    expect(why[0]).toHaveTextContent('matched: concedier, preaviz');
  });

  it('never renders the degraded-retrieval marker as an error', () => {
    render(<Sources sources={flat([LABOUR_CODE])} sourcesByAct={[LABOUR_CODE]} />);

    expect(screen.getByTestId('aflat-sources')).not.toHaveTextContent('rerank_budget_exhausted');
  });

  it('marks a repealed act, and only that one', () => {
    render(
      <Sources
        sources={flat([LABOUR_CODE, REPEALED_ACT])}
        sourcesByAct={[LABOUR_CODE, REPEALED_ACT]}
      />,
    );

    expect(screen.getByTestId('aflat-act-repealed')).toHaveTextContent('repealed');
    expect(cards()[1]).toHaveTextContent('This text is no longer in force.');
    expect(cards()[0]).not.toHaveTextContent('This text is no longer in force.');
  });

  it('says an amending act amends rather than letting it pass for the base law', () => {
    render(<Sources sources={flat([AMENDING_ACT])} sourcesByAct={[AMENDING_ACT]} />);

    expect(screen.getByTestId('aflat-act-amending')).toHaveTextContent('amending act');
    expect(screen.getByTestId('aflat-act-amending-note')).toHaveTextContent(
      'This act amends another act.',
    );
  });

  it('keeps acts the answer did not lean on in a separate group', () => {
    render(
      <Sources
        sources={flat([LABOUR_CODE, AMENDING_ACT])}
        sourcesByAct={[LABOUR_CODE, AMENDING_ACT]}
      />,
    );

    const secondary = screen.getByTestId('aflat-sources-secondary');
    expect(secondary).toHaveTextContent('Other sources consulted');

    const secondaryCards = within(secondary).getAllByTestId('aflat-source-act-card');
    expect(secondaryCards).toHaveLength(1);
    expect(secondaryCards[0]).toHaveTextContent('ORDONANȚĂ DE URGENȚĂ nr. 93');

    expect(cards()).toHaveLength(2);
    expect(secondary).not.toHaveTextContent(CODE_TITLE);
  });

  it('shows every act rather than hiding them all when nothing is marked cited', () => {
    const uncited = [
      { ...LABOUR_CODE, cited: false },
      { ...AMENDING_ACT, cited: false },
    ];
    render(<Sources sources={flat(uncited)} sourcesByAct={uncited} />);

    expect(cards()).toHaveLength(2);
    expect(screen.queryByTestId('aflat-sources-secondary')).not.toBeInTheDocument();
  });

  it('renders the Romanian copy the product ships with', async () => {
    await i18n.changeLanguage('ro');
    try {
      render(
        <Sources
          sources={flat([REPEALED_ACT, AMENDING_ACT])}
          sourcesByAct={[REPEALED_ACT, AMENDING_ACT]}
        />,
      );

      expect(screen.getByTestId('aflat-sources')).toHaveTextContent('Surse din legislație');
      expect(screen.getByTestId('aflat-act-repealed')).toHaveTextContent('abrogat');
      expect(screen.getByTestId('aflat-sources')).toHaveTextContent(
        'Acest text nu mai este în vigoare.',
      );
      expect(screen.getByTestId('aflat-act-amending')).toHaveTextContent('act de modificare');
      expect(screen.getByTestId('aflat-act-amending-note')).toHaveTextContent(
        'Acest act modifică un alt act.',
      );
      expect(screen.getAllByTestId('aflat-provision-link')[0]).toHaveTextContent(
        'Deschide articolul',
      );
      expect(screen.getByTestId('aflat-sources-secondary')).toHaveTextContent(
        'Alte surse consultate',
      );
    } finally {
      await i18n.changeLanguage('en');
    }
  });
});

describe('Part → sources', () => {
  it('dispatches a sources content part, act grouping and all, to the citation boxes', () => {
    render(
      <Part
        part={{
          type: ContentTypes.SOURCES,
          sources: flat([LABOUR_CODE, AMENDING_ACT]),
          sources_by_act: [LABOUR_CODE, AMENDING_ACT],
        }}
        isSubmitting={false}
        showCursor={false}
        isCreatedByUser={false}
      />,
    );

    expect(screen.getByTestId('aflat-sources')).toBeInTheDocument();
    expect(cards()).toHaveLength(2);
    expect(screen.getByTestId('aflat-sources-secondary')).toBeInTheDocument();
  });

  it('renders nothing when the part carries no sources array', () => {
    const { container } = render(
      <Part
        part={{ type: ContentTypes.SOURCES } as never}
        isSubmitting={false}
        showCursor={false}
        isCreatedByUser={false}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
