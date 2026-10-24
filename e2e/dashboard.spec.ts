import { test, expect } from '@playwright/test';

test.describe('Dashboard', () => {
  test('shows the dashboard with navigation tabs', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard/);

    // Today, Trainings, Events, Gradings, Members, Trial, Stats
    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveCount(7);
  });

  test('shows day navigation with arrows', async ({ page }) => {
    await page.goto('/dashboard');

    // Day navigation buttons should exist
    await expect(page.getByRole('button', { name: /Day/i })).toHaveCount(2);
  });

  test('navigates to trainings tab', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('tab', { name: 'Trainings' }).click();
    await expect(page).toHaveURL(/\/dashboard\/trainings/);
  });

  test('navigates to members tab', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('tab', { name: 'Members' }).click();
    await expect(page).toHaveURL(/\/dashboard\/members/);
  });

  test('navigates to events tab', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('tab', { name: 'Events' }).click();
    await expect(page).toHaveURL(/\/dashboard\/events/);
  });

  test('navigates to gradings tab', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('tab', { name: 'Gradings' }).click();
    await expect(page).toHaveURL(/\/dashboard\/exams/);
  });

  test('navigates to stats tab', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('tab', { name: 'Stats' }).click();
    await expect(page).toHaveURL(/\/dashboard\/stats/);
  });
});
