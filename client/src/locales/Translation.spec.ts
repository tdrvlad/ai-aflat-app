import type { TranslationResource } from './i18n';
import {
  __resetLocaleForTests,
  __setLocaleLoaderForTests,
  changeLanguageSafely,
  detectInitialLanguage,
  ensureLocale,
  initializeI18n,
  normalizeLocale,
} from './i18n';
import English from './en/translation.json';
import Spanish from './es/translation.json';
import French from './fr/translation.json';
import Romanian from './ro/translation.json';
import { TranslationKeys } from '~/hooks';
import i18n from './i18n';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

describe('i18next translation tests', () => {
  // Ensure i18next is initialized before any tests run
  beforeAll(async () => {
    await initializeI18n();
  });

  afterEach(async () => {
    await changeLanguageSafely('en');
  });

  it('should return the correct translation for a valid key in English', async () => {
    await changeLanguageSafely('en');
    expect(i18n.t('com_ui_examples')).toBe(English.com_ui_examples);
  });

  it('should return the correct translation for a valid key in French', async () => {
    await changeLanguageSafely('fr');
    expect(i18n.t('com_ui_examples')).toBe(French.com_ui_examples);
  });

  it('should return the correct translation for a valid key in Spanish', async () => {
    await changeLanguageSafely('es');
    expect(i18n.t('com_ui_examples')).toBe(Spanish.com_ui_examples);
  });

  it('should fallback to Romanian for an invalid language code', async () => {
    // ai-aflat fork: an unresolvable locale falls back to 'ro' (the app default), not 'en'
    await changeLanguageSafely('invalid-code');
    expect(i18n.language).toBe('ro');
    expect(i18n.t('com_ui_examples')).toBe(Romanian.com_ui_examples);
  });

  it('should still fallback to English for keys missing from the Romanian catalog', async () => {
    // Keys we deliberately leave untranslated (disabled surfaces) resolve via fallbackLng: en
    await changeLanguageSafely('ro');
    expect(Romanian).not.toHaveProperty('com_agents_top_picks');
    expect(i18n.t('com_agents_top_picks')).toBe(English.com_agents_top_picks);
  });

  it('should return the key itself for an invalid key', async () => {
    await changeLanguageSafely('en');
    expect(i18n.t('invalid-key' as TranslationKeys)).toBe('invalid-key'); // Returns the key itself
  });

  it('should correctly format placeholders in the translation', async () => {
    await changeLanguageSafely('en');
    expect(i18n.t('com_endpoint_default_with_num', { 0: 'John' })).toBe('default: John');

    await changeLanguageSafely('fr');
    expect(i18n.t('com_endpoint_default_with_num', { 0: 'Marie' })).toBe('par défaut : Marie');
  });

  it('should normalize language selector values to locale files', () => {
    expect(normalizeLocale('en-US')).toBe('en');
    expect(normalizeLocale('de-DE')).toBe('de');
    expect(normalizeLocale('fr-FR')).toBe('fr');
    expect(normalizeLocale('ar-EG')).toBe('ar');
    expect(normalizeLocale('he-IL')).toBe('he');
    expect(normalizeLocale('nl-NL')).toBe('nl');
    expect(normalizeLocale('pl-PL')).toBe('pl');
    expect(normalizeLocale('uk-UA')).toBe('uk');
    expect(normalizeLocale('zh-Hans')).toBe('zh-Hans');
    expect(normalizeLocale('zh-Hant')).toBe('zh-Hant');
    expect(normalizeLocale('pt-BR')).toBe('pt-BR');
    expect(normalizeLocale('pt-PT')).toBe('pt-PT');
  });

  it('should reuse an in-flight locale load', async () => {
    __resetLocaleForTests('sv');
    const pendingLocale = deferred<{ default: TranslationResource }>();
    const loadLocale = jest.fn(() => pendingLocale.promise);
    const restoreLoader = __setLocaleLoaderForTests('sv', loadLocale);

    const firstLoad = ensureLocale('sv-SE');
    const secondLoad = ensureLocale('sv-SE');

    expect(loadLocale).toHaveBeenCalledTimes(1);

    pendingLocale.resolve({ default: { com_ui_examples: 'svenska exempel' } });

    await expect(Promise.all([firstLoad, secondLoad])).resolves.toEqual(['sv', 'sv']);
    expect(i18n.getResource('sv', 'translation', 'com_ui_examples')).toBe('svenska exempel');

    restoreLoader();
    __resetLocaleForTests('sv');
  });

  it('should retry a locale load after a transient failure', async () => {
    __resetLocaleForTests('ka');
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    let callCount = 0;
    const restoreLoader = __setLocaleLoaderForTests('ka', async () => {
      callCount += 1;
      if (callCount === 1) {
        throw new Error('temporary chunk failure');
      }

      return { default: { com_ui_examples: 'ქართული მაგალითები' } };
    });

    await expect(ensureLocale('ka-GE')).resolves.toBe('en');
    await expect(ensureLocale('ka-GE')).resolves.toBe('ka');

    expect(callCount).toBe(2);
    expect(i18n.getResource('ka', 'translation', 'com_ui_examples')).toBe('ქართული მაგალითები');

    restoreLoader();
    __resetLocaleForTests('ka');
    consoleErrorSpy.mockRestore();
  });

  it('should only apply the newest rapid language switch', async () => {
    __resetLocaleForTests('sv');
    __resetLocaleForTests('ka');
    __resetLocaleForTests('sl');

    const svLocale = deferred<{ default: TranslationResource }>();
    const kaLocale = deferred<{ default: TranslationResource }>();
    const slLocale = deferred<{ default: TranslationResource }>();
    const restoreSv = __setLocaleLoaderForTests('sv', () => svLocale.promise);
    const restoreKa = __setLocaleLoaderForTests('ka', () => kaLocale.promise);
    const restoreSl = __setLocaleLoaderForTests('sl', () => slLocale.promise);

    const firstSwitch = changeLanguageSafely('sv-SE');
    const secondSwitch = changeLanguageSafely('ka-GE');
    const latestSwitch = changeLanguageSafely('sl');

    svLocale.resolve({ default: { com_ui_examples: 'svenska exempel' } });
    await firstSwitch;
    expect(i18n.language).not.toBe('sv');

    kaLocale.resolve({ default: { com_ui_examples: 'ქართული მაგალითები' } });
    await secondSwitch;
    expect(i18n.language).not.toBe('ka');

    slLocale.resolve({ default: { com_ui_examples: 'slovenski primeri' } });
    await expect(latestSwitch).resolves.toBe('sl');
    expect(i18n.language).toBe('sl');
    expect(document.documentElement.lang).toBe('sl');

    restoreSv();
    restoreKa();
    restoreSl();
    __resetLocaleForTests('sv');
    __resetLocaleForTests('ka');
    __resetLocaleForTests('sl');
  });

  it('should restore the newest language if an older change finishes late', async () => {
    __resetLocaleForTests('sv');
    __resetLocaleForTests('sl');

    const svLocale = deferred<{ default: TranslationResource }>();
    const slLocale = deferred<{ default: TranslationResource }>();
    const restoreSv = __setLocaleLoaderForTests('sv', () => svLocale.promise);
    const restoreSl = __setLocaleLoaderForTests('sl', () => slLocale.promise);

    const firstSwitch = changeLanguageSafely('sv-SE');
    const latestSwitch = changeLanguageSafely('sl');

    slLocale.resolve({ default: { com_ui_examples: 'slovenski primeri' } });
    await expect(latestSwitch).resolves.toBe('sl');
    expect(i18n.language).toBe('sl');

    svLocale.resolve({ default: { com_ui_examples: 'svenska exempel' } });
    await firstSwitch;
    expect(i18n.language).toBe('sl');
    expect(document.documentElement.lang).toBe('sl');

    restoreSv();
    restoreSl();
    __resetLocaleForTests('sv');
    __resetLocaleForTests('sl');
  });
});

