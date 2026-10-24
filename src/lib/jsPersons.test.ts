import { describe, it, expect } from 'vitest';
import { PERSON_HEADER } from './jsExport';
import {
  findField,
  normalizeAhv,
  normalizeCountry,
  normalizeGender,
  normalizeLanguage,
  normalizeNationality,
  personRow,
  splitStreet
} from './jsPersons';

describe('field lookup', () => {
  it('ignores case, umlauts and punctuation', () => {
    expect(findField({ 'AHV-Nr.': '756' }, ['ahvnr'])).toBe('756');
    expect(findField({ Nationalität: 'CH' }, ['nationalitat'])).toBe('CH');
    expect(findField({ Lizenznummer: 266750 }, ['lizenznummer'])).toBe('266750');
    expect(findField({}, ['ort'])).toBe('');
  });
});

describe('normalizers', () => {
  it('maps gender, falling back to the salutation', () => {
    expect(normalizeGender('männlich')).toBe('m');
    expect(normalizeGender('W')).toBe('w');
    expect(normalizeGender('', 'Frau')).toBe('w');
    expect(normalizeGender('')).toBe('');
  });

  it('maps nationality and mother tongue to the NDS values', () => {
    expect(normalizeNationality('Schweiz')).toBe('CH');
    expect(normalizeNationality('Liechtenstein')).toBe('FL');
    expect(normalizeNationality('Italien')).toBe('Andere');
    expect(normalizeLanguage('Deutsch')).toBe('DE');
    expect(normalizeLanguage('Französisch')).toBe('FR');
    expect(normalizeLanguage('Spanisch')).toBe('Andere');
  });

  it('maps countries to ISO codes, empty as Switzerland', () => {
    expect(normalizeCountry('')).toBe('CH');
    expect(normalizeCountry('de')).toBe('DE');
    expect(normalizeCountry('Österreich')).toBe('AT');
    expect(normalizeCountry('Atlantis')).toBe('');
  });

  it('formats AHV numbers', () => {
    expect(normalizeAhv('7561234567897')).toBe('756.1234.5678.97');
    expect(normalizeAhv('756.1234.5678.97')).toBe('756.1234.5678.97');
  });

  it('splits house numbers off the street', () => {
    expect(splitStreet('Blumenweg 14a')).toEqual(['Blumenweg', '14a']);
    expect(splitStreet('Bahnhofstrasse')).toEqual(['Bahnhofstrasse', '']);
  });
});

describe('personRow', () => {
  it('builds a complete row in template order', () => {
    const { row, missing } = personRow({
      Name: 'Muster',
      Vorname: 'Arti',
      Geburtstag: '2014-05-10',
      Geschlecht: 'm',
      'AHV-Nummer': '7561234567897',
      Nationalität: 'Schweiz',
      Muttersprache: 'Deutsch',
      Strasse: 'Blumenweg 14',
      PLZ: '4512',
      Ort: 'Bellach',
      Lizenznummer: 266750
    });
    expect(Object.fromEntries(PERSON_HEADER.map((h, i) => [h, row[i]]))).toEqual({
      PERSONENNUMMER: '266750',
      NAME: 'Muster',
      VORNAME: 'Arti',
      GEBURTSDATUM: '10.05.2014',
      GESCHLECHT: 'm',
      AHV_NR: '756.1234.5678.97',
      PEID: '',
      NATIONALITAET: 'CH',
      MUTTERSPRACHE: 'DE',
      STRASSE: 'Blumenweg',
      HAUSNUMMER: '14',
      PLZ: '4512',
      ORT: 'Bellach',
      LAND: 'CH'
    });
    expect(missing).toEqual([]);
  });

  it('reports missing required fields', () => {
    const { missing } = personRow({ Name: 'Muster', Vorname: 'Arti', Geburtstag: '2014-05-10' });
    expect(missing).toEqual([
      'GESCHLECHT',
      'NATIONALITAET',
      'MUTTERSPRACHE',
      'PLZ',
      'ORT',
      'AHV_NR'
    ]);
  });
});
