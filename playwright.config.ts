import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'html' : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry'
  },
  projects: [
    // Unauthenticated tests — run in CI and locally
    {
      name: 'public',
      testMatch: /login\.spec|navigation\.spec/,
      use: { ...devices['Desktop Chrome'] }
    },
    // Auth setup — only when E2E_USER_EMAIL is set (local dev with Supabase)
    ...(process.env.E2E_USER_EMAIL
      ? [
          {
            name: 'auth-setup',
            testMatch: /auth\.setup\.ts/,
            use: { ...devices['Desktop Chrome'] }
          },
          {
            name: 'authenticated',
            testMatch: /dashboard\.spec|members\.spec|trainings\.spec|stats\.spec/,
            dependencies: ['auth-setup'],
            use: {
              ...devices['Desktop Chrome'],
              storageState: 'e2e/.auth/user.json'
            }
          }
        ]
      : [])
  ],
  webServer: {
    command: 'npm run dev',
    port: 5173,
    reuseExistingServer: !process.env.CI
  }
});
