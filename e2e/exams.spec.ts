import { test, expect } from '@playwright/test';

// Uses the exam days from supabase/seed.sql (see docs/Q_EXAMS.md)
test.describe('Gradings', () => {
  test('lists the seeded exam days', async ({ page }) => {
    await page.goto('/dashboard/exams');
    await expect(page.getByText('Q-Prüfung Frühling')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Q-Prüfung Herbst 2025')).toBeVisible();
  });

  test('scores a pair side by side', async ({ page }) => {
    await page.goto('/dashboard/exams');
    await page.getByText('Q-Prüfung Frühling').click();
    await expect(page.getByText('Kinder Halbgelb')).toBeVisible({ timeout: 10000 });

    await page.getByRole('checkbox', { name: /Riley/ }).check();
    await page.getByRole('checkbox', { name: /Lillian/ }).check();
    await page.getByRole('button', { name: 'Score' }).click();
    await expect(page).toHaveURL(/\/sheet\?c=/);

    // First row: Riley, left side of the first throw. Tapping again clears it,
    // so the seeded sheet stays empty for the next run.
    const firstSide = page.locator('div[role=group]').first();
    await firstSide.getByRole('button', { name: '2', exact: true }).click();
    await expect(page.getByText(/Riley 2\/12 \(min/)).toBeVisible();
    await firstSide.getByRole('button', { name: '2', exact: true }).click();
    await expect(page.getByText(/Riley 0\/12 \(min/)).toBeVisible();
  });

  test('shows a grading program', async ({ page }) => {
    await page.goto('/dashboard/exams/programs');
    await page.getByText('Gelbgurt', { exact: false }).first().click();
    await expect(page.getByText('Nage-waza').first()).toBeVisible({ timeout: 10000 });
  });
});
