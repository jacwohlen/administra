#!/usr/bin/env node
// Takes the app screenshots for the marketing site (marketing/public/img)
// and its social preview image (marketing/public/assets/og-image.png) from
// the LOCAL demo: made-up data only, never a real club.
//
// Prerequisites (see docs/DEMO.md, "Running the demo locally"):
//   1. local Supabase with the demo seed:
//        npx supabase db reset --no-seed
//        psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -1 -f supabase/demo/seed.sql
//   2. the app in demo mode: PUBLIC_MODE=DEMO in .env, `npm run dev`
//   3. Playwright's Chromium: `npx playwright install chromium` (or set
//      PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to an installed Chromium)
//   4. ImageMagick (`magick` or `convert`) with WebP support
//
//   node scripts/marketing-screenshots.mjs [--lang de|en] [--base-url http://localhost:5173]
//
// --lang en takes the English app into marketing/public/img/en and
// assets/og-image-en.png, for marketing/public/en/.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';

const { values: flags } = parseArgs({
  options: {
    'base-url': { type: 'string', default: 'http://localhost:5173' },
    lang: { type: 'string', default: 'de' },
    'db-url': {
      type: 'string',
      default: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
    }
  }
});
const baseUrl = /** @type {string} */ (flags['base-url']);
const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LANGS = {
  de: { locale: 'de-CH', env: 'de_CH.UTF-8', language: 'de_CH:de', dir: '', page: 'index.html' },
  en: {
    locale: 'en-GB',
    env: 'en_GB.UTF-8',
    language: 'en_GB:en',
    dir: 'en',
    page: 'en/index.html'
  }
};
const lang = LANGS[/** @type {string} */ (flags.lang)];
if (!lang) throw new Error(`--lang must be one of: ${Object.keys(LANGS).join(', ')}`);
const imgDir = path.join(repo, 'marketing/public/img', lang.dir);
mkdirSync(imgDir, { recursive: true });
const work = mkdtempSync(path.join(tmpdir(), 'administra-shots-'));

// ImageMagick 7 ships `magick`; version 6 only `convert`
const imageMagick = (() => {
  try {
    execFileSync('magick', ['-version'], { stdio: 'ignore' });
    return 'magick';
  } catch {
    return 'convert';
  }
})();

const DESKTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5 };
const PHONE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true
};

/** One value from the demo database. */
function sql(query) {
  return execFileSync('psql', [/** @type {string} */ (flags['db-url']), '-tAc', query], {
    encoding: 'utf8'
  }).trim();
}

// What to show: picked from the data, so the shots follow the seed.
const ids = {
  // An active youth member with the most badges (and grades, medals)
  member: sql(`
    SELECT m.id FROM public.members m
    JOIN public.member_badges b ON b."memberId" = m.id
    WHERE m.membership_status = 'active' AND m."archivedAt" IS NULL
      AND m.birthday::date BETWEEN current_date - interval '17 years'
                               AND current_date - interval '11 years'
      AND EXISTS (SELECT 1 FROM public.member_medals x WHERE x."memberId" = m.id)
    GROUP BY m.id ORDER BY count(*) DESC, m.id LIMIT 1`),
  // The latest past session of a kids' or youth Judo training, with most attendees
  checkin: sql(`
    SELECT l."trainingId" || '/' || l.date FROM public.logs l
    JOIN public.trainings t ON t.id = l."trainingId"
    WHERE t.section = 'Judo' AND (t.title ILIKE '%kinder%' OR t.title ILIKE '%jugend%')
      AND l.date < to_char(current_date, 'YYYY-MM-DD')
    GROUP BY 1, l.date ORDER BY l.date DESC, count(*) DESC LIMIT 1`),
  // Two passed candidates of the past exam day, shown side by side
  sheet: sql(`
    SELECT e.id || '/sheet?c=' || string_agg(c.id::text, ',' ORDER BY c.id)
    FROM public.exams e
    JOIN LATERAL (
      SELECT id FROM public.exam_candidates
      WHERE exam_id = e.id AND result = 'passed' ORDER BY id LIMIT 2
    ) c ON true
    WHERE e.date < to_char(current_date, 'YYYY-MM-DD')
    GROUP BY e.id, e.date ORDER BY e.date DESC LIMIT 1`)
};
for (const [key, value] of Object.entries(ids)) {
  if (!value) throw new Error(`Nothing to show for "${key}": is the demo seed loaded?`);
}

const shots = [
  {
    file: 'member-profile',
    role: 'admin',
    device: DESKTOP,
    url: `/dashboard/members/${ids.member}`
  },
  {
    file: 'checkin-phone',
    role: 'trainer',
    device: PHONE,
    url: `/dashboard/trainings/${ids.checkin}`
  },
  {
    file: 'trial-inbox',
    role: 'admin',
    device: DESKTOP,
    url: '/dashboard/probetraining',
    // Every candidate, not just the two new ones
    prepare: (page) =>
      page.locator('input[name="trial-filter"][value="all"]').check({ force: true })
  },
  { file: 'trial-form-phone', role: null, device: PHONE, url: '/probetraining' },
  {
    file: 'exam-sheet-phone',
    role: 'trainer',
    device: PHONE,
    url: `/dashboard/exams/${ids.sheet}`
  },
  { file: 'training-plan', role: 'admin', device: DESKTOP, url: '/dashboard/training-plan' },
  { file: 'stats', role: 'admin', device: DESKTOP, url: '/dashboard/stats' },
  { file: 'club-phone', role: 'member', device: PHONE, url: '/club' }
];

