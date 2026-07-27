import { atom } from 'recoil';
import Cookies from 'js-cookie';
import { atomWithLocalStorage } from './utils';

const readStoredLang = () => {
  if (typeof localStorage === 'undefined') {
    return undefined;
  }

  const storedLang = localStorage.getItem('lang');
  if (!storedLang) {
    return undefined;
  }

  try {
    const parsedLang = JSON.parse(storedLang);
    return typeof parsedLang === 'string' ? parsedLang : storedLang;
  } catch {
    return storedLang;
  }
};

// ai-aflat fork: upstream seeds this atom from `navigator.language`, which would make
// LanguageSync switch a first-time visitor back to their browser language right after
// `detectInitialLanguage()` settled on Romanian. Both paths must agree, so the no-explicit-
// choice default is 'ro' here too. Users can still pick any language (including 'auto',
// which resolves to the browser language) from Settings; the choice persists in localStorage.
const defaultLang = () => Cookies.get('lang') || readStoredLang() || 'ro';

const lang = atomWithLocalStorage('lang', defaultLang());
const languageLoading = atom<boolean>({
  key: 'languageLoading',
  default: false,
});

export default { lang, languageLoading };
