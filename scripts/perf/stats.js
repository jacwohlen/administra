// Pure helpers of the performance scripts (bundle-report.mjs, measure.mjs),
// tested in stats.test.js.

/** Median of the numbers given (null when there are none). */
export function median(values) {
  const sorted = values
    .filter((v) => typeof v === 'number' && Number.isFinite(v))
    .sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The route table of SvelteKit's generated client app.js:
 * `"/dashboard": [12,[3]]` is page node 12 under layout node 3 (the root
 * layout, node 0, is always there; "~" marks a server load).
 * Returns { route: [node numbers, root layout first] }.
 */
export function parseRouteDictionary(appJs) {
  const start = appJs.indexOf('export const dictionary = {');
  if (start < 0) throw new Error('No route dictionary in app.js');
  const body = appJs.slice(start, appJs.indexOf('};', start));
  const routes = {};
  for (const match of body.matchAll(/"([^"]+)":\s*\[~?(\d+)(?:,\s*\[([^\]]*)\])?/g)) {
    const layouts = (match[3] ?? '')
      .split(',')
      .map((n) => n.replace('~', '').trim())
      .filter(Boolean)
      .map(Number);
    routes[match[1]] = [0, ...layouts.filter((n) => n !== 0), Number(match[2])];
  }
  return routes;
}

/** Every file a manifest entry needs on first load: its imports (not dynamic ones) and CSS. */
export function collectFiles(manifest, key, files = new Set()) {
  const entry = manifest[key];
  if (!entry || files.has(entry.file)) return files;
  files.add(entry.file);
  for (const css of entry.css ?? []) files.add(css);
  for (const imported of entry.imports ?? []) collectFiles(manifest, imported, files);
  return files;
}

/** Kilobytes with one decimal. */
export function kb(bytes) {
  return Math.round((bytes / 1024) * 10) / 10;
}
