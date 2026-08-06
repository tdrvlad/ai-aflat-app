import React from 'react';
import { render, screen } from 'test/layout-test-utils';
import AnonShell from '../AnonShell';

describe('AnonShell', () => {
  /**
   * Every anonymous visitor lands on the chat screen now, including an account
   * holder whose session expired on a bookmarked link — so sign-in has to be
   * reachable without walking the ask flow first. Pinned because losing it
   * silently dead-ends every returning user.
   */
  it('offers an existing account holder a way to sign in', () => {
    render(
      <AnonShell>
        <div />
      </AnonShell>,
    );

    const link = screen.getByTestId('aflat-signin-link');
    expect(link).toBeVisible();
    expect(link).toHaveTextContent(/sign in/i);
    expect(link).toHaveAttribute('href', '/login');
  });

  /**
   * There is no account, so there is nothing for these to describe. Their
   * absence is the only thing that distinguishes this shell from the signed-in
   * one, and it is what the redesign means by "same screen".
   */
  it('shows no balance chip and no account menu', () => {
    render(
      <AnonShell>
        <div />
      </AnonShell>,
    );

    expect(screen.queryByTestId('aflat-balance-chip')).not.toBeInTheDocument();
    expect(screen.queryByTestId('aflat-account-menu')).not.toBeInTheDocument();
  });
});
