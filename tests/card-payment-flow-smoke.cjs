// Browser regression uses a local server and intercepted fixtures only.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.UI_TEST_URL || 'http://localhost:3111';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const date = n => { const d = new Date(); d.setDate(d.getDate() + n); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); };
function fixture() {
  const accounts = [
    { id: 'cash', name: 'Cash', type: 'savings', ledgerBalance: 1000, providerAvailableBalance: 1000, isDefaultCash: true },
    { id: 'card', name: 'Amex Gold', type: 'credit_card', ledgerBalance: -439.20 },
  ].map(a => ({ ...a, institution: 'Fixture', active: true, openingBalance: 0, providerBalance: a.ledgerBalance, providerBalanceAt: new Date().toISOString(), syncEnabled: true }));
  const categories = [{ id: 'travel', name: 'Travel', available: 259.20, allocated: 698.40 }, { id: 'rent', name: 'Rent', available: 400, allocated: 400 }].map(c => ({ ...c, active: true, icon: '', target: 0, spent: 0 }));
  const activity = [
    { id: 'full', description: 'Refunded airline purchase', amount: 140.01, remainingToPay: 0, refunded: 140.01, paymentStatus: 'Refunded' },
    { id: 'partial', description: 'Airline purchase', amount: 558.39, remainingToPay: 439.20, refunded: 119.19, paymentStatus: 'Partially refunded' },
    { id: 'refund', description: 'Airline refund', kind: 'refund', amount: 140.01, remainingToPay: 0, paymentStatus: 'Not applicable' },
  ].map(t => ({ kind: 'expense', ...t, date: date(-2), status: 'posted', pending: false, categoryId: 'travel', category: 'Travel', accountId: 'card', account: 'Amex Gold', source: 'manual', coverageLinks: [] }));
  return { paymentReviewToken: 'fixture-token', accounts, managedAccounts: accounts, categories, managedCategories: categories, activity, payments: [], allocations: [], availableAdjustments: [], availableBreakdown: { income: 1000, adjustments: 0, allocations: 659.20, available: 0 }, remainingToBudget: 0, ledgerBalance: 1000, providerBalance: 1000, allocationPercent: 66, reviews: [], obligations: [], categorizationRules: [], trailing30: { income: 1000, spending: 439.20, startDate: date(-29), endDate: date(0) }, refundReviews: [{ id: 'refund', description: 'Airline refund', account: 'Amex Gold', date: date(-1), amount: 140.01, remaining: 0, links: [{ transactionId: 'full', description: 'Refunded airline purchase', date: date(-2), amount: 140.01, confidence: 'automatic' }], candidates: [] }] };
}
(async () => {
  fs.mkdirSync('.next/ui-smoke', { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  let currentPage;
  try {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      currentPage = page;
      page.setDefaultTimeout(10000);
      const errors = [], requests = []; let data = fixture();
      page.on('pageerror', error => { errors.push(error.message); console.error('Browser error:', error.stack); });
      await page.route('**/api/**', async route => {
        const request = route.request(); const url = new URL(request.url());
        if (url.pathname === '/api/auth/session') return route.fulfill({ json: { user: { displayName: 'Fixture' } } });
        if (url.pathname === '/api/dashboard') return route.fulfill({ json: data });
        if (url.pathname === '/api/connections') return route.fulfill({ json: { configured: false, connections: [] } });
        if (url.pathname === '/api/reviews') return route.fulfill({ json: { reviews: [] } });
        if (url.pathname === '/api/card-refunds') { requests.push(request.postDataJSON()); return route.fulfill({ json: { ok: true } }); }
        if (url.pathname === '/api/card-payments') {
          requests.push(request.postDataJSON());
          data.activity.find(t => t.id === 'partial').remainingToPay = 300;
          data.paymentReviewToken = 'new-token';
          return route.fulfill({ status: 409, json: { error: 'Your budget changed. Review again.' } });
        }
        return route.fulfill({ json: {} });
      });
      await page.goto(base + '/#transactions');
      await page.getByRole('button', { name: 'Suggest card payment', exact: true }).click();
      let dialog = page.getByRole('dialog', { name: 'Suggest card payment' });
      await dialog.getByRole('button', { name: 'Review payment', exact: true }).waitFor({ state: 'visible' });
      await page.waitForFunction(() => { const b = [...document.querySelectorAll('dialog button')].find(b => b.textContent === 'Review payment'); return b && !b.disabled; });
      assert.match(await dialog.innerText(), /Suggest \$340\.80/);
      assert.match(await dialog.innerText(), /only money already allocated/);
      assert.match(await dialog.innerText(), /leaves allocations unchanged/);
      await dialog.evaluate(node => { node.scrollTop = 0; });
      await page.screenshot({ path: `.next/ui-smoke/payment-overview-${width}.png` });
      assert.match(await dialog.getByRole('region', { name: 'Suggested payment total', exact: true }).innerText(), /\$340\.80/);
      assert.match(await dialog.getByRole('region', { name: 'Category allocation check', exact: true }).innerText(), /\$439\.20/);
      assert.match(await dialog.getByRole('region', { name: 'Cash check', exact: true }).innerText(), /\$340\.80/);
      assert.match(await dialog.innerText(), /\$98\.40 of eligible purchases must wait/);
      await dialog.getByText('How the cash limit is calculated', { exact: true }).click();
      assert.match(await dialog.innerText(), /Less: protected category balances\s*−\$659\.20/);
      assert.match(await dialog.innerText(), /not extra spending money/);
      assert(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth), 'Preview should fit without horizontal scrolling');
      await dialog.getByText('How the cash limit is calculated', { exact: true }).click();
      await dialog.getByText('View charges included in this payment').click();
      assert(!await dialog.getByText('Refunded airline purchase', { exact: true }).count());
      assert(!/\$0\.00 now/.test(await dialog.innerText()));
      await dialog.getByText('Deferred by cash limit (1)', { exact: true }).click();
      assert.match(await dialog.innerText(), /\$98\.40 deferred/);
      assert.match(await dialog.innerText(), /not included in this payment/);
      await page.screenshot({ path: `.next/ui-smoke/payment-preview-${width}.png`, fullPage: true });
      await dialog.getByRole('button', { name: 'Review payment', exact: true }).click();
      dialog = page.getByRole('dialog', { name: 'Record card payment', exact: true });
      await page.waitForFunction(() => { const b = [...document.querySelectorAll('dialog button')].find(b => b.textContent === 'Save'); return b && !b.disabled; });
      assert.equal(await dialog.getByLabel('Amount', { exact: true }).inputValue(), '340.80');
      assert.match(await dialog.innerText(), /Maximum payment preserving allocations\s*\$340\.80/);
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      await dialog.getByText('Funding, refunds, or coverage have changed.', { exact: false }).waitFor();
      assert.equal(await dialog.getByRole('button', { name: 'Save', exact: true }).isDisabled(), true);
      assert.equal(requests[0].reviewToken, 'fixture-token');
      assert.equal(requests[0].applications[0].amount, 340.80);
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.getByRole('button', { name: 'Edit Airline refund', exact: true }).click();
      dialog = page.getByRole('dialog', { name: 'Edit refund', exact: true });
      await dialog.getByRole('heading', { name: 'Refund coverage', exact: true }).waitFor();
      assert.match(await dialog.innerText(), /\$140\.01 \(automatic\)/);
      await page.screenshot({ path: `.next/ui-smoke/refund-review-${width}.png`, fullPage: true });
      await dialog.getByRole('button', { name: 'Remove match', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(requests[1].status, 'dismissed');
      assert.equal(requests[1].refundId, 'refund');
      assert.deepEqual(errors, []);
      console.log(`Payment preview, stale save, and refund review passed at ${width}px`);
      await page.close();
    }
  } catch (error) { if (currentPage) { console.error("UI at failure:", currentPage.url(), (await currentPage.locator("body").innerText()).slice(0, 5500)); await currentPage.screenshot({ path: ".next/ui-smoke/payment-flow-failure.png", fullPage: true }); } throw error; } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
