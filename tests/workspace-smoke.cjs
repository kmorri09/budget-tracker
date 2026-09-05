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
  accounts: [{ id: 'a', name: 'Sample checking', institution: 'Test bank', type: 'checking', ledgerBalance: 1200, openingBalance: 0, providerBalance: null, providerBalanceAt: null, syncEnabled: false }, { id: 'b', name: 'Sample card', institution: 'Test bank', type: 'credit_card', ledgerBalance: -150, openingBalance: 0, providerBalance: null, providerBalanceAt: null, syncEnabled: false }],
  categories: [{ id: 'c', name: 'Food', icon: '$', available: -20, target: 100, allocated: 100, spent: 120 }, { id: 'd', name: 'Travel', icon: '$', available: 200, target: 500, allocated: 300, spent: 100 }],
  activity: Array.from({ length: 60 }, (_, i) => ({ id: 't'+i, description: 'Sample purchase '+i, date: date(-i), account: i%2 ? 'Sample card' : 'Sample checking', category: i%2 ? 'Travel' : 'Food', kind: 'expense', amount: i+1, source: 'manual', status: 'posted', pending: i===0 })),
  allocations: [{ id: 'al', date: date(0), amount: 100, category: 'Food', note: 'Sample funding' }, { id: 'al2', date: date(-60), amount: -10, category: 'Travel', note: 'Sample move' }],
  reviews: [{ id: 'r', title: 'Sample import', kind: 'import_transaction', details: 'Fictitious review item' }],
  obligations: [], trailing30: { income: 500, spending: 200, startDate: date(-29), endDate: date(0) },
};
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
        saved = { path: pathname, body: route.request().postDataJSON() };
        return route.fulfill({ json: { ok: true } });
      });
      await page.goto(base);
      await page.getByRole('heading', { name: 'Hello, Sample owner' }).waitFor();
      const nav = page.getByRole('navigation', { name: width > 700 ? 'Primary navigation' : 'Mobile navigation', exact: true });
      await nav.getByRole('button', { name: 'Transactions', exact: true }).click();
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
      await table.getByLabel('Minimum net amount').fill('-10');
      await table.getByText('5 of 60 transactions', { exact: false }).waitFor();
      await table.locator('.sort-options').getByRole('button', { name: /^Amount/ }).click();
      if (width < 1050) {
        await table.getByRole('button', { name: 'Details', exact: true }).first().click();
        await table.locator('tr.row-expanded [data-label="Account"]').waitFor({ state: 'visible' });
      }
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow at '+width);
      await page.screenshot({ path: '.next/ui-smoke/transactions-'+width+'.png', fullPage: true });
      await nav.getByRole('button', { name: 'Categories', exact: true }).click();
      await page.getByRole('region', { name: 'Categories table', exact: true }).getByRole('button', { name: 'Food', exact: true }).click();
      await table.getByText('30 of 60 transactions', { exact: false }).waitFor();
      await nav.getByRole('button', { name: 'Allocations', exact: true }).click();
      const allocations = page.getByRole('region', { name: 'Allocations table', exact: true });
      await allocations.getByText('1 of 2 allocations', { exact: false }).waitFor();
      await allocations.getByRole('button', { name: 'All dates', exact: true }).click();
      await allocations.getByText('2 of 2 allocations', { exact: false }).waitFor();
      await page.getByRole('button', { name: '＋ Allocate money', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Amount', { exact: true }).fill('15');
      await dialog.getByLabel('Note', { exact: true }).fill('Sample funding');
      await dialog.getByLabel('Category', { exact: true }).fill('Food');
      assert.equal(await dialog.getByLabel('Date', { exact: true }).inputValue(), date(0));
      assert.equal(await dialog.locator('[name="accountId"]').count(), 0);
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
      assert.equal(saved.body.kind, 'allocation'); assert.equal(saved.body.categoryId, 'Food');
      await nav.getByRole('button', { name: 'Transactions', exact: true }).click();
      await page.getByRole('button', { name: '＋ Add transaction', exact: true }).click();
      await dialog.getByLabel('Amount', { exact: true }).fill('12.50');
      await dialog.getByLabel('Account', { exact: true }).fill('Sample checking');
      await dialog.getByLabel('Description', { exact: true }).fill('Sample entry');
      await dialog.getByLabel('Category', { exact: true }).fill('Food');
      await page.screenshot({ path: '.next/ui-smoke/form-'+width+'.png' });
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
      assert.equal(saved.body.accountId, 'Sample checking'); assert.equal(saved.body.date, date(0));
      await page.getByRole('button', { name: 'Accounts and settings', exact: true }).click();
      await page.getByRole('heading', { name: 'Workspace settings', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Reconcile balance', exact: true }).first().click();
      await page.getByRole('spinbutton').filter({ visible: true }).fill('250');
      await page.getByRole('button', { name: 'Force reconcile', exact: true }).waitFor();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No accounts overflow at '+width);
      await page.screenshot({ path: '.next/ui-smoke/accounts-'+width+'.png', fullPage: true });
      await nav.getByRole('button', { name: 'Home', exact: true }).click();
      await page.screenshot({ path: '.next/ui-smoke/home-'+width+'.png', fullPage: true });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No home overflow at '+width);
      await nav.getByRole('button', { name: 'Review', exact: false }).click();
      page.once('dialog', dialog => dialog.dismiss());
      await page.getByRole('button', { name: 'Resolve all (1)', exact: true }).click();
      assert.notEqual(saved.path, '/api/reviews', 'Cancel does not resolve reviews');
      page.once('dialog', dialog => dialog.accept());
      await page.getByRole('button', { name: 'Resolve all (1)', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'Review updated' }).waitFor();
      assert.deepEqual(saved.body, { all: true, status: 'resolved' });
      await page.getByRole('button', { name: '＋ Add', exact: true }).click();
      await page.getByRole('button', { name: 'Add category', exact: true }).click();
      await dialog.getByLabel('Category name', { exact: true }).fill('Sample category');
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
      assert.equal(saved.path, '/api/categories');
      await page.getByRole('button', { name: '＋ Add', exact: true }).click();
      await page.getByRole('button', { name: 'Add account', exact: true }).click();
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
