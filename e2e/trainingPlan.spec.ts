import { test, expect } from '@playwright/test';

// Uses the training plan from supabase/seed.sql (see docs/TRAINING_PLAN.md);
// the seeded user is an admin, so it may plan
test.describe('Training plan', () => {
  test('lists the planned trainings with trainers and topics', async ({ page }) => {
    await page.goto('/dashboard/training-plan');
    await expect(page.getByRole('heading', { name: 'Training plan' })).toBeVisible({
      timeout: 10000
    });
    await expect(page.getByText('Judo Kampftraining').first()).toBeVisible();
    await expect(page.getByText('Uchi-mata').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Rotation' })).toBeVisible();
  });

  test('shows the holidays in the settings', async ({ page }) => {
    await page.goto('/dashboard/training-plan/settings');
    await expect(page.getByText('Weihnachten').first()).toBeVisible({ timeout: 10000 });
  });
});
