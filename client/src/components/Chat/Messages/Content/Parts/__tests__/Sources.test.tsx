import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { ContentTypes } from 'librechat-data-provider';
import type { TAflatSource } from 'librechat-data-provider';
import i18n from '~/locales/i18n';
import Sources from '../Sources';
import Part from '../../Part';

/**
 * The citation boxes are where the product's hard invariant is either kept or
 * broken: every legal reference a user sees must trace to something retrieval
 * actually returned. These cases pin the parts that must never soften — no link
 * is ever invented for a source that arrived without one, a repealed article
 * says so, and sources the answer did not lean on stay out of the main group.
 *
 * Fixtures are in the shape of `docs/integration/2026-07-29-answer-event-envelope-PROPOSAL.md`.
 * Test language is pinned to `en` in `client/test/setupTests.js`, so assertions
 * use the English catalog values unless a test switches the language itself.
 */

const CITED: TAflatSource = {
  entity_id: 'art-26-307791',
  entity_type: 'article',
  title: 'Art. 26',
  act_title: 'Legea nr. 50/1991 privind autorizarea executării lucrărilor de construcții',
  snippet:
    'Constituie contravenții următoarele fapte, dacă nu au fost săvârșite în astfel de condiții încât să fie considerate infracțiuni.',
  url: 'https://legislatie.just.ro/Public/DetaliiDocument/307791#id_artA26_ttl',
  in_force: true,
  cited: true,
};

const REPEALED: TAflatSource = {
  entity_id: 'art-4-12345',
  entity_type: 'article',
  title: 'Art. 4',
  act_title: 'Legea nr. 12/1990 privind protejarea populației',
  snippet: 'Text care nu mai produce efecte.',
  url: 'https://legislatie.just.ro/Public/DetaliiDocument/12345#id_artA4_ttl',
  in_force: false,
  cited: true,
};

const NO_URL: TAflatSource = {
  entity_id: 'art-75-53107',
  entity_type: 'article',
  title: 'Art. 75',
  act_title: 'Legea nr. 53/2003 — Codul muncii',
  snippet: 'Persoanele concediate beneficiază de dreptul la un preaviz.',
  in_force: true,
  cited: true,
};

const UNCITED: TAflatSource = {
  entity_id: 'act-289032',
  entity_type: 'act',
  title: 'Art. 1',
  act_title: 'Ordonanța de urgență nr. 195/2002 privind circulația pe drumurile publice',
  snippet: 'Sursă returnată de căutare, pe care răspunsul nu s-a sprijinit.',
  url: 'https://legislatie.just.ro/Public/DetaliiDocument/289032#id_artA1_ttl',
  in_force: true,
  cited: false,
};

const boxes = () => screen.getAllByTestId('aflat-source-box');

describe('Sources', () => {
  it('renders one box per source', () => {
    render(<Sources sources={[CITED, REPEALED, NO_URL]} />);

    expect(boxes()).toHaveLength(3);
    expect(screen.getByText(CITED.act_title as string)).toBeInTheDocument();
    expect(screen.getByText('Art. 26')).toBeInTheDocument();
    expect(screen.getByText(CITED.snippet as string)).toBeInTheDocument();
  });

  it('renders nothing at all for an empty array', () => {
    const { container } = render(<Sources sources={[]} />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('aflat-sources')).not.toBeInTheDocument();
  });

  it('numbers the boxes so the answer text can reference them', () => {
    render(<Sources sources={[CITED, REPEALED, NO_URL]} />);

    const rendered = boxes();
    expect(rendered[0]).toHaveTextContent(/^1/);
    expect(rendered[1]).toHaveTextContent(/^2/);
    expect(rendered[2]).toHaveTextContent(/^3/);
  });

  it('links to the exact url retrieval returned, in a new tab', () => {
    render(<Sources sources={[CITED]} />);

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', CITED.url);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders no anchor when the source has no url', () => {
    render(<Sources sources={[NO_URL]} />);

    expect(boxes()).toHaveLength(1);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText(NO_URL.act_title as string)).toBeInTheDocument();
  });

  it('never invents a link for an empty or unusable url', () => {
    render(
      <Sources
        sources={[
          { ...NO_URL, url: '' },
          { ...NO_URL, entity_id: 'b', url: '   ' },
          { ...NO_URL, entity_id: 'c', url: 'DetaliiDocument/307791#id_artA26_ttl' },
          { ...NO_URL, entity_id: 'd', url: 'javascript:alert(1)' },
        ]}
      />,
    );

    expect(boxes()).toHaveLength(4);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('marks a repealed article, and only that one', () => {
    render(<Sources sources={[CITED, REPEALED]} />);

    const markers = screen.getAllByTestId('aflat-source-repealed');
    expect(markers).toHaveLength(1);
    expect(markers[0]).toHaveTextContent('repealed');
    expect(boxes()[1]).toContainElement(markers[0]);
    expect(boxes()[1]).toHaveTextContent('This text is no longer in force.');
    expect(boxes()[0]).not.toHaveTextContent('This text is no longer in force.');
  });

  it('keeps sources the answer did not lean on in a separate group', () => {
    render(<Sources sources={[CITED, UNCITED]} />);

    const secondary = screen.getByTestId('aflat-sources-secondary');
    expect(secondary).toHaveTextContent('Other sources consulted');

    const secondaryBoxes = within(secondary).getAllByTestId('aflat-source-box');
    expect(secondaryBoxes).toHaveLength(1);
    expect(secondaryBoxes[0]).toHaveTextContent(UNCITED.act_title as string);

    expect(boxes()).toHaveLength(2);
    expect(secondary).not.toHaveTextContent(CITED.act_title as string);
    /** numbering continues across the two groups */
    expect(secondaryBoxes[0]).toHaveTextContent(/^2/);
  });

  it('treats every source as cited when no item carries the flag', () => {
    const withoutFlag: TAflatSource[] = [CITED, NO_URL].map((source) => {
      const copy: TAflatSource = { ...source };
      delete copy.cited;
      return copy;
    });
    render(<Sources sources={withoutFlag} />);

    expect(boxes()).toHaveLength(2);
    expect(screen.queryByTestId('aflat-sources-secondary')).not.toBeInTheDocument();
  });

  it('renders the Romanian copy the product ships with', async () => {
    await i18n.changeLanguage('ro');
    try {
      render(<Sources sources={[REPEALED, UNCITED]} />);

      expect(screen.getByTestId('aflat-sources')).toHaveTextContent('Surse din legislație');
      expect(screen.getByTestId('aflat-source-repealed')).toHaveTextContent('abrogat');
      expect(screen.getByTestId('aflat-sources')).toHaveTextContent(
        'Acest text nu mai este în vigoare.',
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
  const renderPart = (sources: TAflatSource[]) =>
    render(
      <Part
        part={{ type: ContentTypes.SOURCES, sources }}
        isSubmitting={false}
        showCursor={false}
        isCreatedByUser={false}
      />,
    );

  it('dispatches a sources content part to the citation boxes', () => {
    renderPart([CITED, UNCITED]);

    expect(screen.getByTestId('aflat-sources')).toBeInTheDocument();
    expect(boxes()).toHaveLength(2);
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
