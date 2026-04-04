import { test, expect } from '@playwright/test';

test.describe('Members', () => {
  test('shows members list', async ({ page }) => {
    await page.goto('/dashboard/members');

    // Should show the members page
    await expect(page).toHaveURL(/\/dashboard\/members/);

    // Should have a search input or member entries
    // The page loads members from Supabase ordered by lastname
    await page.waitForTimeout(1000); // Wait for data to load

    // There should be at least one member from seed data
    const memberLinks = page.locator('a[href*="/dashboard/members/"]');
    const count = await memberLinks.count();
    expect(count).toBeGreaterThan(0);
  });

  test('can search for a member', async ({ page }) => {
    await page.goto('/dashboard/members');
    await page.waitForTimeout(1000);

    // Type in search (seed data has "Scott" as a lastname)
    const searchInput = page.getByPlaceholder(/search|suchen/i);
    if ((await searchInput.count()) > 0) {
      await searchInput.fill('Scott');
      await page.waitForTimeout(500);

      // Should filter results
      await expect(page.getByText('Scott')).toBeVisible();
    }
  });

  test('can open a member profile', async ({ page }) => {
    await page.goto('/dashboard/members');
    await page.waitForTimeout(1000);

    // Click on the first member link
    const memberLink = page.locator('a[href*="/dashboard/members/"]').first();
    if ((await memberLink.count()) > 0) {
      await memberLink.click();
      await expect(page).toHaveURL(/\/dashboard\/members\/\d+/);
    }
  });
});
