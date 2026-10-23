/**
 * Rows of the J+S person import (person_JA_DE.csv) from Webling members.
 *
 * Webling's field names differ between clubs and fields get added over time
 * (gender, nationality, mother tongue), so fields are looked up by a few
 * likely names, ignoring case, umlauts and punctuation: "AHV-Nr." matches
 * "ahvnr". Values are normalized to what the NDS accepts.
 */

import { PERSON_HEADER } from './jsExport';

type Properties = Record<string, unknown>;

/** Lookup names per NDS column, compared after normalizeKey(). */
export const WEBLING_FIELDS = {
  personNumber: ['lizenznummer', 'jspersonennummer', 'personennummer'],
  lastname: ['name', 'nachname'],
  firstname: ['vorname'],
  birthday: ['geburtstag', 'geburtsdatum'],
  gender: ['geschlecht'],
  salutation: ['anrede'],
  ahv: ['ahvnummer', 'ahvnr', 'ahv', 'ahvn13', 'sozialversicherungsnummer', 'svnummer'],
  peid: ['peid'],
  nationality: ['nationalitat', 'nationalitaet', 'staatsangehorigkeit', 'nationality'],
  motherTongue: ['muttersprache', 'sprache'],
  street: ['strasse', 'adresse', 'strassenr'],
  houseNumber: ['hausnummer', 'hausnr'],
  zip: ['plz', 'postleitzahl'],
  city: ['ort', 'wohnort'],
  country: ['land']
} as const;

export function normalizeKey(key: string): string {
  return key
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(', ');
  return String(value).trim();
}

/** The value of the first property whose name matches one of `names`. */
export function findField(properties: Properties, names: readonly string[]): string {
  const byKey = new Map(Object.entries(properties).map(([k, v]) => [normalizeKey(k), v]));
  for (const name of names) {
    const value = text(byKey.get(name));
    if (value) return value;
  }
  return '';
}

const word = (value: string) => normalizeKey(value);

export function normalizeGender(gender: string, salutation = ''): string {
  for (const value of [gender, salutation]) {
    const w = word(value);
    if (['m', 'mannlich', 'mann', 'male', 'herr', 'knabe'].includes(w)) return 'm';
    if (['w', 'f', 'weiblich', 'frau', 'female', 'madchen'].includes(w)) return 'w';
  }
  return '';
}

/** NDS: CH, FL or Andere. */
export function normalizeNationality(value: string): string {
  const w = word(value);
  if (!w) return '';
  if (['ch', 'schweiz', 'schweizer', 'schweizerin', 'suisse', 'svizzera', 'swiss'].includes(w))
    return 'CH';
  if (['fl', 'li', 'liechtenstein', 'liechtensteiner', 'liechtensteinerin'].includes(w))
    return 'FL';
  return 'Andere';
}

/** NDS: DE, FR, IT or Andere. */
export function normalizeLanguage(value: string): string {
  const w = word(value);
  if (!w) return '';
  if (['de', 'deutsch', 'schweizerdeutsch', 'german'].includes(w)) return 'DE';
  if (['fr', 'franzosisch', 'francais', 'french'].includes(w)) return 'FR';
  if (['it', 'italienisch', 'italiano', 'italian'].includes(w)) return 'IT';
  return 'Andere';
}

const COUNTRIES: Record<string, string> = {
  schweiz: 'CH',
  suisse: 'CH',
  svizzera: 'CH',
  switzerland: 'CH',
  liechtenstein: 'LI',
  deutschland: 'DE',
  frankreich: 'FR',
  italien: 'IT',
  osterreich: 'AT'
};

/** ISO 3166 alpha-2. Empty means Switzerland: Webling leaves it out for most members. */
export function normalizeCountry(value: string): string {
  const w = word(value);
  if (!w) return 'CH';
  if (/^[a-z]{2}$/.test(w)) return w.toUpperCase();
  return COUNTRIES[w] ?? '';
}

/** '7561234567897' → '756.1234.5678.97'; anything else is passed on unchanged. */
export function normalizeAhv(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (/^756\d{10}$/.test(digits)) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 7)}.${digits.slice(7, 11)}.${digits.slice(11)}`;
  }
  return value;
}

/** '2012-05-10' → '10.05.2012'; 'DD.MM.YYYY' stays. */
export function normalizeBirthday(value: string): string {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso) return `${iso[3]}.${iso[2]}.${iso[1]}`;
  return /^\d{2}\.\d{2}\.\d{4}$/.test(value) ? value : '';
}

/** 'Blumenweg 14a' → ['Blumenweg', '14a']. */
export function splitStreet(street: string): [string, string] {
  const match = /^(.*\S)\s+(\d+\s?[a-zA-Z]?)$/.exec(street.trim());
  return match ? [match[1], match[2].replace(/\s/g, '')] : [street.trim(), ''];
}

export interface PersonRow {
  /** Values in the order of PERSON_HEADER. */
  row: string[];
  /** NDS columns that are required but empty or unreadable. */
  missing: string[];
}

export function personRow(properties: Properties): PersonRow {
  const get = (field: keyof typeof WEBLING_FIELDS) => findField(properties, WEBLING_FIELDS[field]);

  let [street, houseNumber] = [get('street'), get('houseNumber')];
  if (!houseNumber) [street, houseNumber] = splitStreet(street);

  const values: Record<string, string> = {
    PERSONENNUMMER: get('personNumber').replace(/\D/g, ''),
    NAME: get('lastname'),
    VORNAME: get('firstname'),
    GEBURTSDATUM: normalizeBirthday(get('birthday')),
    GESCHLECHT: normalizeGender(get('gender'), get('salutation')),
    AHV_NR: get('ahv') ? normalizeAhv(get('ahv')) : '',
    PEID: get('peid'),
    NATIONALITAET: normalizeNationality(get('nationality')),
    MUTTERSPRACHE: normalizeLanguage(get('motherTongue')),
    STRASSE: street,
    HAUSNUMMER: houseNumber,
    PLZ: get('zip'),
    ORT: get('city'),
    LAND: normalizeCountry(get('country'))
  };

  const required = [
    'NAME',
    'VORNAME',
    'GEBURTSDATUM',
    'GESCHLECHT',
    'NATIONALITAET',
    'MUTTERSPRACHE',
    'PLZ',
    'ORT',
    'LAND'
  ];
  const missing = required.filter((key) => !values[key]);
  // Only persons new to the club's NDS organisation need AHV-Nr. or PEID;
  // one with a person number is already known there.
  if (!values.PERSONENNUMMER && !values.AHV_NR && !values.PEID) missing.push('AHV_NR');

  return { row: PERSON_HEADER.map((column) => values[column]), missing };
}
