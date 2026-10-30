import { describe, it, expect, afterEach } from 'vitest';
import {
  applyIntegrationConfig,
  emptyIntegrationConfig,
  integrationConfig,
  isModuleEnabled,
  parseIntegrationConfig
} from './integrationConfig';
import { hasTrainerLabel, providerName, visibleLabels } from './memberStatus';

// The seeded Webling rows of 20261029120000_integration_layer.sql (name, label, hidden, role)
const SEEDED_GROUPS = [
  ['03_Austritt', null, true, null],
  ['Aktiv', null, true, null],
  ['Passiv', null, true, null],
  ['Ehrenmitglieder', null, true, null],
  ['Nicht-Mitglieder', null, true, null],
  ['04_Probetraining', 'Probetraining', true, null],
  ['01_Anmeldung', null, true, null],
  ['02_Rechnung verschickt', null, true, null],
  ['03_Rechnung bezahlt', null, true, null],
  ['04_Pass bestellt', null, true, null],
  ['Test', null, true, null],
  ['Erwachsenentrainer', null, false, 'trainer'],
  ['Kindertrainer', null, false, null],
  ['Hilfstrainer', null, false, null],
  ['Vorstand', null, false, null],
  ['J&S', null, false, null]
].map(([name, label, hidden, role]) => ({ connection: 'webling', name, label, hidden, role }));

const WEBLING = {
  id: 'webling',
  display_name: 'Webling',
  settings: { hidden_group_pattern: '^\\d\\d_[A-Z]', default_section: 'General' }
};

function seeded(groups: unknown[] = SEEDED_GROUPS, connections: unknown[] = [WEBLING]) {
  return parseIntegrationConfig(connections, groups);
}

afterEach(() => {
  applyIntegrationConfig(null);
});

describe('parseIntegrationConfig', () => {
  it('reads display names, patterns, hidden labels and trainer labels', () => {
    const config = seeded();
    expect(config.loaded).toBe(true);
    expect(config.displayNames.get('webling')).toBe('Webling');
    expect(config.hiddenPatterns.map((p) => p.source)).toEqual(['^\\d\\d_[A-Z]']);
    // The label written to members: the catalog's label, else the group's name
    expect(config.groupHidden.get('Probetraining')).toBe(true);
    expect(config.groupHidden.has('04_Probetraining')).toBe(false);
    expect(config.groupHidden.get('Vorstand')).toBe(false);
    expect([...config.trainerLabels]).toEqual(['erwachsenentrainer']);
  });

  it('hides a label two groups share when either hides it', () => {
    const config = seeded([
      { name: 'Kader', hidden: false },
      { name: 'Kader', hidden: true },
      { name: 'Team', hidden: true },
      { name: 'Team', hidden: false }
    ]);
    expect(config.groupHidden.get('Kader')).toBe(true);
    expect(config.groupHidden.get('Team')).toBe(true);
  });

  it('skips rows it cannot use and a pattern JavaScript cannot read', () => {
    const config = seeded(
      [null, { name: '' }, { name: 42 }, { label: '  ', name: 'Real', hidden: true }],
      [null, { id: '' }, { id: 'csv', display_name: ' ', settings: { hidden_group_pattern: '(' } }]
    );
    expect([...config.groupHidden]).toEqual([['Real', true]]);
    expect(config.displayNames.size).toBe(0);
    expect(config.hiddenPatterns).toEqual([]);
  });
});

describe('isModuleEnabled', () => {
  it('is on only for a connection an admin switched on', () => {
    const config = seeded(SEEDED_GROUPS, [
      { ...WEBLING, enabled: true },
      { id: 'js', display_name: 'J+S (NDS)', enabled: false, settings: {} }
    ]);
    expect(isModuleEnabled('webling', config)).toBe(true);
    expect(isModuleEnabled('js', config)).toBe(false);
    expect(isModuleEnabled('csv', config)).toBe(false);
  });

  it('is off while the configuration is not loaded', () => {
    expect(isModuleEnabled('js', emptyIntegrationConfig())).toBe(false);
  });
});

