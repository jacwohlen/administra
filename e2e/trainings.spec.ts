import { test, expect } from '@playwright/test';

test.describe('Trainings', () => {
  test('shows trainings list', async ({ page }) => {
    await page.goto('/dashboard/trainings');
    await expect(page).toHaveURL(/\/dashboard\/trainings/);

    // Wait for training links to appear from seed data
    const trainingLinks = page.locator('a[href*="/dashboard/trainings/"]');
    await expect(trainingLinks.first()).toBeVisible({ timeout: 10000 });
  });

  test('can navigate to a training detail', async ({ page }) => {
    await page.goto('/dashboard/trainings');

    // Wait for training links to load
    const trainingLink = page.locator('a[href*="/dashboard/trainings/"]').first();
    await expect(trainingLink).toBeVisible({ timeout: 10000 });

    await trainingLink.click();
    await expect(page).toHaveURL(/\/dashboard\/trainings\/\d+/);
  });
});
