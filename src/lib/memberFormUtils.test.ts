import { describe, it, expect } from 'vitest';
import { addLabel, removeLabel, canSubmitMemberForm } from './memberFormUtils';

describe('addLabel', () => {
  it('adds a new label', () => {
    const result = addLabel(['existing'], 'new');
    expect(result.labels).toEqual(['existing', 'new']);
    expect(result.input).toBe('');
  });

  it('trims and lowercases the input', () => {
    const result = addLabel([], '  Judo  ');
    expect(result.labels).toEqual(['judo']);
  });

  it('prevents duplicate labels', () => {
    const result = addLabel(['judo'], 'judo');
    expect(result.labels).toEqual(['judo']);
  });

  it('prevents case-insensitive duplicates', () => {
    const result = addLabel(['judo'], 'JUDO');
    expect(result.labels).toEqual(['judo']);
  });

  it('ignores empty input', () => {
    const result = addLabel(['judo'], '');
    expect(result.labels).toEqual(['judo']);
    expect(result.input).toBe('');
  });

  it('ignores whitespace-only input', () => {
    const result = addLabel(['judo'], '   ');
    expect(result.labels).toEqual(['judo']);
  });

  it('clears input after adding', () => {
    const result = addLabel([], 'karate');
    expect(result.input).toBe('');
  });

  it('clears input even when not adding (duplicate)', () => {
    const result = addLabel(['judo'], 'judo');
    expect(result.input).toBe('');
  });

  it('works with empty labels array', () => {
    const result = addLabel([], 'first');
    expect(result.labels).toEqual(['first']);
  });

  it('preserves existing label order', () => {
    const result = addLabel(['a', 'b', 'c'], 'd');
    expect(result.labels).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('removeLabel', () => {
  it('removes an existing label', () => {
    expect(removeLabel(['judo', 'karate'], 'judo')).toEqual(['karate']);
  });

  it('returns same array when label not found', () => {
    expect(removeLabel(['judo'], 'karate')).toEqual(['judo']);
  });

  it('returns empty array when removing last label', () => {
    expect(removeLabel(['judo'], 'judo')).toEqual([]);
  });

  it('handles empty array', () => {
    expect(removeLabel([], 'judo')).toEqual([]);
  });

  it('removes only the specified label', () => {
    expect(removeLabel(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });
});

describe('canSubmitMemberForm', () => {
  it('returns true when both names are filled and not submitting', () => {
    expect(canSubmitMemberForm('John', 'Doe', false)).toBe(true);
  });

  it('returns false when firstname is empty', () => {
    expect(canSubmitMemberForm('', 'Doe', false)).toBe(false);
  });

  it('returns false when lastname is empty', () => {
    expect(canSubmitMemberForm('John', '', false)).toBe(false);
  });

  it('returns false when both names are empty', () => {
    expect(canSubmitMemberForm('', '', false)).toBe(false);
  });

  it('returns false when submitting', () => {
    expect(canSubmitMemberForm('John', 'Doe', true)).toBe(false);
  });
});
