// Local UI check with fictitious records; every API request is intercepted.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.UI_TEST_URL || 'http://localhost:3111';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const entry = { id: 'removed-entry', description: 'Han Yang Market', amount: 17.98, kind: 'expense', source: 'plaid', status: 'removed', pending: false, date: '2026-09-14', category: 'Groceries', categoryId: 'food', account: '360 Checking', accountId: 'checking', paymentStatus: 'Not applicable', remainingToPay: 17.98 };
const bank = { id: 'bank-entry', date: entry.date, description: entry.description, kind: 'expense', amountCents: 1798, signedCents: -1798, pending: false, removedByProvider: true, linkedToApp: true };
const review = { id: 'removal-review', kind: 'provider_posted_removal', title: 'Check removed posted entry: Han Yang Market', details: 'Plaid reported this posted entry as removed.', transaction: null, removedTransaction: entry, suggestion: null };
const fixture = {
  ledgerBalance: 46.21, providerBalance: 28.23, remainingToBudget: 0, allocationPercent: 0,
  availableBreakdown: { income: 0, adjustments: 0, allocations: 0, available: 0 },
  availableAdjustments: [], accounts: [], managedAccounts: [], categories: [], managedCategories: [],
  activity: [], allocations: [], payments: [], categorizationRules: [], obligations: [],
  trailing30: { income: 0, spending: 0, startDate: '2026-09-05', endDate: '2026-10-04' },
};

(async () => {
  fs.mkdirSync('.next/ui-smoke', { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [1280, 390]) {
      for (const choice of ['restore', 'accept']) {
        const page = await browser.newPage({ viewport: { width, height: 1000 } });
        const mutations = [], errors = [];
        let resolved = false, restored = false;
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/api/**', route => {
          const url = new URL(route.request().url());
          if (url.pathname === '/api/auth/session') return route.fulfill({ json: { user: { displayName: 'Fixture owner' } } });
          if (url.pathname === '/api/dashboard') return route.fulfill({ json: { ...fixture, reviews: resolved ? [] : [review] } });
          if (url.pathname === '/api/connections') return route.fulfill({ json: { configured: false, connections: [] } });
          if (url.pathname === '/api/account-reconciliation') {
            assert.equal(url.searchParams.get('accountId'), 'checking');
            return route.fulfill({ json: {
              account: { id: 'checking', name: '360 Checking', type: 'checking', openingBalanceCents: 0, providerBalanceCents: 2823, providerBalanceAt: null, ledgerBalanceCents: restored ? 2823 : 4621 },
              differenceCents: restored ? 0 : -1798, breakdown: { openingBalanceCents: 0, transactionCents: restored ? 2823 : 4621, cardPaymentCents: 0 },
              providerAccounts: [], connections: [], bankActivity: [bank], malformedProviderRows: 0, possibleDuplicates: [], linkedBankDifferences: [],
              ledgerEntries: [{ ...entry, amountCents: 1798, signedCents: -1798, excluded: !restored, linkedToBank: true, confirmedRestoration: restored, paymentEvidence: null }],
              removedPostedBankEntries: restored ? [] : [{ entryId: entry.id, description: entry.description, appSignedCents: -1798, bank }],
            } });
          }
          const body = route.request().postDataJSON();
          mutations.push({ path: url.pathname, method: route.request().method(), body });
          assert(['/api/entries/restore', '/api/reviews'].includes(url.pathname), 'Unexpected write');
          restored = url.pathname === '/api/entries/restore';
          resolved = true;
          return route.fulfill({ json: { ok: true } });
        });
        await page.goto(base + '/#review');
        const item = page.locator('.review-item');
        await item.getByText('Next: check your bank statement', { exact: true }).waitFor();
        await item.getByText('360 Checking', { exact: true }).waitFor();
        await item.getByText(entry.date, { exact: true }).waitFor();
        assert.equal(await item.getByRole('button', { name: /^Edit|Already represented/ }).count(), 0, 'Removed entries are not offered active ledger edits');
        await page.screenshot({ path: `.next/ui-smoke/removed-review-${width}-${choice}.png`, fullPage: true });
        if (choice === 'restore') {
          await item.getByRole('button', { name: 'Investigate removal', exact: true }).click();
          const investigation = page.getByRole('dialog', { name: 'Investigate balance difference', exact: true });
          await investigation.getByRole('button', { name: 'Restore original', exact: true }).click();
          const confirm = page.getByRole('dialog', { name: 'Restore Han Yang Market?', exact: true });
          await confirm.locator('.form-footer').getByRole('button', { name: 'Cancel', exact: true }).click();
          assert.deepEqual(mutations, [], 'Opening and canceling restoration do not change records');
          await investigation.getByRole('button', { name: 'Restore original', exact: true }).click();
          await confirm.getByRole('button', { name: 'Confirmed — restore', exact: true }).click();
          await investigation.getByText('Han Yang Market restored; original category and bank link retained.', { exact: true }).waitFor();
          await investigation.getByRole('button', { name: 'Close account investigation', exact: true }).click();
          assert.deepEqual(mutations, [{ path: '/api/entries/restore', method: 'POST', body: { id: entry.id, confirmPosted: true } }]);
        } else {
          await item.getByRole('button', { name: 'Accept removal', exact: true }).click();
          const confirm = page.getByRole('dialog', { name: 'Accept this bank removal?', exact: true });
          await confirm.locator('.form-footer').getByRole('button', { name: 'Cancel', exact: true }).click();
          assert.deepEqual(mutations, [], 'Canceling acceptance keeps the reminder');
          await item.getByRole('button', { name: 'Accept removal', exact: true }).click();
          await confirm.getByRole('button', { name: 'Accept removal', exact: true }).click();
          await page.getByText('Nothing needs review right now.', { exact: true }).waitFor();
          assert.deepEqual(mutations, [{ path: '/api/reviews', method: 'PATCH', body: { id: review.id, status: 'resolved' } }]);
        }
        await page.getByText('Nothing needs review right now.', { exact: true }).waitFor();
        assert.deepEqual(errors, []);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow');
        await page.close();
      }
      console.log(`Removed review restore and accept flows passed at ${width}px`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
