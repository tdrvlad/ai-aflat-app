import React from 'react';
import { render, screen } from '@testing-library/react';
import i18n from '~/locales/i18n';
import Error from '../Error';

/**
 * `Error` is the fallback renderer for any error text that doesn't match a
 * `com_ui_error_connection` connection error: either a recognized LibreChat
 * `ErrorTypes`/`ViolationTypes` JSON payload, or — the common case for this
 * product's own orchestrator, which doesn't share that error vocabulary — a
 * plain string that falls through to the generic wrapper. That wrapper used
 * to be a hardcoded English sentence; it's now `com_aflat_error_generic_details`,
 * localized like every other user-facing string in the product.
 */
describe('Error', () => {
  it('wraps a plain (non-JSON) error string in the localized generic wrapper', () => {
    render(<Error text="orchestrator_unavailable" />);

    expect(
      screen.getByText('Something went wrong. Technical detail: orchestrator_unavailable'),
    ).toBeInTheDocument();
  });

  it('renders the Romanian wrapper when the app language is Romanian', async () => {
    await i18n.changeLanguage('ro');
    try {
      render(<Error text="orchestrator_unavailable" />);
      expect(
        screen.getByText('Ceva nu a mers bine. Detaliu tehnic: orchestrator_unavailable'),
      ).toBeInTheDocument();
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  it('still resolves a recognized error code to its own localized message, not the generic wrapper', () => {
    render(<Error text={JSON.stringify({ code: 'no_user_key' })} />);

    expect(
      screen.getByText('No key found. Please provide a key and try again.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Technical detail/)).not.toBeInTheDocument();
  });
});
