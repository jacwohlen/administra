/**
 * The product's name, by the address the app is reached at: Azumus on a host
 * whose name contains "azumus" (e.g. azumus.ch, app.azumus.ch), Alleda
 * everywhere else (alleda.ch, demo.alleda.ch, club instances, localhost).
 * The logo is the same for both. The texts say "Alleda"; `withBrand()`
 * puts the other name in, in the browser for the locale files (i18n/index.ts),
 * on the server for the rendered page (hooks.server.ts), and in the PWA
 * manifest (routes/manifest.webmanifest). See docs/BRANDS.md.
 */
export const DEFAULT_BRAND = 'Alleda';

/** Hosts (lower case) containing `match` show `name`; the first match wins */
export const BRANDS: readonly { match: string; name: string }[] = [
  { match: 'azumus', name: 'Azumus' }
];

/** The name shown on this host (a hostname, or a host with port) */
export function brandForHost(host: string | null | undefined): string {
  const h = (host ?? '').toLowerCase();
  return BRANDS.find((b) => h.includes(b.match))?.name ?? DEFAULT_BRAND;
}

// "Alleda" as a word with a capital A, not part of a host, file or key name
// (Alleda.ch, Alleda-Logo, Alleda_…); hosts are lower case anyway
const NAME = /\bAlleda\b(?![-_]|\.[a-z])/g;

/** A text with the default name replaced by `brand` */
export function withBrand(text: string, brand: string): string {
  return brand === DEFAULT_BRAND ? text : text.replace(NAME, brand);
}

/** Every string of a (nested) locale dictionary through withBrand() */
export function brandMessages<T>(messages: T, brand: string): T {
  if (brand === DEFAULT_BRAND) return messages;
  if (typeof messages === 'string') return withBrand(messages, brand) as T;
  if (Array.isArray(messages)) return messages.map((m) => brandMessages(m, brand)) as T;
  if (messages && typeof messages === 'object') {
    return Object.fromEntries(
      Object.entries(messages).map(([k, v]) => [k, brandMessages(v, brand)])
    ) as T;
  }
  return messages;
}
