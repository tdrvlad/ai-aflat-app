import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ro from '~/locales/ro/translation.json';

/**
 * Romanian pluralisation for the wallet.
 *
 * Romanian has three plural forms, and the 20+ form additionally requires „de" —
 * „20 de întrebări", not „20 întrebări". A single `{{count}} întrebări` string
 * renders „1 întrebări" and „42 întrebări", both of which are simply wrong and
 * both of which appear on the balance chip the moment a real user has a balance.
 */
beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'ro',
    fallbackLng: 'ro',
    resources: { ro: { translation: ro } },
    interpolation: { escapeValue: false },
  });
});

describe('Romanian wallet pluralisation', () => {
  it.each([
    [1, 'o întrebare normală'],
    [2, '2 întrebări normale'],
    [10, '10 întrebări normale'],
    [19, '19 întrebări normale'],
    [20, '20 de întrebări normale'],
    [42, '42 de întrebări normale'],
  ])('renders %i correctly', (count, expected) => {
    expect(i18n.t('com_aflat_wallet_balance_hint', { count })).toBe(`≈ ${expected}`);
  });

  it('pluralises reserved credits, including the „de" form', () => {
    expect(i18n.t('com_aflat_wallet_reserved', { count: 1 })).toMatch(/^Un credit/);
    expect(i18n.t('com_aflat_wallet_reserved', { count: 5 })).toMatch(/^5 credite/);
    expect(i18n.t('com_aflat_wallet_reserved', { count: 30 })).toMatch(/^30 de credite/);
  });

  it('uses comma-below diacritics, never cedillas', () => {
    const walletCopy = Object.entries(ro as Record<string, string>)
      .filter(([key]) => key.startsWith('com_aflat_wallet') || key.startsWith('com_aflat_effort'))
      .map(([, value]) => value)
      .join(' ');

    /* ş U+015F and ţ U+0163 are the wrong characters for Romanian. */
    expect(walletCopy).not.toMatch(/[şţŞŢ]/);
  });
});
