import React from 'react';
import { render, screen } from '@testing-library/react';
import type { TMessage } from 'librechat-data-provider';
import i18n from '~/locales/i18n';
import { ErrorMessage, UnfinishedMessage } from '../MessageContent';

/**
 * Pânza hazard (see FORK-NOTES.md, "the standing hazard that matters most
 * here"): a Tailwind class that reaches a semantic token has to be checked by
 * computed color, not by class name alone. These error surfaces used to carry
 * raw `red-*` utility classes instead of the destructive semantic tokens the
 * rest of the app uses, and the "incomplete response" notice was a hardcoded
 * English sentence with no Romanian rendering at all. Both are pinned here.
 */
const baseMessage = { messageId: 'm1' } as TMessage;

describe('ErrorMessage', () => {
  it('renders the generic error box on the destructive semantic tokens, not a raw red', () => {
    render(<ErrorMessage text="orchestrator_unavailable" message={baseMessage} />);

    const box = screen.getByRole('alert');
    expect(box).toHaveClass('border-border-destructive');
    expect(box).toHaveClass('bg-surface-secondary');
    expect(box).toHaveClass('text-text-destructive');
    expect(box.className).not.toMatch(/red-\d/);
  });
});

describe('UnfinishedMessage', () => {
  it('renders the localized incomplete-response text, not the old hardcoded English sentence', () => {
    render(<UnfinishedMessage message={baseMessage} />);

    expect(
      screen.getByText(
        'The response is incomplete — it may still be generating, or it was stopped or blocked by a filter. Refresh the page or try again.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/is either still processing, was cancelled, or censored/),
    ).not.toBeInTheDocument();
  });

  it('renders in Romanian when the app language is Romanian', async () => {
    await i18n.changeLanguage('ro');
    try {
      render(<UnfinishedMessage message={baseMessage} />);
      expect(
        screen.getByText(
          'Răspunsul e incomplet — fie încă se generează, fie a fost oprit sau blocat de un filtru. Reîmprospătează pagina sau încearcă din nou.',
        ),
      ).toBeInTheDocument();
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  it('uses the same destructive-token error box as the generic error, not the raw Error/JSON wrapper', () => {
    render(<UnfinishedMessage message={baseMessage} />);

    const box = screen.getByRole('alert');
    expect(box).toHaveClass('border-border-destructive');
    expect(box).toHaveClass('bg-surface-secondary');
    expect(box).toHaveClass('text-text-destructive');
    expect(screen.queryByText(/Technical detail/)).not.toBeInTheDocument();
  });
});
