/* This file is automatically executed before running tests
 * https://create-react-app.dev/docs/running-tests/#initializing-test-environment
 */

// react-testing-library renders your components to document.body,
// this adds jest-dom's custom assertions
// https://github.com/testing-library/jest-dom#table-of-contents
import '@testing-library/jest-dom';

// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom/extend-expect';

// Mock canvas when run unit test cases with jest.
// 'react-lottie' uses canvas
import 'jest-canvas-mock';

// Mock ResizeObserver
import './resizeObserver.mock';

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(), // deprecated
    removeListener: jest.fn(), // deprecated
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

beforeEach(() => {
  jest.clearAllMocks();
});

// Mock window.matchMedia for tests
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(), // deprecated
    removeListener: jest.fn(), // deprecated
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

jest.mock('react-i18next', () => {
  const actual = jest.requireActual('react-i18next');
  return {
    ...actual,
    useTranslation: () => {
      const i18n = require('~/locales/i18n').default;
      return {
        t: (key, options) => i18n.t(key, options),
        i18n: {
          ...i18n,
          changeLanguage: jest.fn(),
        },
      };
    },
    initReactI18next: {
      type: '3rdParty',
      init: jest.fn(),
    },
  };
});

// ai-aflat fork: the app ships Romanian as its default language (`lng: 'ro'` in
// src/locales/i18n.ts), but upstream's component specs assert the English UI strings.
// Pin the language back to 'en' for the test run so those specs keep passing unmodified
// and keep merging cleanly from upstream. Romanian coverage — the catalog itself and the
// default-language behaviour — lives in src/locales/Translation.spec.ts, which sets the
// language explicitly in every test and is therefore unaffected by this pin.
beforeAll(async () => {
  try {
    await require('~/locales/i18n').default.changeLanguage('en');
  } catch {
    // Specs that replace the whole `react-i18next` module with a bare stub (e.g.
    // src/components/Agents/tests/Accessibility.spec.tsx) supply their own localize mock
    // and never touch the real i18n instance — initializing it here would throw on their
    // stub. There is nothing to pin in that case, so ignore it.
  }
});