describe('visibleLabels with the configuration', () => {
  it('hides what the seeded catalog hides, like the built-in rule', () => {
    const labels = [
      'Aktiv',
      'Passiv',
      'Ehrenmitglieder',
      'Nicht-Mitglieder',
      'Probetraining',
      'probetraining',
      'new',
      '03_Austritt',
      '01_Anmeldung',
      'Test',
      'Erwachsenentrainer',
      'J&S',
      'Vorstand',
      'passiv',
      '03_austritt'
    ];
    const builtIn = visibleLabels(labels, emptyIntegrationConfig());
    expect(visibleLabels(labels, seeded())).toEqual(builtIn);
    expect(builtIn).toEqual(['Erwachsenentrainer', 'J&S', 'Vorstand', 'passiv', '03_austritt']);
  });

  it('follows an admin who hides or shows a group', () => {
    const groups = SEEDED_GROUPS.map((g) =>
      g.name === 'Vorstand'
        ? { ...g, hidden: true }
        : g.name === 'Test'
          ? { ...g, hidden: false }
          : g
    );
    expect(visibleLabels(['Vorstand', 'Test', 'J&S'], seeded(groups))).toEqual(['Test', 'J&S']);
  });

  it("hides a new group by the connection's pattern until the catalog has it", () => {
    const config = seeded();
    expect(visibleLabels(['05_Mahnung', 'Kampfrichter'], config)).toEqual(['Kampfrichter']);
    const listed = seeded([...SEEDED_GROUPS, { name: '05_Mahnung', hidden: false }]);
    expect(visibleLabels(['05_Mahnung'], listed)).toEqual(['05_Mahnung']);
  });

  it('always hides the app’s own labels', () => {
    const groups = [
      { name: 'new', hidden: false },
      { name: 'probetraining', hidden: false }
    ];
    expect(visibleLabels(['new', 'probetraining'], seeded(groups))).toEqual([]);
  });

  it('reads the session configuration by default', () => {
    expect(visibleLabels(['Vorstand'])).toEqual(['Vorstand']);
    applyIntegrationConfig(seeded([{ name: 'Vorstand', hidden: true }]));
    expect(integrationConfig.loaded).toBe(true);
    expect(visibleLabels(['Vorstand'])).toEqual([]);
    applyIntegrationConfig(null);
    expect(visibleLabels(['Vorstand'])).toEqual(['Vorstand']);
  });
});

describe('hasTrainerLabel with the configuration', () => {
  it('marks members of trainer groups', () => {
    const config = seeded();
    expect(hasTrainerLabel(['Erwachsenentrainer'], config)).toBe(true);
    expect(hasTrainerLabel(['Kindertrainer'], config)).toBe(false);
  });

  it('keeps the built-in rule for labels the catalog does not know', () => {
    const config = seeded();
    expect(hasTrainerLabel(['erwachsenentrainer'], config)).toBe(true);
    expect(hasTrainerLabel(['Erwachsenentrainer Aikido'], config)).toBe(true);
    expect(hasTrainerLabel(['Trainer'], config)).toBe(false);
  });

  it('follows the role an admin gives', () => {
    const groups = SEEDED_GROUPS.map((g) =>
      g.name === 'Kindertrainer'
        ? { ...g, role: 'trainer' }
        : g.name === 'Erwachsenentrainer'
          ? { ...g, role: null }
          : g
    );
    const config = seeded(groups);
    expect(hasTrainerLabel(['Kindertrainer'], config)).toBe(true);
    expect(hasTrainerLabel(['Erwachsenentrainer'], config)).toBe(false);
  });
});

describe('providerName with the configuration', () => {
  it('uses the display name, else the built-in name or the id', () => {
    const config = seeded(SEEDED_GROUPS, [
      { ...WEBLING, display_name: 'Webling (Verein)' },
      { id: 'csv', display_name: 'CSV-Import', settings: {} }
    ]);
    expect(providerName('webling', config)).toBe('Webling (Verein)');
    expect(providerName('csv', config)).toBe('CSV-Import');
    expect(providerName('ical', config)).toBe('ical');
    expect(providerName('webling', emptyIntegrationConfig())).toBe('Webling');
  });
});
