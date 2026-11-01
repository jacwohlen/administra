import { describe, expect, it } from 'vitest';
import { collectFiles, median, parseRouteDictionary } from './stats.js';

describe('median', () => {
  it('takes the middle value, or the mean of the two middle ones', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([null, 5, undefined])).toBe(5);
    expect(median([])).toBeNull();
  });
});

describe('parseRouteDictionary', () => {
  it('lists root layout, layouts and page per route', () => {
    const appJs = `export const nodes = [];
export const dictionary = {
		"/": [~8],
		"/dashboard": [12,[3]],
		"/dashboard/events/[eventId]": [15,[3,4]],
		"/club": [9,[~2],[1]]
	};`;
    expect(parseRouteDictionary(appJs)).toEqual({
      '/': [0, 8],
      '/dashboard': [0, 3, 12],
      '/dashboard/events/[eventId]': [0, 3, 4, 15],
      '/club': [0, 2, 9]
    });
  });
});

describe('collectFiles', () => {
  it('follows static imports and CSS, not dynamic imports', () => {
    const manifest = {
      page: { file: 'page.js', imports: ['shared'], dynamicImports: ['charts'], css: ['page.css'] },
      shared: { file: 'shared.js', imports: ['page'] },
      charts: { file: 'charts.js' }
    };
    expect([...collectFiles(manifest, 'page')].sort()).toEqual([
      'page.css',
      'page.js',
      'shared.js'
    ]);
  });
});