/**
 * ai-aflat fork: Romanian is the app's default language. Two independent code paths decide
 * what a visitor sees on first load, and BOTH must default to 'ro' — `detectInitialLanguage()`
 * in this module (consumed by `main.jsx` before first render) and the `lang` atom's seed in
 * `~/store/language.ts` (consumed by `LanguageSync` on mount). Upstream falls through to
 * `navigator.language` in both; if either one regresses, a visitor gets their browser's
 * language instead of Romanian, and the other path is not enough to save it.
 *
 * These guards exist because this exact behaviour was already silently broken once (`lng: 'ro'`
 * was set in `i18n.init` but never took effect, because detection overrode it before the first
 * render), and because both files are re-merged from upstream on a monthly cadence — the
 * precise vector that would quietly restore the `navigator.language` fallback.
 *
 * The lever that makes them bite: jsdom reports a non-Romanian `navigator.language`, so
 * upstream's behaviour resolves to a locale that is NOT 'ro'. The first test asserts that
 * precondition explicitly, so these guards fail loudly rather than silently passing for the
 * wrong reason if the test environment's language ever changes.
 */
describe('Romanian as the app default (upstream-merge regression guards)', () => {
  const clearExplicitLanguageChoice = () => {
    localStorage.removeItem('lang');
    document.cookie = 'lang=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  };

  afterEach(() => {
    clearExplicitLanguageChoice();
  });

  it('precondition: the test environment reports a non-Romanian browser language', () => {
    expect(normalizeLocale(navigator.language)).not.toBe('ro');
  });

  it('detectInitialLanguage() returns ro for a visitor with no explicit choice, ignoring the browser language', () => {
    clearExplicitLanguageChoice();

    // Restoring upstream's `|| getNavigatorLanguage()` fallback makes this return 'en' in jsdom.
    expect(detectInitialLanguage()).toBe('ro');
  });

  it('detectInitialLanguage() still honours an explicit language choice over the ro default', () => {
    localStorage.setItem('lang', JSON.stringify('en-US'));

    // Guards the opposite regression: hardcoding 'ro' and ignoring what the user picked.
    expect(detectInitialLanguage()).toBe('en');
  });

  it('the lang preference atom is seeded with ro for a visitor with no explicit choice, ignoring the browser language', () => {
    clearExplicitLanguageChoice();

    // The atom's default is computed at module load, so require it fresh with storage cleared.
    // recoil is required inside the isolated registry too, so the atom and the snapshot that
    // reads it come from the same instance.
    let seededLanguage: unknown;
    jest.isolateModules(() => {
      /* eslint-disable @typescript-eslint/no-require-imports -- isolateModules needs require */
      const { snapshot_UNSTABLE } = require('recoil');
      const languageStore = require('~/store/language').default;
      /* eslint-enable @typescript-eslint/no-require-imports */
      seededLanguage = snapshot_UNSTABLE().getLoadable(languageStore.lang).getValue();
    });

    // Restoring upstream's navigator-derived `defaultLang()` makes this 'en-US' in jsdom.
    expect(seededLanguage).toBe('ro');
  });
});
