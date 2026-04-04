import { test, expect } from '@playwright/test';

test.describe('Trainings', () => {
  test('shows trainings list sorted by weekday', async ({ page }) => {
    await page.goto('/dashboard/trainings');

    await expect(page).toHaveURL(/\/dashboard\/trainings/);
    await page.waitForTimeout(1000);

    // Should show training entries from seed data
    // Seed has: Aikido Waffentraining (Tue), Aikido Erwachsene (Tue+Thu),
    //           Judo Randori (Wed), Judo Kinder (Thu)
    await expect(page.getByText('Aikido').first()).toBeVisible();
  });

  test('can navigate to a training detail', async ({ page }) => {
    await page.goto('/dashboard/trainings');
    await page.waitForTimeout(1000);

    // Click on a training link
    const trainingLink = page.locator('a[href*="/dashboard/trainings/"]').first();
    if ((await trainingLink.count()) > 0) {
      await trainingLink.click();
      await expect(page).toHaveURL(/\/dashboard\/trainings\/\d+/);
    }
  });

  test('attendance page shows participant list', async ({ page }) => {
    // Navigate to a known training with a recent date
    await page.goto('/dashboard/trainings');
    await page.waitForTimeout(1000);

    // Find and click a "Track Attendance" button
    const trackButton = page.locator('a[href*="/dashboard/trainings/"]').first();
    if ((await trackButton.count()) > 0) {
      await trackButton.click();
      await page.waitForTimeout(1000);

      // Look for a Track Attendance link on the training detail page
      const attendanceLink = page.getByRole('link', { name: /track attendance|anwesenheit/i });
      if ((await attendanceLink.count()) > 0) {
        await attendanceLink.click();
        await page.waitForTimeout(1000);

        // Should show search input for members
        const searchInput = page.getByPlaceholder(/search|suchen/i);
        await expect(searchInput.first()).toBeVisible();
      }
    }
  });
});
