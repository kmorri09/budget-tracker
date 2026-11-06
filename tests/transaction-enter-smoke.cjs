// Browser checks use intercepted fixtures; no live budget data is changed.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const base = process.env.UI_TEST_URL || 'http://127.0.0.1:3112';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const date = new Date().toISOString().slice(0, 10);
const account = { id: 'cash', name: 'Cash', institution: 'Fixture', type: 'checking', active: true, ledgerBalance: 500, openingBalance: 500, providerBalance: null, providerBalanceAt: null };
const categories = ['Dining', 'Groceries'].map((name, i) => ({ id: String(i), name, icon: '', active: true, target: 0, allocated: 50, spent: 0, available: 50 }));
const transaction = { id: 'entry', description: 'Lunch', amount: 11.23, date, kind: 'expense', source: 'plaid', status: 'posted', pending: false, account: 'Cash', accountId: 'cash', category: null, categoryId: null, paymentStatus: 'Not applicable', remainingToPay: 0 };
const data = { paymentReviewToken: 'fixture', accounts: [account], managedAccounts: [account], categories, managedCategories: categories, activity: [transaction], payments: [], allocations: [], availableAdjustments: [], availableBreakdown: { income: 500, adjustments: 0, allocations: 100, available: 400 }, remainingToBudget: 400, ledgerBalance: 500, providerBalance: null, allocationPercent: 20, reviews: [{ id: 'review', kind: 'bank_transaction', title: 'Review lunch', details: 'Choose category', transaction }], obligations: [], categorizationRules: [], trailing30: { income: 500, spending: 11.23, startDate: date, endDate: date }, refundReviews: [] };

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const requests = [], errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/**', route => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/api/auth/session') return route.fulfill({ json: { user: { displayName: 'Fixture' } } });
        if (path === '/api/dashboard') return route.fulfill({ json: data });
        if (path === '/api/connections') return route.fulfill({ json: { configured: false, connections: [] } });
        if (path === '/api/entries') { requests.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true } }); }
        return route.fulfill({ json: {} });
      });
      await page.goto(base + '/#review');
      await page.getByRole('button', { name: 'Edit transaction', exact: true }).click();
      let dialog = page.getByRole('dialog', { name: 'Edit transaction' });
      const category = dialog.getByRole('combobox', { name: 'Category' });
      await category.fill('Groceries');
      await category.press('ArrowDown');
      await category.press('Enter');
      assert.equal(requests.length, 0, 'Choosing the highlighted option must not save');
      assert.equal(await category.inputValue(), 'Groceries');
      await category.press('Enter');
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(requests[0].categoryId, '1');
      assert.equal(requests[0].approveReview, true, 'Second Enter must approve');
      await page.getByRole('button', { name: 'Edit transaction', exact: true }).click();
      dialog = page.getByRole('dialog', { name: 'Edit transaction' });
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(requests[1].approveReview, false, 'Explicit Save must remain separate');
      data.reviews = [];
      await page.goto(base + '/#transactions');
      await page.reload();
      await page.getByRole('heading', { name: 'Transactions', exact: true }).first().waitFor();
      await page.getByRole('button', { name: 'All dates', exact: true }).click();
      const lunchRow = page.getByRole('row').filter({ hasText: 'Lunch' });
      await lunchRow.getByRole('button', { name: /Edit/ }).click();
      dialog = page.getByRole('dialog', { name: 'Edit transaction' });
      assert.equal(await dialog.getByRole('button', { name: 'Save and Approve' }).count(), 0);
      await dialog.getByLabel('Description', { exact: true }).press('Enter');
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(requests[2].approveReview, false, 'Without a review Enter must still save');
      assert.deepEqual(errors, []);
      await page.close();
      data.reviews = [{ id: 'review', kind: 'bank_transaction', title: 'Review lunch', details: 'Choose category', transaction }];
      console.log(`Transaction Enter behavior passed at ${width}px`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
