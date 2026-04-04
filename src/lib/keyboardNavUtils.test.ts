import { describe, it, expect } from 'vitest';
import { navigateList, filterExistingParticipants } from './keyboardNavUtils';

describe('navigateList', () => {
  describe('ArrowDown', () => {
    it('moves to next item', () => {
      const result = navigateList('ArrowDown', 0, 5);
      expect(result).toEqual({ index: 1, handled: true });
    });

    it('wraps to first item at end of list', () => {
      const result = navigateList('ArrowDown', 4, 5);
      expect(result).toEqual({ index: 0, handled: true });
    });

    it('moves from -1 to 0', () => {
      const result = navigateList('ArrowDown', -1, 5);
      expect(result).toEqual({ index: 0, handled: true });
    });

    it('does nothing on empty list', () => {
      const result = navigateList('ArrowDown', -1, 0);
      expect(result).toEqual({ index: -1, handled: false });
    });

    it('wraps on single-item list', () => {
      const result = navigateList('ArrowDown', 0, 1);
      expect(result).toEqual({ index: 0, handled: true });
    });
  });

  describe('ArrowUp', () => {
    it('moves to previous item', () => {
      const result = navigateList('ArrowUp', 3, 5);
      expect(result).toEqual({ index: 2, handled: true });
    });

    it('wraps to last item from first', () => {
      const result = navigateList('ArrowUp', 0, 5);
      expect(result).toEqual({ index: 4, handled: true });
    });

    it('does nothing when index is -1', () => {
      const result = navigateList('ArrowUp', -1, 5);
      expect(result).toEqual({ index: -1, handled: false });
    });

    it('does nothing on empty list', () => {
      const result = navigateList('ArrowUp', 0, 0);
      expect(result).toEqual({ index: 0, handled: false });
    });

    it('wraps on single-item list', () => {
      const result = navigateList('ArrowUp', 0, 1);
      expect(result).toEqual({ index: 0, handled: true });
    });
  });

  describe('Enter', () => {
    it('returns handled when index is valid', () => {
      const result = navigateList('Enter', 2, 5);
      expect(result).toEqual({ index: 2, handled: true });
    });

    it('returns not handled when index is -1', () => {
      const result = navigateList('Enter', -1, 5);
      expect(result).toEqual({ index: -1, handled: false });
    });

    it('returns the current index unchanged', () => {
      const result = navigateList('Enter', 0, 5);
      expect(result).toEqual({ index: 0, handled: true });
    });
  });

  describe('Escape', () => {
    it('resets index to -1', () => {
      const result = navigateList('Escape', 3, 5);
      expect(result).toEqual({ index: -1, handled: true });
    });

    it('stays at -1 if already there', () => {
      const result = navigateList('Escape', -1, 5);
      expect(result).toEqual({ index: -1, handled: true });
    });
  });

  describe('other keys', () => {
    it('returns not handled for letter keys', () => {
      const result = navigateList('a', 2, 5);
      expect(result).toEqual({ index: 2, handled: false });
    });

    it('returns not handled for Tab', () => {
      const result = navigateList('Tab', 0, 5);
      expect(result).toEqual({ index: 0, handled: false });
    });
  });
});

describe('filterExistingParticipants', () => {
  const members = [
    { id: '1', name: 'Alice' },
    { id: '2', name: 'Bob' },
    { id: '3', name: 'Charlie' }
  ];

  it('filters out existing participants', () => {
    const result = filterExistingParticipants(members, ['2']);
    expect(result).toEqual([
      { id: '1', name: 'Alice' },
      { id: '3', name: 'Charlie' }
    ]);
  });

  it('filters out multiple existing participants', () => {
    const result = filterExistingParticipants(members, ['1', '3']);
    expect(result).toEqual([{ id: '2', name: 'Bob' }]);
  });

  it('returns all when no existing participants', () => {
    const result = filterExistingParticipants(members, []);
    expect(result).toEqual(members);
  });

  it('returns empty when all are existing', () => {
    const result = filterExistingParticipants(members, ['1', '2', '3']);
    expect(result).toEqual([]);
  });

  it('handles empty members list', () => {
    const result = filterExistingParticipants([], ['1']);
    expect(result).toEqual([]);
  });

  it('ignores IDs not in the members list', () => {
    const result = filterExistingParticipants(members, ['99']);
    expect(result).toEqual(members);
  });
});
