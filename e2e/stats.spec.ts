import { test, expect } from '@playwright/test';

test.describe('Stats', () => {
  test('shows stats page with year selector', async ({ page }) => {
    await page.goto('/dashboard/stats');
    await expect(page).toHaveURL(/\/dashboard\/stats/);

    // Year navigation buttons should be visible (contain "Year" text)
    await expect(page.getByText('Year').first()).toBeVisible({ timeout: 10000 });

    // Current year should be shown in the radio group
    const currentYear = new Date().getFullYear().toString();
    await expect(page.getByText(currentYear)).toBeVisible();
  });

  test('can switch to ALL mode', async ({ page }) => {
    await page.goto('/dashboard/stats');

    // Wait for page to load
    await expect(page.getByText('Year').first()).toBeVisible({ timeout: 10000 });

    // Click the "All" radio item
    await page.getByText('All').click();
    await expect(page).toHaveURL(/\/dashboard\/stats\/ALL/);
  });
});
