# Administra brand

The design of Administra, extracted from the app so it can be reused outside it
(e-mails, slides, print, a landing page, a sister app). The visual style
sheet [`index.html`](index.html) is served by the app at
[admin.jacwohlen.ch/brand/](https://admin.jacwohlen.ch/brand/) (Dev:
[main.admin.jacwohlen.ch/brand/](https://main.admin.jacwohlen.ch/brand/)).

| File                                                   | What                                                       |
| ------------------------------------------------------ | ---------------------------------------------------------- |
| [`logo/administra-logo.svg`](logo/administra-logo.svg) | The Administra mark (vector)                               |
| [`logo/administra-logo.png`](logo/administra-logo.png) | The mark, 256 × 256 PNG                                    |
| [`logo/judo-icon.svg`](logo/judo-icon.svg)             | Judogi with black belt — marks trainers/coaches in lists   |
| [`tokens.css`](tokens.css)                             | All tokens as CSS custom properties, light + `.dark`       |
| [`tokens.json`](tokens.json)                           | The same tokens as JSON (hex + original oklch)             |
| [`index.html`](index.html)                             | Visual style sheet: logo, palette, type, components, belts |

**Source of truth is the app.** The app does not import anything from
`static/brand`; it uses Skeleton's built-in **nosh** theme (`data-theme="nosh"` in
`src/app.html`, imported in `src/app.css`) plus the overrides in `src/app.css`.
If the theme or those overrides change, regenerate these files.

## Logo

A red, upward-pointing chevron/triangle: an "A" made of a solid red triangle
with a white inner stroke, reading both as the letter A and as a mountain.

- Colour: **Administra Red `#dc0024`** — exactly the theme's `primary-500`.
- Use it on white or light surfaces; on dark surfaces it keeps its red (no
  white variant exists yet).
- Keep clear space of at least ¼ of the mark's width around it. Don't recolour,
  stretch, outline or add effects.
- In the app the mark spins once (`rotate(-360deg)`, 2 s) on the pending and
  error pages (`src/routes/LogoImage.svelte`).
- Public pages show the _club's_ logo (`PUBLIC_CLUB_LOGO`) and fall back to the
  Administra mark (`src/lib/components/ClubLogo.svelte`). Administra is the
  tool; the club is the face.

There is no separate wordmark file; the name is written **Administra**
(capital A) in the body font.

## Colour

Built on Skeleton's **nosh** theme. Every colour comes as an 11-step scale
(50–950); full values in [`tokens.css`](tokens.css).

| Role          | Key step                         | Use in the app                                                        |
| ------------- | -------------------------------- | --------------------------------------------------------------------- |
| **Primary**   | `#dc0024` (500), `#c90c24` (600) | Brand red: main buttons, active tab underline, links, avatar fallback |
| **Secondary** | `#f5d2d2` (500)                  | Soft blush: low-emphasis chips (`preset-tonal-secondary`)             |
| **Tertiary**  | `#3c5748` (500)                  | Deep moss green: rare accents                                         |
| **Success**   | `#538c8f` (500)                  | Muted teal: present / passed / OK                                     |
| **Warning**   | `#ece759` (500)                  | Lemon yellow: pending users dot, warnings (text on it: 800–950)       |
| **Error**     | `#ff8d8e` (500), `#e57c79` (600) | Soft coral: destructive buttons, validation errors                    |
| **Surface**   | `#f7f7f7` (50) … `#030303` (950) | Pure neutral grey: backgrounds, borders, body text                    |

Character: **one strong red on neutral grey**. Everything else is soft and
desaturated so the red stays the only loud colour. Error is deliberately a
coral, not a second red, so it never competes with the brand.

Most-used classes in the codebase (by count): `text-surface-600` (muted text),
`preset-tonal-surface` (default buttons), `preset-filled-primary-500` (primary
action), `bg-surface-100` / `bg-surface-50` (cards, avatars).

### Light / dark

Body is `surface-50` on light and `surface-950` on dark; text is the opposite
end. Skeleton's paired classes (`bg-surface-100-900`, `text-surface-600-400`)
flip automatically. Links are `primary-600` on light, `primary-500` on dark.
Dark mode is a `.dark` class on `<html>`, remembered in `localStorage`, default
from `prefers-color-scheme`.

### Charts

Categorical series colours (`src/lib/statsUtils.ts`), assigned to groups in
sorted order so a section keeps its colour everywhere:

| #     | 1         | 2         | 3         | 4         | 5         | 6         | 7         | 8         |
| ----- | --------- | --------- | --------- | --------- | --------- | --------- | --------- | --------- |
| Light | `#2a78d6` | `#eb6834` | `#1baf7a` | `#eda100` | `#e87ba4` | `#008300` | `#4a3aa7` | `#e34948` |
| Dark  | `#3987e5` | `#d95926` | `#199e70` | `#c98500` | `#d55181` | `#008300` | `#9085e9` | `#e66767` |

### Belts

Grade colours live in the `grades` table and are shown as small belt strips
(`BeltStrip.svelte`: 2px radius, 1px `rgb(0 0 0 / .18)` border, half belts
split horizontally, one white stripe per dan).

| 6. Kyu    | 5. Kyu    | 4. Kyu    | 3. Kyu    | 2. Kyu    | 1. Kyu    | Dan       |
| --------- | --------- | --------- | --------- | --------- | --------- | --------- |
| `#f5f5f5` | `#f4d03f` | `#f0932b` | `#27ae60` | `#2e86de` | `#7b4a2d` | `#111111` |

## Typography

- **Family:** `Avenir, Montserrat, Corbel, 'URW Gothic', source-sans-pro,
sans-serif` — a geometric humanist sans. No web font is loaded; each platform
  uses the first one it has (Avenir on Apple, Corbel on Windows, URW Gothic on
  Linux). For designs outside the app, use **Montserrat** (Google Fonts).
- **Base:** 18px / 28px, regular. Type scale ratio 1.067.
- **Headings:** same family, `bolder`. Kept small for mobile: h1 `text-xl`
  (`text-2xl` from 640px), h2 `text-lg` (`text-xl` from 640px), h3/h4 `text-lg`.
- **Weights in use:** semibold (titles, toast titles), bold (initials, badges),
  medium (tabs, segmented controls).
- **Links:** no underline, underline on hover.

## Shape, space, motion

- Spacing unit `0.25rem` (Tailwind scale).
- Radius: `0.375rem` for buttons/inputs, `0.75rem` for cards (`rounded-container`),
  full pills for avatars, chips and segmented controls.
- Borders 1px. Cards: `border border-surface-200-800 p-4`.
- Touch targets: **44px minimum** for buttons, icon buttons, tabs and the nav
  avatar on mobile (Apple HIG).
- Motion is quick and quiet: 150ms colour transitions; toasts slide in over
  400ms with a slight overshoot (`cubic-bezier(0.21, 1.02, 0.73, 1)`).

## Components

Skeleton v4 is headless, so `src/app.css` styles these directly:

- **Buttons:** `btn preset-filled-primary-500` (one primary action per view),
  `btn preset-tonal-surface` (everything else), `btn preset-filled-error-500` /
  `preset-tonal-error` (destructive). Never the uncoloured `preset-filled` /
  `preset-tonal`. Icon-only buttons carry `title` and `aria-label`.
- **Navigation:** a tab bar with an icon per section; icon-only on mobile
  (icons 1.4em), icon + label from 640px. Active tab = primary text and a 2px
  primary underline. Profile avatar on the right.
- **Segmented control:** grey pill track (`surface-200-800`), selected item is
  a white pill with a soft shadow.
- **Avatars:** round; fallback initials in bold on `surface-100-900`
  (`.avatar-initials`), last name first. Only the trial-training list tints
  them by status.
- **Entity badge:** 2.5rem rounded square with bold initials on `surface-100`.
- **Modals:** 50% black overlay, card `max-width: 24rem` (`32rem` large),
  `shadow-2xl`. Put `use:modalDialog` (`src/lib/modalDialog.ts`) on the
  `.modal-dialog` box: it moves focus in so Escape and Tab work. Escape and a
  click on the overlay close it.
- **Confirmations:** every delete, remove, disable or withdraw asks first
  with `ConfirmDialog` (`src/lib/components/ConfirmDialog.svelte`): a short
  title, a sentence naming the thing, Cancel then the red action.
- **Forms:** label above the field, `*` after the label of required fields,
  Cancel (tonal) then Save (primary) at the bottom right.
- **Detail pages:** `.page-header-back` with an icon-only back button, the
  entity name as `h1`, actions on the right.
- **Empty states:** `p.empty-state`: centred, muted (`surface-600-400`), 2rem
  vertical padding. Lists show one when empty and when a search finds nothing.
- **Errors:** a toast with a translated message; never raw database text,
  `alert()` or only `console.error`.
- **Icons:** Font Awesome solid (`@fortawesome/free-solid-svg-icons` via
  `svelte-fa`). Medals use emoji 🥇🥈🥉.

## Voice

German first (Swiss club context), English second (`src/lib/i18n/locales`).
Short, friendly, informal **du**: "Heute findet kein Training statt!",
"Dein Konto wurde deaktiviert. Bitte wende dich an einen Administrator."
Gender-inclusive where it matters ("deine Trainerin oder deinen Trainer").
Sentence case for labels and buttons ("Training erstellen", not "Training
Erstellen"); one ellipsis character (…), never three dots.
