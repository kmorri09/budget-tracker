// Run against a local dev server. All API requests use fictitious data.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.UI_TEST_URL || 'http://localhost:3111';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const categories = [
  { id: 'groceries', name: 'Groceries', available: -165 },
  { id: 'dining', name: 'Dining', available: -99 },
  { id: 'utilities', name: 'Utilities', available: -17.98 },
  { id: 'travel', name: 'Travel', available: 100 },
].map(category => ({ ...category, active: true, icon: '', target: 0, allocated: 0, spent: 0 }));
const fixture = {
  ledgerBalance: 250, providerBalance: null, remainingToBudget: 250, allocationPercent: 0,
  availableBreakdown: { income: 250, adjustments: 0, allocations: 0, available: 250 },
  availableAdjustments: [], accounts: [], managedAccounts: [], categories, managedCategories: categories,
  activity: [], allocations: [], payments: [], reviews: [], categorizationRules: [], obligations: [],
  trailing30: { income: 250, spending: 0, startDate: '2026-09-05', endDate: '2026-10-04' },
};

(async () => {
  fs.mkdirSync('.next/ui-smoke', { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      let saved;
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/**', route => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname === '/api/auth/session') return route.fulfill({ json: { user: { displayName: 'Fixture owner' } } });
        if (pathname === '/api/dashboard') return route.fulfill({ json: fixture });
        if (pathname === '/api/connections') return route.fulfill({ json: { configured: false, connections: [] } });
        assert.equal(pathname, '/api/categories/cover-overspending', 'Unexpected API request');
        assert.equal(route.request().method(), 'POST');
        saved = route.request().postDataJSON();
        return route.fulfill({ json: { ok: true, categoriesFunded: 2, amount: 264 } });
      });
      for (const view of ['categories', 'allocations']) {
        await page.goto(base + '/#' + view);
        await page.getByRole('button', { name: 'Cover overspending', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Cover overspending', exact: true });
        await dialog.waitFor({ state: 'visible' });
        assert(await dialog.getByRole('searchbox').evaluate(input => input === document.activeElement), 'Search is focused on opening');
        assert.equal(await dialog.getByRole('checkbox').count(), 3, 'Only negative categories are offered');
        assert(await dialog.getByRole('button', { name: 'Allocate $0.00', exact: true }).isDisabled());
        await dialog.getByRole('checkbox', { name: /Dining/ }).check();
        await dialog.getByRole('searchbox').fill('groceries');
        await dialog.getByRole('checkbox', { name: /Groceries/ }).check();
        await dialog.getByText('Total allocation $264.00', { exact: true }).waitFor();
        await dialog.getByText('This will allocate $14.00 more than is currently available to assign.', { exact: true }).waitFor();
        assert(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), 'Dialog fits viewport');
        await page.screenshot({ path: `.next/ui-smoke/cover-overspending-${view}-${width}.png`, fullPage: true });
        await dialog.getByRole('button', { name: 'Allocate $264.00', exact: true }).click();
        await dialog.waitFor({ state: 'detached' });
        assert.deepEqual(saved.categoryIds.sort(), ['dining', 'groceries']);
        assert.match(saved.date, /^\d{4}-\d{2}-\d{2}$/);
        await page.getByText('$264.00 allocated to cover overspending in 2 categories', { exact: true }).waitFor();
      }
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`Cover overspending interaction passed at ${width}px in both views`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
