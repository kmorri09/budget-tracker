// Run against a local dev server only. Every API request is intercepted with fictitious data.
// PLAYWRIGHT_MODULE may point to a shared Playwright installation.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.UI_TEST_URL || 'http://localhost:3100';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Use a local test server');
const date = offset => { const d = new Date(); d.setDate(d.getDate() + offset); return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-'); };
const fixture = {
  ledgerBalance: 1200, providerBalance: null, remainingToBudget: 250, allocationPercent: 50,
  accounts: [{ id: 'a', name: 'Sample checking', institution: 'Test bank', type: 'checking', ledgerBalance: 1200, openingBalance: 0, providerBalance: null, providerBalanceAt: null, syncEnabled: false, isDefaultCash: true, active: true }, { id: 'b', name: 'Sample card', institution: 'Test bank', type: 'credit_card', ledgerBalance: -150, openingBalance: 0, providerBalance: null, providerBalanceAt: null, syncEnabled: false, isDefaultCash: false, active: true }],
  categories: [{ id: 'c', name: 'Food', icon: '$', available: -20, target: 100, allocated: 100, spent: 120, active: true }, { id: 'd', name: 'Travel', icon: '$', available: 200, target: 500, allocated: 300, spent: 100, active: true }],
  activity: Array.from({ length: 60 }, (_, i) => ({ id: 't'+i, description: 'Sample purchase '+i, date: date(-i), account: i%2 ? 'Sample card' : 'Sample checking', accountId: i%2 ? 'b' : 'a', category: i%2 ? 'Travel' : 'Food', categoryId: i%2 ? 'd' : 'c', kind: 'expense', amount: i+1, source: 'manual', status: 'posted', pending: i===0, paymentStatus: i%2 ? 'Unpaid' : 'Not applicable', remainingToPay: i%2 ? i+1 : 0 })),
  allocations: [{ id: 'al', date: date(0), amount: 100, category: 'Food', categoryId: 'c', note: 'Sample funding' }, { id: 'al2', date: date(-60), amount: -10, category: 'Travel', categoryId: 'd', note: 'Sample move' }],
  availableBreakdown: { income: 500, adjustments: 0, allocations: 250, available: 250 }, availableAdjustments: [], payments: [],
  reviews: [{ id: 'r', title: 'Sample import', kind: 'import_transaction', details: 'Fictitious review item' }],
  categorizationRules: [],
  obligations: [], trailing30: { income: 500, spending: 200, startDate: date(-29), endDate: date(0) },
};
fixture.managedAccounts = fixture.accounts;
fixture.managedCategories = fixture.categories;
fixture.reviews[0].transaction = { ...fixture.activity[0], source: 'plaid' };
async function navigateTo(page, nav, width, name) {
  const moreDestinations = new Set(['Card payments', 'Allocations', 'Obligations', 'Accounts']);
  if (width <= 700 && moreDestinations.has(name)) {
    await nav.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('menu', { name: 'More destinations', exact: true }).getByRole('menuitem', { name, exact: true }).click();
    return;
  }
  await nav.getByRole('button', { name, exact: name !== 'Review' }).click();
}
async function run() {
  fs.mkdirSync(path.join('.next', 'ui-smoke'), { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      let saved;
      await page.route('**/api/**', route => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname === '/api/auth/session') return route.fulfill({ json: { required: true, configured: true, user: { displayName: 'Sample owner' } } });
        if (pathname === '/api/dashboard') return route.fulfill({ json: fixture });
        if (pathname === '/api/connections' && route.request().method() === 'GET') return route.fulfill({ json: { configured: false, connections: [] } });
        saved = { path: pathname, body: route.request().postDataJSON() };
        return route.fulfill({ json: { ok: true } });
      });
      await page.goto(base);
      await page.getByRole('heading', { name: 'Hello, Sample owner' }).waitFor();
      await page.getByText('Available to assign', { exact: true }).first().waitFor();
      const nav = page.getByRole('navigation', { name: width > 700 ? 'Primary navigation' : 'Mobile navigation', exact: true });
      if (width <= 700) {
        assert.equal(await nav.getByRole('button').count(), 5, 'Mobile navigation keeps five comfortably sized destinations');
        assert((await nav.getByRole('button').first().evaluate(element => element.getBoundingClientRect().width)) >= 60, 'Mobile navigation targets remain comfortably wide');
      }
      await navigateTo(page, nav, width, 'Transactions');
      const table = page.getByRole('region', { name: 'Transactions table', exact: true });
      await table.getByText('30 of 60 transactions', { exact: false }).waitFor();
      await table.getByRole('button', { name: 'All dates', exact: true }).click();
      await table.getByText('60 of 60 transactions', { exact: false }).waitFor();
      await table.getByRole('button', { name: 'Next', exact: true }).click();
      await table.getByText('Page 2 of 3', { exact: false }).waitFor();
      await table.getByRole('searchbox', { name: 'Search Transactions', exact: true }).fill('purchase 59');
      await table.getByText('1 of 60 transactions', { exact: false }).waitFor();
      await table.getByRole('button', { name: 'Reset filters', exact: true }).click();
      await table.locator('summary').filter({ hasText: /^Account/ }).click();
      await table.getByRole('searchbox', { name: 'Search Account', exact: true }).fill('checking');
      await table.getByLabel('Sample checking', { exact: true }).check();
      await table.locator('summary').filter({ hasText: /^Account/ }).click();
      await table.getByText('30 of 60 transactions', { exact: false }).waitFor();
      await table.getByRole('button', { name: 'Filters & sort', exact: true }).click();
      await table.locator('summary').filter({ hasText: /^Net amount/ }).click();
      await table.getByLabel('Minimum', { exact: true }).fill('-10');
      await table.getByText('5 of 60 transactions', { exact: false }).waitFor();
      await table.locator('summary').filter({ hasText: /^Net amount/ }).click();
      await table.locator('.sort-options').getByRole('button', { name: /^Amount/ }).click();
      if (width < 1050) {
        await table.getByRole('button', { name: 'Details', exact: true }).first().click();
        await table.locator('tr.row-expanded [data-label="Account"]').waitFor({ state: 'visible' });
      }
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow at '+width);
      await page.screenshot({ path: '.next/ui-smoke/transactions-'+width+'.png', fullPage: true });
      const dialog = page.getByRole('dialog');
      await navigateTo(page, nav, width, 'Categories');
      const categoryTable = page.getByRole('region', { name: 'Categories table', exact: true });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No categories overflow at '+width);
      await page.screenshot({ path: '.next/ui-smoke/categories-'+width+'.png', fullPage: true });
      await categoryTable.getByRole('button', { name: 'Edit Food', exact: true }).click();
      await dialog.getByLabel('Category name', { exact: true }).fill('Food and groceries');
      await dialog.getByLabel('Target amount', { exact: true }).fill('175');
      await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
      assert.equal(saved.path, '/api/categories'); assert.equal(saved.body.id, 'c'); assert.equal(saved.body.name, 'Food and groceries');
      await page.getByRole('button', { name: 'Reconcile balances', exact: true }).click();
      await dialog.getByLabel('Desired balance for Food', { exact: true }).fill('75.94');
      await dialog.getByText('$95.94 adjustment', { exact: false }).waitFor();
      await dialog.getByRole('button', { name: 'Apply entered balances', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
      assert.equal(saved.path, '/api/categories/reconcile'); assert.deepEqual(saved.body.balances, [{ id: 'c', available: 75.94 }]);
      await categoryTable.getByRole('button', { name: 'View transactions Food', exact: true }).click();
      await table.getByText('30 of 60 transactions', { exact: false }).waitFor();
      await navigateTo(page, nav, width, 'Allocations');
      const allocations = page.getByRole('region', { name: 'Allocations table', exact: true });
      await allocations.getByText('1 of 2 allocations', { exact: false }).waitFor();
      await allocations.getByRole('button', { name: 'All dates', exact: true }).click();
      await allocations.getByText('2 of 2 allocations', { exact: false }).waitFor();
      await page.getByRole('button', { name: '＋ Allocate money', exact: true }).click();
      await dialog.getByLabel('Amount', { exact: true }).fill('15');
      await dialog.getByLabel('Note', { exact: true }).fill('Sample funding');
      await dialog.getByLabel('Category', { exact: true }).fill('Food');
      assert.equal(await dialog.getByLabel('Date', { exact: true }).inputValue(), date(0));
      assert.equal(await dialog.locator('[name="accountId"]').count(), 0);
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
      assert.equal(saved.body.kind, 'allocation'); assert.equal(saved.body.categoryId, 'Food');
      await navigateTo(page, nav, width, 'Transactions');
      await page.getByRole('button', { name: '＋ Add transaction', exact: true }).click();
      await dialog.getByLabel('Amount', { exact: true }).fill('12.50');
      await dialog.getByLabel('Account', { exact: true }).fill('Sample checking');
      await dialog.getByLabel('Description', { exact: true }).fill('Sample entry');
      await dialog.getByLabel('Category', { exact: true }).fill('Food');
      await dialog.getByRole('option', { name: 'Food', exact: true }).click();
      await page.screenshot({ path: '.next/ui-smoke/form-'+width+'.png' });
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
      assert.equal(saved.body.accountId, 'Sample checking'); assert.equal(saved.body.date, date(0));
      await navigateTo(page, nav, width, 'Accounts');
      await page.getByRole('heading', { name: 'Workspace settings', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Reconcile balance', exact: true }).first().click();
      await page.getByRole('spinbutton').filter({ visible: true }).fill('250');
      await page.getByRole('button', { name: 'Force reconcile', exact: true }).waitFor();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No accounts overflow at '+width);
      await page.screenshot({ path: '.next/ui-smoke/accounts-'+width+'.png', fullPage: true });
      await navigateTo(page, nav, width, 'Home');
      await page.screenshot({ path: '.next/ui-smoke/home-'+width+'.png', fullPage: true });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No home overflow at '+width);
      await navigateTo(page, nav, width, 'Review');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No review overflow at '+width);
      if (width <= 700) {
        const reviewItem = page.locator('.review-item').first();
        const itemBox = await reviewItem.evaluate(element => { const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right }; });
        const actionsFit = await reviewItem.locator('.review-item-actions > button').evaluateAll((buttons, box) => buttons.every(button => {
          const rect = button.getBoundingClientRect();
          return rect.left >= box.left && rect.right <= box.right;
        }), itemBox);
        assert(actionsFit, 'Review actions stay inside their card');
      }
      await page.screenshot({ path: '.next/ui-smoke/review-'+width+'.png', fullPage: true });
      await page.getByRole('button', { name: 'Mark all reviewed (1)', exact: true }).click();
      await dialog.locator('.secondary-button').getByText('Cancel', { exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      assert.notEqual(saved.path, '/api/reviews', 'Cancel does not resolve reviews');
      await page.getByRole('button', { name: 'Mark all reviewed (1)', exact: true }).click();
      await dialog.getByRole('button', { name: 'Resolve all', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'Review updated' }).waitFor();
      assert.deepEqual(saved.body, { all: true, status: 'resolved' });
      await navigateTo(page, nav, width, 'Categories');
      await page.getByRole('button', { name: '＋ Category', exact: true }).click();
      await dialog.getByLabel('Category name', { exact: true }).fill('Sample category');
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
      assert.equal(saved.path, '/api/categories');
      await navigateTo(page, nav, width, 'Accounts');
      await page.getByRole('button', { name: '＋ Add account', exact: true }).click();
      await dialog.getByLabel('Account name', { exact: true }).fill('Sample savings');
      await dialog.getByLabel('Bank or provider', { exact: true }).fill('Sample bank');
      await dialog.getByLabel('Savings', { exact: true }).check();
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
      assert.equal(saved.path, '/api/accounts'); assert.equal(saved.body.type, 'savings');
      assert.deepEqual(errors, []);
      console.log('PASS desktop/mobile flows at width '+width);
      await page.close();
    }
    const page = await browser.newPage();
    await page.route('**/api/auth/session', route => route.fulfill({ json: { user: { displayName: 'Sample' }, required: true } }));
    await page.route('**/api/dashboard', route => route.fulfill({ status: 500, json: { error: 'Test failure' } }));
    await page.goto(base);
    await page.getByRole('alert').filter({ hasText: 'could not be loaded' }).waitFor();
    assert.equal(await page.getByText('$100.00', { exact: true }).count(), 0, 'No fabricated balance fallback');
    await page.route('**/api/dashboard', route => route.fulfill({ json: { ...fixture, accounts: [], categories: [], activity: [], allocations: [], reviews: [], ledgerBalance: 0 } }));
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.getByRole('button', { name: 'All transactions →', exact: true }).click();
    await page.getByRole('heading', { name: 'Nothing here yet', exact: true }).waitFor();
    await page.getByRole('button', { name: '＋ Add transaction', exact: true }).click();
    await page.getByRole('dialog').getByText('Create an account first, then return here.', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    console.log('PASS failed load, retry, empty states, and missing-account guard');
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
