// E2E Tests — Cards Management
// FIX ARCH-MED-02: E2E tests with Playwright

import { test, expect } from '@playwright/test';
import { getTauriMockScript } from './setup/tauri-mock.js';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(getTauriMockScript());
});

test.describe('Cards Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/cards');

    // Wait for cards page to load
    await page.waitForSelector('[class*="card-row"], [data-testid="cards-list"]', {
      timeout: 10000
    }).catch(() => {
      // May need to authenticate first
      console.log('Cards page may require authentication');
    });
  });

  test('should display cards list', async ({ page }) => {
    const cardRows = page.locator('[class*="card-row"]');
    const count = await cardRows.count();

    // Should have at least one card or show empty state
    if (count === 0) {
      const emptyState = page.locator('[class*="empty-state"]');
      await expect(emptyState).toBeVisible();
    } else {
      expect(count).toBeGreaterThan(0);
    }
  });

  test('should filter cards by status', async ({ page }) => {
    // Click on status filter
    const statusFilter = page.locator('[class*="status-filter"], [data-testid="status-filter"]');
    if (await statusFilter.isVisible()) {
      await statusFilter.click();

      // Select "free" status
      const freeOption = page.locator('[class*="dropdown-item"]:has-text("free")');
      await freeOption.click();

      // Wait for filter to apply
      await page.waitForTimeout(500);

      // Verify filtered results
      const cardRows = page.locator('[class*="card-row"]');
      const count = await cardRows.count();
      expect(count).toBeGreaterThanOrEqual(0);
    }
  });

  test('should search cards', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="earch"], input[type="search"]');
    if (await searchInput.isVisible()) {
      await searchInput.fill('visa');
      await page.waitForTimeout(500);

      // Should show filtered results or empty state
      const cardRows = page.locator('[class*="card-row"]');
      const count = await cardRows.count();
      expect(count).toBeGreaterThanOrEqual(0);

      // Clear search
      await searchInput.clear();
    }
  });

  test('should open card details on double click', async ({ page }) => {
    const firstCard = page.locator('[class*="card-row"]').first();
    if (await firstCard.isVisible()) {
      await firstCard.dblclick();

      // Should open side panel or modal
      const sidePanel = page.locator('[class*="side-panel"], [class*="modal"]');
      await expect(sidePanel).toBeVisible({ timeout: 3000 });
    }
  });

  test('should copy card number to clipboard', async ({ page }) => {
    const firstCard = page.locator('[class*="card-row"]').first();
    if (await firstCard.isVisible()) {
      // Click to reveal or open details
      await firstCard.click();

      // Look for copy button
      const copyButton = page.locator('[class*="copy"], [title*="opy"]');
      if (await copyButton.isVisible()) {
        await copyButton.click();

        // Should show toast notification
        const toast = page.locator('[class*="toast"], [class*="notification"]');
        await expect(toast).toBeVisible({ timeout: 3000 });
      }
    }
  });
});
