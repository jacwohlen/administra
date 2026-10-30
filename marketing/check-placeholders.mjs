// Build step of the marketing site (see netlify.toml): lists the
// [[placeholders]] still left in the published pages. On a production
// deploy (Netlify CONTEXT=production) any placeholder fails the build, so
// an unfinished Impressum or Datenschutzerklärung never goes live; previews
// and local runs only warn.
//
//   node marketing/check-placeholders.mjs

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

/** @param {string} dir @returns {string[]} */
function htmlFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return htmlFiles(full);
    return entry.name.endsWith('.html') ? [full] : [];
  });
}

/** Every [[…]] placeholder per file, relative to public/. */
export function findPlaceholders(dir = root) {
  return htmlFiles(dir).flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => ({
      file: path.relative(dir, file),
      text: m[1].replace(/\s+/g, ' ').trim()
    }))
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const found = findPlaceholders();
  for (const { file, text } of found) console.log(`${file}: [[${text}]]`);
  if (found.length === 0) {
    console.log('No placeholders left.');
  } else if (process.env.CONTEXT === 'production') {
    console.error(`\n${found.length} placeholder(s) left: fill them in before going live.`);
    process.exit(1);
  } else {
    console.warn(`\n${found.length} placeholder(s) left (allowed outside production).`);
  }
}
