#!/usr/bin/env node
// What the browser downloads on the first visit of each route: JavaScript and
// CSS, gzip-compressed (as Netlify serves them). Run after `npm run build`:
//
//   npm run perf:bundle                 # table, largest routes first
//   npm run perf:bundle -- --top 10     # only the 10 largest
//   npm run perf:bundle -- --json       # for comparing two builds
//   npm run perf:bundle -- --max-kb 300 # exit 1 when a route needs more JS
//
// See docs/PERFORMANCE.md.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';
import { collectFiles, kb, parseRouteDictionary } from './stats.js';

const { values: flags } = parseArgs({
  options: {
    top: { type: 'string' },
    json: { type: 'boolean', default: false },
    'max-kb': { type: 'string' }
  }
});

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const client = path.join(repo, '.svelte-kit', 'output', 'client');
const generated = path.join(repo, '.svelte-kit', 'generated', 'client-optimized');

let manifest;
try {
  manifest = JSON.parse(readFileSync(path.join(client, '.vite', 'manifest.json'), 'utf8'));
} catch {
  console.error('No build found: run `npm run build` first.');
  process.exit(1);
}
const routes = parseRouteDictionary(readFileSync(path.join(generated, 'app.js'), 'utf8'));
const entryKey = Object.keys(manifest).find(
  (k) => manifest[k].isEntry && k.endsWith('runtime/client/entry.js')
);
const appKey = Object.keys(manifest).find((k) => k.endsWith('client-optimized/app.js'));
const nodeKey = (n) =>
  Object.keys(manifest).find((k) => k.endsWith(`client-optimized/nodes/${n}.js`));

const gzipCache = new Map();
function gzipped(file) {
  if (!gzipCache.has(file)) {
    gzipCache.set(file, gzipSync(readFileSync(path.join(client, file))).length);
  }
  return gzipCache.get(file);
}

const rows = Object.entries(routes).map(([route, nodes]) => {
  const files = new Set();
  for (const key of [entryKey, appKey, ...nodes.map(nodeKey)]) collectFiles(manifest, key, files);
  let js = 0;
  let css = 0;
  for (const file of files) {
    if (file.endsWith('.css')) css += gzipped(file);
    else js += gzipped(file);
  }
  return { route, jsKb: kb(js), cssKb: kb(css), files: files.size };
});
rows.sort((a, b) => b.jsKb - a.jsKb);
const shown = flags.top ? rows.slice(0, Number(flags.top)) : rows;

if (flags.json) {
  console.log(JSON.stringify(shown, null, 2));
} else {
  console.log('First visit per route, gzip (KB):\n');
  console.log('   JS    CSS  files  route');
  for (const r of shown) {
    console.log(
      `${String(r.jsKb).padStart(5)}  ${String(r.cssKb).padStart(5)}  ${String(r.files).padStart(5)}  ${r.route}`
    );
  }
}

if (flags['max-kb']) {
  const max = Number(flags['max-kb']);
  const over = rows.filter((r) => r.jsKb > max);
  if (over.length > 0) {
    console.error(
      `\n${over.length} route(s) over ${max} KB JS: ${over.map((r) => r.route).join(', ')}`
    );
    process.exit(1);
  }
}