// The demo strip says "made up, reset weekly" — true in the demo, noise on the
// marketing site.
const HIDE_DEMO_BANNER = '[data-demo-banner] { display: none !important; }';

// Same escape hatch as playwright.config.ts when the installed browser
// does not match the Playwright version
const browser = await chromium.launch({
  // Browser UI in the page's language, e.g. the placeholder of date inputs
  // (TT.MM.JJJJ): Chrome on Linux takes it from LANG
  args: [`--lang=${lang.locale}`],
  env: { ...process.env, LANG: lang.env, LANGUAGE: lang.language },
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {})
});
try {
  /** @type {Map<string, import('playwright').BrowserContext>} */
  const contexts = new Map();

  async function contextFor(role, device) {
    const key = `${role}:${device === PHONE ? 'phone' : 'desktop'}`;
    if (contexts.has(key))
      return /** @type {import('playwright').BrowserContext} */ (contexts.get(key));
    const context = await browser.newContext({
      ...device,
      locale: lang.locale,
      timezoneId: 'Europe/Zurich',
      colorScheme: 'light',
      baseURL: baseUrl
    });
    await context.addInitScript((css) => {
      document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style');
        style.textContent = css;
        document.head.append(style);
      });
    }, HIDE_DEMO_BANNER);
    if (role) {
      // The real demo login: the role button on the start page
      const page = await context.newPage();
      await page.goto('/');
      await page.locator(`button[name="role"][value="${role}"]`).click();
      await page.waitForURL((url) => url.pathname !== '/', { timeout: 15_000 });
      await page.close();
    }
    contexts.set(key, context);
    return context;
  }

  for (const shot of shots) {
    const context = await contextFor(shot.role, shot.device);
    const page = await context.newPage();
    await page.goto(shot.url);
    await page.waitForLoadState('networkidle');
    if (shot.prepare) await shot.prepare(page);
    // Charts and avatars settle after the data arrives
    await page.waitForTimeout(1500);
    const png = path.join(work, `${shot.file}.png`);
    await page.screenshot({ path: png });
    await page.close();
    const size = shot.device === PHONE ? '780x1688' : '1600x1000';
    const webp = path.join(imgDir, `${shot.file}.webp`);
    execFileSync(imageMagick, [png, '-resize', size, '-quality', '82', webp]);
    console.log(`✓ ${shot.file}.webp  ${shot.url}`);
  }

  // Social preview (og:image), 1200 × 630: the page's own headline (one line
  // per sentence) and the part of its <title> after "Adsumus – "
  const page = readFileSync(path.join(repo, 'marketing/public', lang.page), 'utf8');
  const text = (re) =>
    (re.exec(page)?.[1] ?? '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  const headline = text(/<h1[^>]*>([\s\S]*?)<\/h1>/).replace(/([.!?]) /g, '$1<br>');
  const subline = text(/<title>([\s\S]*?)<\/title>/).replace(/^Adsumus – /, '');
  if (!headline || !subline) throw new Error(`No headline or title in ${lang.page}`);
  const og = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  const tokens = readFileSync(path.join(repo, 'static/brand/tokens.css'), 'utf8');
  const logo = readFileSync(path.join(repo, 'static/brand/logo/administra-logo.svg')).toString(
    'base64'
  );
  const phone = readFileSync(path.join(work, 'checkin-phone.png')).toString('base64');
  await og.setContent(`<!doctype html><html><head><style>${tokens}
    body { margin: 0; width: 1200px; height: 630px; overflow: hidden; font-family: var(--font-family);
      background: radial-gradient(700px 420px at 90% 0%, #ffd9d9, transparent 70%), #f7f7f7;
      display: grid; grid-template-columns: 1fr 360px; align-items: center; }
    .text { padding: 0 0 0 80px; }
    .brand { display: flex; align-items: center; gap: 18px; font-size: 40px; font-weight: 700; color: #030303; }
    .brand img { width: 72px; height: 72px; }
    h1 { font-size: 64px; line-height: 1.08; margin: 40px 0 24px; color: #030303; letter-spacing: -0.01em; }
    p { font-size: 28px; color: #4a4a4a; margin: 0; line-height: 1.35; }
    .phone { margin-top: 90px; width: 300px; border-radius: 36px; border: 10px solid #1b1b1b;
      box-shadow: 0 30px 80px rgb(0 0 0 / 0.25); background: #1b1b1b; }
    .phone img { display: block; width: 100%; border-radius: 26px; }
  </style></head><body>
    <div class="text">
      <div class="brand"><img src="data:image/svg+xml;base64,${logo}" alt="">Adsumus</div>
      <h1>${headline}</h1>
      <p>${subline}.</p>
    </div>
    <div class="phone"><img src="data:image/png;base64,${phone}" alt=""></div>
  </body></html>`);
  const ogFile = lang.dir ? `og-image-${lang.dir}.png` : 'og-image.png';
  await og.screenshot({ path: path.join(repo, 'marketing/public/assets', ogFile) });
  console.log(`✓ assets/${ogFile}`);
} finally {
  await browser.close();
  rmSync(work, { recursive: true, force: true });
}
