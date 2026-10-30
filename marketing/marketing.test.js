// Static checks for the marketing site (marketing/public): no build step
// exists, so these tests are what keeps links, the contact form, the brand
// files and the legal placeholders honest. Runs with the app's Vitest.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findPlaceholders } from './check-placeholders.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, 'public');
const repoRoot = path.join(here, '..');

function htmlFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return htmlFiles(full);
    return entry.name.endsWith('.html') ? [full] : [];
  });
}

const pages = htmlFiles(publicDir).map((file) => ({
  name: path.relative(publicDir, file),
  html: readFileSync(file, 'utf8'),
  doc: new DOMParser().parseFromString(readFileSync(file, 'utf8'), 'text/html')
}));

/** The file a site-relative URL is served from, or null for other origins. */
function targetFile(url) {
  if (!url.startsWith('/')) return null;
  const [pathname] = url.split(/[?#]/);
  const local = path.join(publicDir, pathname);
  return pathname.endsWith('/') ? path.join(local, 'index.html') : local;
}

describe('brand files', () => {
  it('tokens.css is an exact copy of static/brand/tokens.css', () => {
    expect(readFileSync(path.join(publicDir, 'assets/tokens.css'), 'utf8')).toBe(
      readFileSync(path.join(repoRoot, 'static/brand/tokens.css'), 'utf8')
    );
  });

  it('the logo is the brand logo', () => {
    for (const ext of ['svg', 'png']) {
      expect(readFileSync(path.join(publicDir, `assets/administra-logo.${ext}`))).toEqual(
        readFileSync(path.join(repoRoot, `static/brand/logo/administra-logo.${ext}`))
      );
    }
  });
});

describe.each(pages)('$name', ({ name, html, doc }) => {
  it('has the basics: language, title, viewport, one h1', () => {
    expect(doc.documentElement.lang).toBe(name.startsWith('en/') ? 'en' : 'de-CH');
    expect(doc.title.length).toBeGreaterThan(10);
    expect(doc.querySelector('meta[name="viewport"]')).not.toBeNull();
    expect(doc.querySelectorAll('h1')).toHaveLength(1);
  });

  it('loads only its own scripts and nothing from other origins', () => {
    const scripts = [...doc.querySelectorAll('script')];
    for (const script of scripts) expect(script.textContent.trim(), name).toBe('');
    // The light/dark switch in <head>, so a saved choice applies before the
    // first paint; the presence grid (home pages only) after parsing
    const sources = scripts.map((s) => s.getAttribute('src'));
    const home = ['index.html', 'en/index.html'].includes(name);
    expect(sources).toEqual(
      home ? ['/assets/theme.js', '/assets/presence.js'] : ['/assets/theme.js']
    );
    expect(scripts[0].parentElement.tagName).toBe('HEAD');
    expect(scripts[0].hasAttribute('defer')).toBe(false);
    if (home) expect(scripts[1].hasAttribute('defer')).toBe(true);
    for (const el of doc.querySelectorAll('link[href], img[src]')) {
      const url = el.getAttribute('href') ?? el.getAttribute('src');
      // Search engines want absolute URLs for these two
      if (['canonical', 'alternate'].includes(el.getAttribute('rel') ?? '')) continue;
      expect(url, url).toMatch(/^\//);
    }
  });

  it('links only to files that exist and anchors that exist', () => {
    for (const el of doc.querySelectorAll('a[href], link[href], img[src], form[action]')) {
      const url = el.getAttribute('href') ?? el.getAttribute('src') ?? el.getAttribute('action');
      if (url.startsWith('#')) {
        if (url.length > 1) expect(doc.getElementById(url.slice(1)), url).not.toBeNull();
        continue;
      }
      const file = targetFile(url);
      if (!file) {
        expect(url, url).toMatch(
          /^(https:\/\/(demo\.)?adsumus\.ch(\/|$)|mailto:kontakt@adsumus\.ch$)/
        );
        continue;
      }
      // Screenshots are generated separately (scripts/marketing-screenshots.mjs)
      expect(existsSync(file), `${url} → ${path.relative(publicDir, file)}`).toBe(true);
      const anchor = url.split('#')[1];
      if (anchor) {
        const target = new DOMParser().parseFromString(readFileSync(file, 'utf8'), 'text/html');
        expect(target.getElementById(anchor), url).not.toBeNull();
      }
    }
  });

  it('describes every image and reserves its space', () => {
    for (const img of doc.querySelectorAll('img')) {
      expect(img.hasAttribute('alt'), img.outerHTML).toBe(true);
      expect(img.getAttribute('width'), img.outerHTML).toMatch(/^\d+$/);
      expect(img.getAttribute('height'), img.outerHTML).toMatch(/^\d+$/);
    }
  });

  it('uses Swiss spelling (no ß)', () => {
    expect(doc.body.textContent).not.toContain('ß');
  });

  it('uses the ellipsis character, never three dots', () => {
    expect(html).not.toMatch(/[^.]\.\.\.[^.]/);
  });
});

// One Netlify form (detected at deploy time) on both home pages: same name and
// fields, so submissions from either language land in the same list
const fieldNames = (form) =>
  [...new Set([...form.querySelectorAll('[name]')].map((el) => el.getAttribute('name')))].sort();

describe.each([
  { page: 'index.html', lang: 'de', thanks: '/danke/' },
  { page: 'en/index.html', lang: 'en', thanks: '/en/thanks/' }
])('contact form on $page', ({ page, lang, thanks }) => {
  const doc = pages.find((p) => p.name === page).doc;
  const form = doc.querySelector('form[name="kontakt"]');

  it('has the same fields in both languages and says which one it came from', () => {
    const german = pages.find((p) => p.name === 'index.html').doc;
    expect(fieldNames(form)).toEqual(fieldNames(german.querySelector('form[name="kontakt"]')));
    expect(form.querySelector('input[name="sprache"]').getAttribute('value')).toBe(lang);
    expect(form.getAttribute('action')).toBe(thanks);
  });

  it('is a Netlify form with a honeypot that posts to the thank-you page', () => {
    expect(form.getAttribute('data-netlify')).toBe('true');
    expect(form.getAttribute('method')).toBe('POST');
    expect(form.querySelector('input[name="form-name"]').getAttribute('value')).toBe('kontakt');
    const honeypot = form.getAttribute('netlify-honeypot');
    expect(form.querySelector(`input[name="${honeypot}"]`)).not.toBeNull();
    expect(existsSync(targetFile(form.getAttribute('action')))).toBe(true);
  });

  it('labels every field', () => {
    for (const field of form.querySelectorAll('input:not([type=hidden]), select, textarea')) {
      if (field.closest('.honeypot')) continue;
      const labelled =
        field.closest('label') || (field.id && form.querySelector(`label[for="${field.id}"]`));
      expect(labelled, field.outerHTML).toBeTruthy();
    }
  });
});

describe('languages', () => {
  const german = pages.find((p) => p.name === 'index.html').doc;
  const english = pages.find((p) => p.name === 'en/index.html').doc;
  const alternates = (doc) =>
    Object.fromEntries(
      [...doc.querySelectorAll('link[rel="alternate"][hreflang]')].map((l) => [
        l.getAttribute('hreflang'),
        l.getAttribute('href')
      ])
    );

  it('both home pages name each other as alternates', () => {
    const expected = {
      de: 'https://adsumus.ch/',
      en: 'https://adsumus.ch/en/',
      'x-default': 'https://adsumus.ch/'
    };
    expect(alternates(german)).toEqual(expected);
    expect(alternates(english)).toEqual(expected);
  });

  it('every page switches to the other language', () => {
    for (const { name, doc } of pages) {
      if (name === '404.html') continue; // one page in both languages
      const other = name.startsWith('en/') ? 'de' : 'en';
      const link = doc.querySelector('.lang-switch');
      expect(link, name).not.toBeNull();
      expect(link.getAttribute('hreflang'), name).toBe(other);
      expect(link.getAttribute('lang'), name).toBe(other);
    }
  });

  it('the English home page shows the same screenshots, taken in English', () => {
    const shots = (doc) =>
      [...doc.querySelectorAll('img[src^="/img/"]')].map((i) => i.getAttribute('src'));
    expect(shots(english)).toEqual(shots(german).map((src) => src.replace('/img/', '/img/en/')));
  });
});

describe('light/dark switch', () => {
  it('is on every page, labelled in the page language', () => {
    for (const { name, doc } of pages) {
      const button = doc.querySelector('button.theme-toggle');
      expect(button, name).not.toBeNull();
      expect(button.getAttribute('type'), name).toBe('button');
      expect(button.getAttribute('aria-pressed'), name).toBe('false');
      expect(button.getAttribute('aria-label'), name).toBe(
        name.startsWith('en/') ? 'Dark mode' : 'Dunkler Modus'
      );
    }
  });

  it('is hidden without JavaScript and dark mode works both ways', () => {
    const css = readFileSync(path.join(publicDir, 'assets/site.css'), 'utf8');
    expect(css).toMatch(/\.theme-toggle \{\s*display: none;/);
    expect(css).toContain(':root:not(.light)');
    expect(css).toContain(':root.dark');
  });
});

describe.each(['index.html', 'en/index.html'])('presence grid on %s', (page) => {
  const doc = pages.find((p) => p.name === page).doc;
  const hero = doc.querySelector('.hero');

  it('is a decorative canvas behind the hero, with the text it keeps clear of', () => {
    const canvas = hero.querySelector(':scope > canvas[data-presence]');
    expect(canvas).not.toBeNull();
    expect(canvas.getAttribute('aria-hidden')).toBe('true');
    const text = hero.querySelector('[data-presence-text]');
    expect(text).not.toBeNull();
    expect(text.querySelector('h1')).not.toBeNull();
  });
});

describe('placeholders', () => {
  it('exist only on the legal pages', () => {
    const files = new Set(findPlaceholders(publicDir).map((p) => p.file));
    for (const file of files) {
      expect(['impressum/index.html', 'datenschutz/index.html']).toContain(file);
    }
  });
});

describe('netlify.toml', () => {
  const toml = readFileSync(path.join(here, 'netlify.toml'), 'utf8');

  it('sends a strict CSP: own scripts only, no inline scripts or styles', () => {
    const csp = /Content-Security-Policy = "([^"]+)"/.exec(toml)[1];
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("form-action 'self'");
  });

  it('uses no inline style attributes the CSP would block', () => {
    for (const { name, doc } of pages) {
      expect(doc.querySelectorAll('[style]'), name).toHaveLength(0);
    }
  });
});
