import { test, expect } from '@playwright/test';

test.describe('Dashboard', () => {
  test('shows the dashboard with navigation tabs', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard/);

    // All 5 tabs should be visible
    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveCount(5);
  });

  test('shows day navigation with arrows', async ({ page }) => {
    await page.goto('/dashboard');

    // Day navigation buttons should exist
    await expect(page.getByRole('button', { name: /Day/i })).toHaveCount(2);
  });

  test('navigates to trainings tab', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('tab').nth(1).click();
    await expect(page).toHaveURL(/\/dashboard\/trainings/);
  });

  test('navigates to members tab', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('tab').nth(3).click();
    await expect(page).toHaveURL(/\/dashboard\/members/);
  });

  test('navigates to events tab', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('tab').nth(2).click();
    await expect(page).toHaveURL(/\/dashboard\/events/);
  });

  test('navigates to stats tab', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('tab').nth(4).click();
    await expect(page).toHaveURL(/\/dashboard\/stats/);
  });
});
