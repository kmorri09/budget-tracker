// Run against a local server; every API request uses fictitious data.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.UI_TEST_URL || 'http://localhost:3111';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const categories = [
  { id: 'bonus', name: 'Bonus + Tax Refund', available: 1399.17 },
  { id: 'travel', name: 'Travel', available: 600 },
  { id: 'rent', name: 'Rent', available: 2000 },
].map(category => ({ ...category, active: true, icon: '', target: 0, allocated: category.available, spent: 0 }));
const accounts = [{ id: 'cash', name: 'Checking', institution: 'Test bank', type: 'checking', active: true, ledgerBalance: 4000, openingBalance: 0, providerBalance: null, providerBalanceAt: null, syncEnabled: false, isDefaultCash: true }];
const fixture = {
  ledgerBalance: 4000, providerBalance: null, remainingToBudget: 0, allocationPercent: 100,
  availableBreakdown: { income: 3999.17, adjustments: 0, allocations: 3999.17, available: 0 },
  availableAdjustments: [], accounts, managedAccounts: accounts, categories, managedCategories: categories,
  activity: [], allocations: [], payments: [], reviews: [], categorizationRules: [], obligations: [],
  trailing30: { income: 4000, spending: 0, startDate: '2026-10-01', endDate: '2026-10-30' },
};

(async () => {
  fs.mkdirSync('.next/ui-smoke', { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/**', route => {
        const pathname = new URL(route.request().url()).pathname;
        assert.equal(route.request().method(), 'GET', 'Preview never writes financial data');
        if (pathname === '/api/auth/session') return route.fulfill({ json: { user: { displayName: 'Fixture owner' } } });
        if (pathname === '/api/dashboard') return route.fulfill({ json: fixture });
        if (pathname === '/api/connections') return route.fulfill({ json: { configured: false, connections: [] } });
        throw new Error('Unexpected API request: ' + pathname);
      });
      await page.goto(base);
      const cash = page.getByRole('region', { name: 'Where your cash is planned' });
      try {
        await cash.getByRole('button', { name: 'Flex cushion · Off', exact: true }).waitFor();
      } catch (error) {
        await page.screenshot({ path: `.next/ui-smoke/flex-cushion-error-${width}.png`, fullPage: true });
        console.error({ errors, body: await page.locator('body').innerText() });
        throw error;
      }
      assert.equal(await cash.locator('details.cash-flex').count(), 0, 'Default dashboard has no cushion panel, even with Bonus');
      await cash.screenshot({ path: `.next/ui-smoke/flex-cushion-off-${width}.png` });
      await cash.getByRole('button', { name: 'Flex cushion · Off', exact: true }).click();
      await cash.getByLabel('Use a flex cushion', { exact: true }).check();
      await cash.getByText('Select at least one category to show a cushion preview.', { exact: true }).waitFor();
      await cash.getByLabel('Travel', { exact: true }).check();
      await cash.getByLabel('Bonus + Tax Refund', { exact: true }).check();
      const preview = cash.locator('details.cash-flex');
      assert.equal(await preview.getAttribute('open'), null, 'Details start collapsed');
      await preview.getByText('$1,999.17 cushion remaining', { exact: true }).waitFor();
      await cash.getByRole('button', { name: 'Done', exact: true }).click();
      await cash.screenshot({ path: `.next/ui-smoke/flex-cushion-collapsed-${width}.png` });
      await preview.locator('summary').click();
      await preview.getByText('$1,999.17', { exact: true }).first().waitFor({ state: 'visible' });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No overflow at ' + width);
      await cash.screenshot({ path: `.next/ui-smoke/flex-cushion-${width}.png` });

      await page.reload();
      await cash.getByRole('button', { name: 'Flex cushion · On', exact: true }).waitFor();
      await preview.getByText('$1,999.17 cushion remaining', { exact: true }).waitFor();
      await cash.getByRole('button', { name: 'Flex cushion · On', exact: true }).click();
      await cash.getByLabel('Use a flex cushion', { exact: true }).uncheck();
      assert.equal(await preview.count(), 0, 'Turning off removes the panel');
      await page.reload();
      await cash.getByRole('button', { name: 'Flex cushion · Off', exact: true }).click();
      await cash.getByLabel('Use a flex cushion', { exact: true }).check();
      assert(await cash.getByLabel('Travel', { exact: true }).isChecked(), 'Selections survive turning off');
      await cash.getByLabel('Travel', { exact: true }).uncheck();
      await cash.getByLabel('Bonus + Tax Refund', { exact: true }).uncheck();
      await cash.getByLabel('Rent', { exact: true }).check();
      await preview.getByText('$2,000.00 cushion remaining', { exact: true }).waitFor();

      fixture.accounts[0].ledgerBalance = 2500;
      await page.reload();
      await preview.getByText('$500.83 cushion remaining', { exact: true }).waitFor();
      await cash.getByRole('button', { name: 'Flex cushion · On', exact: true }).click();
      await cash.getByLabel('Use a flex cushion', { exact: true }).uncheck();
      await cash.getByText('Cash shortfall: $1,499.17', { exact: true }).waitFor();
      fixture.accounts[0].ledgerBalance = 4000;
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`Flex cushion selection, persistence, and cash warnings passed at ${width}px`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
