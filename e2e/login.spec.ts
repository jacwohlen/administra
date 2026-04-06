import { test, expect } from '@playwright/test';

test.describe('Login page', () => {
  test('shows welcome message and login button', async ({ page }) => {
    await page.goto('/');

    // Should show the welcome message
    await expect(page.getByText(/welcome/i)).toBeVisible();

    // Should show a login button when not authenticated
    await expect(page.getByRole('button', { name: /login/i })).toBeVisible();
  });

  test('does not show dashboard link when not authenticated', async ({ page }) => {
    await page.goto('/');

    // Dashboard button should not be visible for unauthenticated users
    await expect(page.getByRole('link', { name: /dashboard/i })).not.toBeVisible();
  });

  test('shows error message when sign-in error is present', async ({ page }) => {
    await page.goto('/?error=access_denied&error_description=Unauthorized');

    await expect(page.getByText(/could not log in/i)).toBeVisible();
  });
});

test.describe('Auth guard', () => {
  test('redirects /dashboard to login when not authenticated', async ({ page }) => {
    await page.goto('/dashboard');

    // Should be redirected to the home/login page
    await page.waitForURL('/');
    expect(page.url()).toContain('/');
  });

  test('redirects /dashboard/members to login when not authenticated', async ({ page }) => {
    await page.goto('/dashboard/members');

    await page.waitForURL('/');
    expect(page.url()).toContain('/');
  });

  test('redirects /dashboard/trainings to login when not authenticated', async ({ page }) => {
    await page.goto('/dashboard/trainings');

    await page.waitForURL('/');
    expect(page.url()).toContain('/');
  });

  test('redirects /dashboard/events to login when not authenticated', async ({ page }) => {
    await page.goto('/dashboard/events');

    await page.waitForURL('/');
    expect(page.url()).toContain('/');
  });

  test('redirects /dashboard/stats to login when not authenticated', async ({ page }) => {
    await page.goto('/dashboard/stats');

    await page.waitForURL('/');
    expect(page.url()).toContain('/');
  });
});
