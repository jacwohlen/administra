import { test, expect } from '@playwright/test';

test.describe('Page rendering', () => {
  test('login page loads without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');

    // Page should render without JS errors
    expect(errors).toHaveLength(0);
  });

  test('login page has correct title structure', async ({ page }) => {
    await page.goto('/');

    // Should have an h1 heading
    const heading = page.locator('h1');
    await expect(heading).toBeVisible();
  });

  test('login page contains logo image', async ({ page }) => {
    await page.goto('/');

    // Should render the logo
    const img = page.locator('img').first();
    await expect(img).toBeVisible();
  });
});
