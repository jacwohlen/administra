import { test, expect } from '@playwright/test';

// Phase 1b: member accounts only get in while one of their member records is
// an active or passive membership (docs/MEMBER_SIGN_IN.md). Needs the seeded
// accounts, see auth.setup.ts.

test.describe('member whose membership counts', () => {
  test.use({ storageState: 'e2e/.auth/member.json' });

  test('lands in the club area with both children', async ({ page }) => {
    await page.goto('/');
    await page.waitForURL('**/club');
    const picker = page.getByRole('navigation', { name: 'Choose profile' });
    await expect(picker.getByText('Leo')).toBeVisible();
    await expect(picker.getByText('Brandon')).toBeVisible();
  });

  test('is sent from the pending page and the dashboard to the club area', async ({ page }) => {
    for (const path of ['/pending', '/dashboard']) {
      await page.goto(path);
      await page.waitForURL('**/club');
    }
  });

  test('sees only active and passive members in the directory', async ({ page }) => {
    await page.goto('/club/members');
    await page.getByPlaceholder('Search by name…').fill('Snyder');
    // Emilia Snyder is active; Brandon Snyder trained recently but is a non-member
    await expect(page.getByText('Emilia Snyder')).toBeVisible();
    await expect(page.getByText('Brandon Snyder')).toHaveCount(0);
  });
});

test.describe('member who left', () => {
  test.use({ storageState: 'e2e/.auth/former.json' });

  for (const path of ['/', '/club', '/club/members', '/dashboard']) {
    test(`${path} ends on the pending page, which says why`, async ({ page }) => {
      await page.goto(path);
      await page.waitForURL('**/pending');
      await expect(page.getByRole('heading', { name: 'No access' })).toBeVisible();
      await expect(page.getByText('Left', { exact: true })).toBeVisible();
    });
  }
});
