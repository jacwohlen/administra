import { test, expect } from '@playwright/test';

test.describe('Dashboard', () => {
  test('shows the dashboard with navigation tabs', async ({ page }) => {
    await page.goto('/dashboard');

    // Should stay on dashboard (not redirect to login)
    await expect(page).toHaveURL(/\/dashboard/);

    // Navigation tabs should be visible
    await expect(page.getByText('Trainings')).toBeVisible();
    await expect(page.getByText('Members')).toBeVisible();
    await expect(page.getByText('Stats')).toBeVisible();
    await expect(page.getByText('Events')).toBeVisible();
  });

  test('shows day navigation with arrows', async ({ page }) => {
    await page.goto('/dashboard');

    // Day navigation buttons should exist
    const dayButtons = page.getByRole('button').filter({ hasText: /day|tag/i });
    await expect(dayButtons.first()).toBeVisible();
  });

  test('navigates to trainings tab', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByText('Trainings').click();
    await expect(page).toHaveURL(/\/dashboard\/trainings/);
  });

  test('navigates to members tab', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByText('Members').click();
    await expect(page).toHaveURL(/\/dashboard\/members/);
  });

  test('navigates to events tab', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByText('Events').click();
    await expect(page).toHaveURL(/\/dashboard\/events/);
  });

  test('navigates to stats tab', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByText('Stats').click();
    await expect(page).toHaveURL(/\/dashboard\/stats/);
  });
});
