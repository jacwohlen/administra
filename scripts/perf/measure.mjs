#!/usr/bin/env node
// Measures page loads in a real browser (Playwright's Chromium), cold cache
// each run: time to first byte, first paint, largest paint, the time until
// the page is quiet (data loaded), JavaScript downloaded and the requests to
// Supabase. Median of several runs.
//
//   npm run perf:measure                              # demo.alleda.ch as trainer
//   npm run perf:measure -- --role admin --runs 7
//   npm run perf:measure -- --base-url http://localhost:4173 --pages /,/dashboard
//   npm run perf:measure -- --base-url https://admin.jacwohlen.ch \
//       --storage-state perf-login.json              # signed in, see below
//   npm run perf:measure -- --json > before.json      # for comparing
//
// Signing in: on the demo (PUBLIC_MODE=DEMO) the script uses the role
// buttons of the login page (--role). For any other site, save a signed-in
// browser state once (`npx playwright codegen --save-storage=perf-login.json
// <url>`, sign in, close) and pass it with --storage-state. That file holds
// a session: perf-login.json is in .gitignore, delete it afterwards. See
// docs/PERFORMANCE.md.

import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import { median } from './stats.js';

const { values: flags } = parseArgs({
  options: {
    'base-url': { type: 'string', default: 'https://demo.alleda.ch' },
    pages: {
      type: 'string',
      default:
        '/dashboard,/dashboard/members,/dashboard/trainings,/dashboard/events,/dashboard/stats'
    },
    role: { type: 'string', default: 'trainer' },
    'storage-state': { type: 'string' },
    runs: { type: 'string', default: '5' },
    locale: { type: 'string', default: 'de-CH' },
    // Throttles like a phone on a fair mobile connection
    mobile: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false }
  }
});

const baseUrl = flags['base-url'].replace(/\/$/, '');
const pages = flags.pages
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean);
const runs = Math.max(1, Number(flags.runs) || 5);

// Playwright's Chromium (`npx playwright install chromium`), or another one
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}
);
const storageState = flags['storage-state'] ?? (await demoLogin());

const results = [];
for (const pagePath of pages) {
  const samples = [];
  for (let i = 0; i < runs; i++) samples.push(await measure(pagePath));
  const pick = (key) => median(samples.map((s) => s[key]));
  results.push({
    page: pagePath,
    finalUrl: samples[samples.length - 1].finalUrl,
    ttfbMs: pick('ttfbMs'),
    fcpMs: pick('fcpMs'),
    lcpMs: pick('lcpMs'),
    quietMs: pick('quietMs'),
    jsKb: pick('jsKb'),
    requests: pick('requests'),
    supabaseRequests: pick('supabaseRequests'),
    supabaseMs: pick('supabaseMs')
  });
}
await browser.close();

if (flags.json) {
  console.log(JSON.stringify({ baseUrl, runs, mobile: flags.mobile, results }, null, 2));
} else {
  console.log(
    `${baseUrl}, median of ${runs} cold loads${flags.mobile ? ', mobile throttling' : ''}\n`
  );
  console.log('  TTFB    FCP    LCP  quiet  JS KB  req  supabase (n / ms)  page');
  for (const r of results) {
    const cells = [r.ttfbMs, r.fcpMs, r.lcpMs, r.quietMs].map((v) => fmt(v, 6));
    const redirected =
      new URL(r.finalUrl).pathname !== r.page ? `  → ${new URL(r.finalUrl).pathname}` : '';
    console.log(
      `${cells.join(' ')} ${fmt(r.jsKb, 6)} ${fmt(r.requests, 4)}  ${fmt(r.supabaseRequests, 4)} / ${fmt(r.supabaseMs, 6)}      ${r.page}${redirected}`
    );
  }
  console.log('\nquiet: until no request was open for 0.5 s (the page has its data).');
}

function fmt(value, width) {
  return (value === null ? '–' : String(Math.round(value))).padStart(width);
}

/** Signs in through the demo's role buttons; null when the site has none. */
async function demoLogin() {
  const context = await browser.newContext({ locale: flags.locale });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/`);
  const button = page.locator(`form[action="?/demo"] button[value="${flags.role}"]`);
  if ((await button.count()) === 0) {
    await context.close();
    if (pages.some((p) => p !== '/')) {
      console.error('No demo login on this site: pass --storage-state for signed-in pages.');
    }
    return undefined;
  }
  await Promise.all([page.waitForURL((url) => url.pathname !== '/'), button.click()]);
  const state = await context.storageState();
  await context.close();
  return state;
}

async function measure(pagePath) {
  const context = await browser.newContext({ locale: flags.locale, storageState });
  const page = await context.newPage();
  if (flags.mobile) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }
  await page.addInitScript(() => {
    window.__lcp = null;
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      window.__lcp = entries[entries.length - 1].startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  });

  let open = 0;
  let lastActivity = Date.now();
  const start = Date.now();
  page.on('request', () => {
    open++;
    lastActivity = Date.now();
  });
  const done = () => {
    open = Math.max(0, open - 1);
    lastActivity = Date.now();
  };
  page.on('requestfinished', done);
  page.on('requestfailed', done);

  await page.goto(`${baseUrl}${pagePath}`, { waitUntil: 'load' });
  // Quiet: no request open for 500 ms (SPA pages load their data after "load")
  while (open > 0 || Date.now() - lastActivity < 500) {
    if (Date.now() - start > 30000) break;
    await page.waitForTimeout(50);
  }
  const quietMs = lastActivity - start;

  const metrics = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const paint = performance.getEntriesByName('first-contentful-paint')[0];
    const resources = performance.getEntriesByType('resource');
    const js = resources.filter((r) => r.name.endsWith('.js'));
    const supabase = resources.filter((r) => /supabase\.(co|in)|:54321/.test(r.name));
    const supabaseEnd = Math.max(0, ...supabase.map((r) => r.responseEnd));
    const supabaseStart = Math.min(...supabase.map((r) => r.startTime));
    return {
      ttfbMs: nav ? nav.responseStart : null,
      fcpMs: paint ? paint.startTime : null,
      lcpMs: window.__lcp,
      jsKb: js.reduce((sum, r) => sum + (r.transferSize || r.encodedBodySize || 0), 0) / 1024,
      requests: resources.length + 1,
      supabaseRequests: supabase.length,
      // From the first Supabase request to the last answer: how long the
      // page waits for its data, including requests made one after another
      supabaseMs: supabase.length ? supabaseEnd - supabaseStart : null
    };
  });
  const finalUrl = page.url();
  await context.close();
  return { ...metrics, quietMs, finalUrl };
}
