import { test, expect } from '@playwright/test';

test.describe('Stats', () => {
  test('shows stats page with year selector', async ({ page }) => {
    await page.goto('/dashboard/stats');

    await expect(page).toHaveURL(/\/dashboard\/stats/);
    await page.waitForTimeout(1000);

    // Should show the current year or "All" option
    const currentYear = new Date().getFullYear().toString();
    const yearText = page.getByText(currentYear);
    const allText = page.getByText(/all|alle/i);

    // At least one of these should be visible
    const hasYear = (await yearText.count()) > 0;
    const hasAll = (await allText.count()) > 0;
    expect(hasYear || hasAll).toBe(true);
  });

  test('can switch to ALL mode', async ({ page }) => {
    await page.goto('/dashboard/stats');
    await page.waitForTimeout(1000);

    const allLink = page.getByRole('link', { name: /all|alle/i });
    if ((await allLink.count()) > 0) {
      await allLink.click();
      await expect(page).toHaveURL(/\/dashboard\/stats\/ALL/);
    }
  });
});
