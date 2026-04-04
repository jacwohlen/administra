import { test, expect } from '@playwright/test';

test.describe('Members', () => {
  test('shows members list', async ({ page }) => {
    await page.goto('/dashboard/members');
    await expect(page).toHaveURL(/\/dashboard\/members/);

    // Wait for member links to appear (seed data has members)
    const memberLinks = page.locator('a[href*="/dashboard/members/"]');
    await expect(memberLinks.first()).toBeVisible({ timeout: 10000 });
  });

  test('can search for a member', async ({ page }) => {
    await page.goto('/dashboard/members');

    // Wait for page to load
    const memberLinks = page.locator('a[href*="/dashboard/members/"]');
    await expect(memberLinks.first()).toBeVisible({ timeout: 10000 });

    // Type in search (seed data has "Scott" as a lastname)
    const searchInput = page.locator('input.input');
    await searchInput.fill('Scott');

    // Should filter results to show Scott entries
    await expect(page.getByText('Scott').first()).toBeVisible();
  });

  test('can open a member profile', async ({ page }) => {
    await page.goto('/dashboard/members');

    // Wait for member links to appear
    const memberLink = page.locator('a[href*="/dashboard/members/"]').first();
    await expect(memberLink).toBeVisible({ timeout: 10000 });

    await memberLink.click();
    await expect(page).toHaveURL(/\/dashboard\/members\/\d+/);
  });
});
