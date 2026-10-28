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

describe.each(pages)('$name', ({ html, doc }) => {
  it('has the basics: language, title, viewport, one h1', () => {
    expect(doc.documentElement.lang).toBe('de-CH');
    expect(doc.title.length).toBeGreaterThan(10);
    expect(doc.querySelector('meta[name="viewport"]')).not.toBeNull();
    expect(doc.querySelectorAll('h1')).toHaveLength(1);
  });

  it('loads no scripts and nothing from other origins', () => {
    expect(doc.querySelectorAll('script')).toHaveLength(0);
    for (const el of doc.querySelectorAll('link[href], img[src]')) {
      const url = el.getAttribute('href') ?? el.getAttribute('src');
      if (el.getAttribute('rel') === 'canonical') continue;
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
        expect(url, url).toMatch(/^https:\/\/(app\.)?administra\.ch(\/|$)/);
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

describe('contact form', () => {
  const doc = pages.find((p) => p.name === 'index.html').doc;
  const form = doc.querySelector('form[name="kontakt"]');

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

  it('sends a strict CSP without scripts or inline styles', () => {
    const csp = /Content-Security-Policy = "([^"]+)"/.exec(toml)[1];
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain('script-src');
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).toContain("form-action 'self'");
  });

  it('uses no inline style attributes the CSP would block', () => {
    for (const { name, doc } of pages) {
      expect(doc.querySelectorAll('[style]'), name).toHaveLength(0);
    }
  });
});
