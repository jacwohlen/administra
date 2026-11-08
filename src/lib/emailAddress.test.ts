import { describe, expect, it } from 'vitest';
import { emailDomain, isValidEmail, suggestEmail } from './emailAddress';

describe('isValidEmail', () => {
  it.each([
    'lara.meier@example.com',
    ' lara@bluewin.ch ',
    'first+tag@sub.example.co.uk',
    'jürg@müller.ch',
    'info@xn--mller-kva.ch',
    'info@ch.ch'
  ])('accepts %s', (email) => expect(isValidEmail(email)).toBe(true));

  it.each([
    '',
    'lara',
    'lara@',
    '@example.com',
    'lara@gmail',
    'lara@gmail.',
    'lara@gmail..com',
    'lara@.gmail.com',
    'lara@-gmail.com',
    'lara.@gmail.com',
    'la..ra@gmail.com',
    'lara meier@gmail.com',
    'lara@gmail .com',
    'lara@@gmail.com',
    'lara@gmail.c',
    'lara@gmail.c0m',
    'lara,meier@gmail.com',
    'rolli@bluewin.ch.ch',
    'lara@gmail.com.com',
    `${'a'.repeat(65)}@example.com`
  ])('refuses %s', (email) => expect(isValidEmail(email)).toBe(false));
});

describe('emailDomain', () => {
  it('returns the lower-case domain of a valid address', () => {
    expect(emailDomain('Lara@Bluewin.CH')).toBe('bluewin.ch');
    expect(emailDomain('lara@gmail')).toBeNull();
  });
});

describe('suggestEmail', () => {
  it.each([
    ['lara@gmial.com', 'lara@gmail.com'],
    ['lara@gmail.con', 'lara@gmail.com'],
    ['rolli@bluewin.ch.ch', 'rolli@bluewin.ch'],
    ['lara@gmail.com.com', 'lara@gmail.com'],
    ['lara@jacwohlen.ch.ch', 'lara@jacwohlen.ch'],
    ['lara@gmial.com.com', 'lara@gmail.com'],
    ['lara@gmail.co', 'lara@gmail.com'],
    ['lara@gmail.ch', 'lara@gmail.com'],
    ['lara@bluwin.ch', 'lara@bluewin.ch'],
    ['lara@bluewin.com', 'lara@bluewin.ch'],
    ['lara@hotmial.com', 'lara@hotmail.com'],
    ['lara@gmx.cg', 'lara@gmx.ch'],
    ['Lara.Meier@Outlok.com', 'Lara.Meier@outlook.com']
  ])('suggests a fix for %s', (email, suggestion) => expect(suggestEmail(email)).toBe(suggestion));

  it.each(['lara@gmail.com', 'lara@hotmail.de', 'lara@jacwohlen.ch', 'lara@example.com', 'lara'])(
    'leaves %s alone',
    (email) => expect(suggestEmail(email)).toBeNull()
  );
});
