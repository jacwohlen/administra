import dayjs from 'dayjs';
import 'dayjs/locale/de';

/** dayjs has German and English loaded; every de-* locale (de-CH, de-DE…) uses German. */
export function dayjsLocaleFor(appLocale: string | null | undefined): 'de' | 'en' {
  return appLocale?.toLowerCase().startsWith('de') ? 'de' : 'en';
}

/** Sets dayjs' global locale (month and weekday names) for the app locale. */
export function applyDayjsLocale(appLocale: string | null | undefined): void {
  dayjs.locale(dayjsLocaleFor(appLocale));
}
