// Local regression for zero amounts and disabled button explanations. All API calls use fixtures.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.UI_TEST_URL || 'http://localhost:3111';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const now = new Date();
const date = [now.getFullYear(), String(now.getMonth()+1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
const categories = [
  { id: 'room', name: 'Ruoom', available: -150 },
  { id: 'insurance', name: 'Insurance', available: 0 },
  { id: 'fees', name: 'Card Fees', available: 30 },
].map(category => ({ ...category, active: true, icon: '', target: 0, allocated: 0, spent: 0 }));
const obligations = [
  { id: 'skip', name: 'Capital One Business Steph', categoryId: 'room', expectedAmount: 0 },
  { id: 'skip-2', name: 'Phone backup', categoryId: 'room', expectedAmount: 0 },
  { id: 'skip-3', name: 'Cloud storage', categoryId: 'room', expectedAmount: 0 },
  { id: 'fund', name: 'Prudential Whole', categoryId: 'insurance', expectedAmount: 105 },
  { id: 'covered', name: 'Citi Balance Steph', categoryId: 'fees', expectedAmount: 25 },
  { id: 'skip-4', name: 'Streaming', categoryId: 'room', expectedAmount: 0 },
  { id: 'skip-5', name: 'Gym', categoryId: 'room', expectedAmount: 0 },
].map(item => ({ ...item, amount: 100, amountSource: 'planned', category: categories.find(c => c.id === item.categoryId).name, account: 'Checking', accountId: 'checking', dueDate: date, nextChargeDate: date, cadence: 'Monthly', active: true, covered: false, coveredBy: null, lastCharge: null, previousCharge: null, suggestion: null, dismissedMatches: [] }));
const fixture = {
  ledgerBalance: 500, providerBalance: null, remainingToBudget: 500, allocationPercent: 0,
  availableBreakdown: { income: 500, adjustments: 0, allocations: 0, available: 500 },
  availableAdjustments: [], accounts: [], managedAccounts: [], categories, managedCategories: categories,
  activity: [], allocations: [], payments: [], reviews: [], categorizationRules: [], obligations,
  trailing30: { income: 500, spending: 0, startDate: date, endDate: date },
};

(async () => {
  fs.mkdirSync('.next/ui-smoke', { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errors = [];
      let saved;
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/**', route => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname === '/api/auth/session') return route.fulfill({ json: { user: { displayName: 'Fixture owner' } } });
        if (pathname === '/api/dashboard') return route.fulfill({ json: fixture });
        if (pathname === '/api/connections') return route.fulfill({ json: { configured: false, connections: [] } });
        assert.equal(pathname, '/api/obligations/fund');
        saved = route.request().postDataJSON();
        return route.fulfill({ json: { ok: true, categoriesFunded: 1, amount: 105 } });
      });
      await page.goto(base + '/#allocations');
      await page.getByRole('button', { name: 'Fund upcoming obligations', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Fund upcoming obligations', exact: true });
      const submit = dialog.locator('.form-footer .primary-button');
      const prudential = dialog.getByRole('spinbutton', { name: 'Amount for Prudential Whole', exact: true });
      const citi = dialog.getByRole('spinbutton', { name: 'Amount for Citi Balance Steph', exact: true });
      assert(await submit.isEnabled(), 'A selected zero amount does not block positive obligations');
      assert(await dialog.evaluate(element => element.scrollWidth === element.clientWidth), 'Dialog has no horizontal scrollbar');
      assert.equal(await dialog.locator('.obligation-list').evaluate(list => list.scrollHeight > list.clientHeight), false, 'Obligations do not have a nested scroll area');
      await dialog.getByText('Total allocation $105.00', { exact: true }).waitFor();
      for (const value of ['', '-5', '21474836.48', '1.001']) {
        await prudential.fill(value);
        assert(await submit.isDisabled());
        const reason = dialog.locator('#' + (await submit.getAttribute('aria-describedby')).replaceAll(':', '\\:'));
        assert((await reason.textContent()).includes('Prudential Whole'), 'Reason identifies the invalid obligation');
        assert.equal(await prudential.getAttribute('aria-invalid'), 'true');
      }
      await page.screenshot({ path: `.next/ui-smoke/obligation-disabled-${width}.png`, fullPage: true });
      await prudential.fill('0');
      assert(await submit.isDisabled());
      await dialog.getByText('These obligations are already covered by their categories’ available balances. No additional allocation is needed.', { exact: true }).waitFor();
      await citi.fill('0');
      await dialog.getByText('All selected amounts are $0, so there is nothing to allocate. Enter a positive amount or select another obligation.', { exact: true }).waitFor();
      await prudential.fill('105'); await citi.fill('25');
      await dialog.getByLabel('Allocation date', { exact: true }).fill('');
      assert(await submit.isDisabled());
      await dialog.getByText('Choose an allocation date.', { exact: true }).waitFor();
      await dialog.getByLabel('Allocation date', { exact: true }).fill(date);
      await dialog.getByRole('button', { name: 'Clear this window', exact: true }).click();
      assert(await submit.isDisabled());
      await dialog.getByText('Select at least one obligation to allocate money.', { exact: true }).waitFor();
      await dialog.getByRole('button', { name: 'Select all 7', exact: true }).click();
      assert(await submit.isEnabled());
      await submit.click();
      await dialog.waitFor({ state: 'detached' });
      assert.deepEqual(saved, { date, obligations: [{ id: 'skip', amountCents: 0 }, { id: 'skip-2', amountCents: 0 }, { id: 'skip-3', amountCents: 0 }, { id: 'fund', amountCents: 10500 }, { id: 'covered', amountCents: 2500 }, { id: 'skip-4', amountCents: 0 }, { id: 'skip-5', amountCents: 0 }] });
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`Obligation funding zero override and disabled explanations passed at ${width}px`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
