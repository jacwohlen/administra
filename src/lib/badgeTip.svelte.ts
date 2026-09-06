/**
 * One badge tooltip shared by every badge tile and chip on a page.
 *
 * The tooltip is positioned against the viewport because badge rows scroll
 * horizontally and would clip anything hanging outside them. Hover shows it
 * transiently; a tap pins it until the same badge is tapped again or a tap
 * lands elsewhere. Render <BadgeTooltip /> once per page to display it.
 */
export interface BadgeTip {
  key: string;
  badgeId: string;
  current?: number;
  threshold?: number | null;
  x: number;
  y: number;
  below: boolean;
}

export const badgeTip = $state<{ tip: BadgeTip | null; pinned: boolean }>({
  tip: null,
  pinned: false
});

function place(
  el: HTMLElement,
  key: string,
  badgeId: string,
  current?: number,
  threshold?: number | null
): BadgeTip {
  const r = el.getBoundingClientRect();
  const below = r.top < 96;
  const half = 128;
  const x = Math.min(Math.max(r.left + r.width / 2, half + 8), window.innerWidth - half - 8);
  return { key, badgeId, current, threshold, x, y: below ? r.bottom + 8 : r.top - 8, below };
}

export function hoverTip(
  el: HTMLElement,
  key: string,
  badgeId: string,
  current?: number,
  threshold?: number | null
) {
  if (!badgeTip.pinned) badgeTip.tip = place(el, key, badgeId, current, threshold);
}

export function leaveTip() {
  if (!badgeTip.pinned) badgeTip.tip = null;
}

export function tapTip(
  el: HTMLElement,
  key: string,
  badgeId: string,
  current?: number,
  threshold?: number | null
) {
  if (badgeTip.pinned && badgeTip.tip?.key === key) {
    dismissTip();
    return;
  }
  badgeTip.pinned = true;
  badgeTip.tip = place(el, key, badgeId, current, threshold);
}

export function dismissTip() {
  badgeTip.pinned = false;
  badgeTip.tip = null;
}

export function isPinned(key: string): boolean {
  return badgeTip.pinned && badgeTip.tip?.key === key;
}
