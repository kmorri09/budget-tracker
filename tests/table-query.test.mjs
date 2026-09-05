import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queryRows } from '../lib/table-query.ts';
import { signedAmount } from '../lib/workspace-types.ts';

const rows = [
  { id: 'a', name: 'Coffee', date: '2026-08-01', category: 'Food', account: 'Checking', amount: -10 },
  { id: 'b', name: 'Groceries', date: '2026-08-02', category: 'Food', account: 'Card', amount: -100 },
  { id: 'c', name: 'Payroll', date: '2026-09-01', category: 'Uncategorized', account: 'Checking', amount: 500 },
];
const query = { search: '', facets: {}, from: '', to: '', min: '', max: '', sort: 'date', direction: 'desc' };
test('all rows are available; date sort and filters are inclusive', () => {
  assert.deepEqual(queryRows(rows, query, 'amount').map(r => r.id), ['c', 'b', 'a']);
  assert.deepEqual(queryRows(rows, { ...query, from: '2026-08-01', to: '2026-08-02' }, 'amount').map(r => r.id), ['b', 'a']);
});
test('multi-select is OR within a facet, AND between facets, plus case-insensitive search', () => {
  assert.equal(queryRows(rows, { ...query, facets: { category: ['Food'], account: ['Checking'] } }, 'amount')[0].id, 'a');
  assert.equal(queryRows(rows, { ...query, facets: { account: ['Checking', 'Card'] }, search: ' FOOD ' }, 'amount').length, 2);
});
test('signed amount ranges and numeric sort are not lexical', () => {
  assert.deepEqual(queryRows(rows, { ...query, min: '-100', max: '-10', sort: 'amount', direction: 'asc' }, 'amount').map(r => r.id), ['b', 'a']);
  assert.equal(queryRows(rows, { ...query, min: '50', max: '-10' }, 'amount').length, 0);
});
test('query never mutates source and gracefully supports zero matches', () => {
  queryRows(rows, query, 'amount'); assert.equal(rows[0].id, 'a');
  assert.equal(queryRows(rows, { ...query, search: 'missing' }, 'amount').length, 0);
});
test('ledger display preserves reconciliation signs and transfer direction', () => {
  for (const [kind, amount, expected] of [['adjustment', -20, -20], ['adjustment', 20, 20], ['income', 50, 50], ['expense', 50, -50], ['card_payment', 50, -50], ['refund', 50, 50], ['transfer_in', 50, 50], ['transfer_out', 50, -50]]) {
    assert.equal(signedAmount({ kind, amount }), expected);
  }
});
