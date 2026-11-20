import { describe, expect, it } from 'vitest';
import { brandForHost, brandMessages, withBrand } from './brand';
import de from './i18n/locales/de.json';
import en from './i18n/locales/en.json';

describe('brandForHost', () => {
  it('names Azumus on hosts containing azumus', () => {
    expect(brandForHost('azumus.ch')).toBe('Azumus');
    expect(brandForHost('app.AZUMUS.ch')).toBe('Azumus');
    expect(brandForHost('demo.azumus.ch:5173')).toBe('Azumus');
  });

  it('names Alleda everywhere else', () => {
    for (const host of ['alleda.ch', 'demo.alleda.ch', 'admin.jacwohlen.ch', 'localhost', '']) {
      expect(brandForHost(host)).toBe('Alleda');
    }
    expect(brandForHost(undefined)).toBe('Alleda');
  });
});

describe('withBrand', () => {
  it('replaces the name in sentences', () => {
    expect(withBrand('Willkommen bei Alleda', 'Azumus')).toBe('Willkommen bei Azumus');
    expect(withBrand('Zugang zu Alleda.', 'Azumus')).toBe('Zugang zu Azumus.');
    expect(withBrand('<title>Alleda API</title>', 'Azumus')).toBe('<title>Azumus API</title>');
    expect(withBrand('«Alleda», (Alleda)', 'Azumus')).toBe('«Azumus», (Azumus)');
  });

  it('keeps hosts, keys and file names', () => {
    const text = 'https://demo.alleda.ch Bearer alleda_x alleda-theme Alleda.ch Alleda_x';
    expect(withBrand(text, 'Azumus')).toBe(text);
  });

  it('leaves the default name alone', () => {
    expect(withBrand('Alleda', 'Alleda')).toBe('Alleda');
  });
});

describe('brandMessages', () => {
  it('names the other brand in every message, no Alleda left', () => {
    for (const messages of [de, en]) {
      const branded = JSON.stringify(brandMessages(messages, 'Azumus'));
      expect(branded).not.toMatch(/Alleda/);
      expect(branded).toMatch(/Azumus/);
    }
  });

  it('keeps the structure', () => {
    expect(brandMessages({ a: { b: 'Alleda' }, c: ['Alleda'], n: 1 }, 'Azumus')).toEqual({
      a: { b: 'Azumus' },
      c: ['Azumus'],
      n: 1
    });
  });
});
