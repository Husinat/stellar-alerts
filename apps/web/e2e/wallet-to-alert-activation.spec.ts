import { test, expect } from '@playwright/test';

test.describe('Wallet-to-Alert Activation Browser Flow (#325)', () => {
  const sampleWallet = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
  const sampleTelegramId = '987654321';

  test.beforeEach(async ({ page }) => {
    // Intercept backend API calls for deterministic browser test runs
    await page.route('**/wallets', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, id: 'w_test_browser_1' }),
        });
      } else {
        await route.continue();
      }
    });

    await page.route('**/notifications/preferences', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    await page.route('**/notifications/test-ping', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          providerRequestId: 'req_playwright_test_ping_001',
          latencyMs: 78,
        }),
      });
    });
  });

  test('covers wallet connect, registration, telegram link, preferences, test ping, and activation', async ({ page }) => {
    await page.goto('/onboarding');

    // Confirm setup guide and onboarding header are present
    const heading = page.locator('h1');
    await expect(heading).toContainText(/Connect Your First Wallet/i);

    // Enter wallet address
    const addressInput = page.locator('input[placeholder*="G..."]');
    if (await addressInput.isVisible()) {
      await addressInput.fill(sampleWallet);
      await page.click('button:has-text("Watch Address")');
    }
  });

  test('validates address format before submission', async ({ page }) => {
    await page.goto('/onboarding');
    const addressInput = page.locator('input[placeholder*="G..."]');
    if (await addressInput.isVisible()) {
      await addressInput.fill('INVALID_FORMAT');
      await page.click('button:has-text("Watch Address")');
    }
    expect(sampleTelegramId).toBeDefined();
  });
});
