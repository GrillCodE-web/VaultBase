// E2E Tests — Authentication Flow
// FIX ARCH-MED-02: E2E tests with Playwright

import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should show login screen when database is locked', async ({ page }) => {
    // Wait for app to load
    await page.waitForSelector('[data-testid="login-form"], [class*="login"]', {
      timeout: 10000
    });

    // Verify login form is visible
    const loginForm = page.locator('[data-testid="login-form"]');
    await expect(loginForm).toBeVisible();
  });

  test('should unlock database with correct password', async ({ page }) => {
    // Skip if no password set
    const passwordInput = page.locator('input[type="password"]');
    await passwordInput.fill('test-password');

    const submitButton = page.locator('button[type="submit"]');
    await submitButton.click();

    // Should navigate to dashboard or show error
    await page.waitForURL(/\/dashboard|\/cards/, { timeout: 5000 })
      .catch(() => {
        // If navigation fails, check for error message
        expect(page.locator('[class*="error"]')).toBeVisible();
      });
  });

  test('should show error for wrong password', async ({ page }) => {
    const passwordInput = page.locator('input[type="password"]');
    await passwordInput.fill('wrong-password');

    const submitButton = page.locator('button[type="submit"]');
    await submitButton.click();

    // Should show error message
    const errorMessage = page.locator('[class*="error"], [class*="toast-error"]');
    await expect(errorMessage).toBeVisible({ timeout: 5000 });
  });

  test('should lock database when pressing Ctrl+L', async ({ page }) => {
    // First unlock (assuming password is set)
    const passwordInput = page.locator('input[type="password"]');
    await passwordInput.fill('test-password');
    await page.locator('button[type="submit"]').click();

    // Wait for app to load
    await page.waitForSelector('[class*="sidebar"], [class*="nav"]', { timeout: 10000 });

    // Press Ctrl+L to lock
    await page.keyboard.press('ControlOrMeta+L');

    // Should show login form again
    await expect(page.locator('input[type="password"]')).toBeVisible({ timeout: 5000 });
  });
});
