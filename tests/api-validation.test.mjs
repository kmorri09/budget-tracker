import assert from "node:assert/strict";
import test from "node:test";
import {
  accountCreateSchema,
  allocationUpdateSchema,
  budgetAdjustmentUpdateSchema,
  categorySchema,
  categoryUpdateSchema,
  dateOnlySchema,
  entrySchema,
  idSchema,
  obligationSchema,
  obligationUpdateSchema,
  paymentSchema,
  paymentUpdateSchema,
  transactionUpdateSchema,
} from "../lib/api-validation.ts";

const validEntry = { kind: "transaction", amount: "12.50", date: "2026-09-08", accountId: "cash", categoryId: "food", description: "Coffee" };
const validObligation = { name: "Rent", amount: "1200", dueDate: "2026-09-15", categoryId: "rent", accountId: "cash" };

test("date validation accepts real calendar dates and rejects impossible dates", () => {
  assert.equal(dateOnlySchema.safeParse("2026-02-28").success, true);
  assert.equal(dateOnlySchema.safeParse("2026-02-29").success, false);
  assert.equal(dateOnlySchema.safeParse("2026-9-8").success, false);
});

test("account creation coerces numeric balances and applies safe defaults", () => {
  assert.deepEqual(accountCreateSchema.parse({ name: " Checking ", institution: " Bank ", type: "checking" }), { name: "Checking", institution: "Bank", type: "checking", openingBalance: 0, syncEnabled: false });
  assert.equal(accountCreateSchema.safeParse({ name: "Cash", institution: "Bank", type: "invalid" }).success, false);
  assert.equal(accountCreateSchema.safeParse({ name: "Cash", institution: "Bank", type: "checking", openingBalance: "NaN" }).success, false);
});

test("category input enforces nonnegative targets and preserves active state", () => {
  assert.deepEqual(categorySchema.parse({ name: " Food ", active: false }), { name: "Food", icon: "", target: 0, active: false });
  assert.equal(categorySchema.safeParse({ name: "Food", target: -1 }).success, false);
  assert.equal(categoryUpdateSchema.safeParse({ name: "Food", id: "" }).success, false);
});

test("manual allocations allow positive and negative amounts but never zero", () => {
  const positive = allocationUpdateSchema.parse({ id: "a", amount: "25.10", date: "2026-09-08", categoryId: "rent", note: "Funding" });
  const negative = allocationUpdateSchema.parse({ id: "a", amount: "-1400", date: "2026-09-08", categoryId: "rent", note: "Correction" });
  assert.equal(positive.amount, 25.1);
  assert.equal(negative.amount, -1400);
  assert.equal(allocationUpdateSchema.safeParse({ ...negative, amount: 0 }).success, false);
  assert.equal(allocationUpdateSchema.safeParse({ ...negative, date: "2026-02-29" }).success, false);
});

test("entry creation allows negative allocations while keeping other entries positive-only", () => {
  assert.equal(entrySchema.safeParse({ ...validEntry, kind: "allocation", amount: -1400 }).success, true);
  assert.equal(entrySchema.safeParse({ ...validEntry, kind: "allocation", amount: 0 }).success, false);
  for (const kind of ["transaction", "income", "transfer", "payment"]) {
    assert.equal(entrySchema.safeParse({ ...validEntry, kind, amount: -1 }).success, false, `${kind} must reject negative amounts`);
  }
});

test("entry inputs require meaningful descriptions and valid dates", () => {
  assert.equal(entrySchema.safeParse({ ...validEntry, description: "   " }).success, false);
  assert.equal(entrySchema.safeParse({ ...validEntry, date: "2026-02-29" }).success, false);
  assert.equal(entrySchema.safeParse({ ...validEntry, amount: "not-a-number" }).success, false);
});

test("transaction updates require an owned reference id shape and valid state fields", () => {
  const valid = transactionUpdateSchema.parse({ id: "tx", kind: "expense", amount: "10", date: "2026-09-08", accountId: "cash", categoryId: "food", description: "Groceries", status: "posted", pending: false });
  assert.equal(valid.amount, 10);
  assert.equal(transactionUpdateSchema.safeParse({ ...valid, kind: "unknown" }).success, false);
  assert.equal(transactionUpdateSchema.safeParse({ ...valid, categoryId: 7 }).success, false);
  assert.equal(transactionUpdateSchema.safeParse({ ...valid, pending: "false" }).success, false);
});

test("budget adjustments allow signed corrections and reject zero or blank reasons", () => {
  assert.equal(budgetAdjustmentUpdateSchema.parse({ id: "adj", amount: "-20.50", date: "2026-09-08", note: "Correction" }).amount, -20.5);
  assert.equal(budgetAdjustmentUpdateSchema.safeParse({ id: "adj", amount: 0, date: "2026-09-08", note: "Correction" }).success, false);
  assert.equal(budgetAdjustmentUpdateSchema.safeParse({ id: "adj", amount: 20, date: "2026-09-08", note: " " }).success, false);
});

test("obligations default to active, normalize cadence, and reject invalid schedules", () => {
  assert.deepEqual(obligationSchema.parse(validObligation), { ...validObligation, amount: 1200, cadence: null, active: true });
  assert.equal(obligationSchema.parse({ ...validObligation, cadence: " Monthly " }).cadence, "Monthly");
  assert.equal(obligationSchema.safeParse({ ...validObligation, amount: 0 }).success, false);
  assert.equal(obligationSchema.safeParse({ ...validObligation, dueDate: "2026-02-29" }).success, false);
  assert.equal(obligationUpdateSchema.safeParse({ ...validObligation, id: "" }).success, false);
});

test("card payment inputs enforce positive applications and account references", () => {
  const valid = paymentSchema.parse({ amount: "100", date: "2026-09-08", fromAccountId: "cash", toAccountId: "card", description: "Payment", applications: [{ transactionId: "tx", amount: "25" }] });
  assert.equal(valid.amount, 100);
  assert.equal(valid.applications[0].amount, 25);
  assert.equal(paymentSchema.safeParse({ ...valid, amount: -1 }).success, false);
  assert.equal(paymentSchema.safeParse({ ...valid, applications: [{ transactionId: "tx", amount: 0 }] }).success, false);
  assert.equal(paymentUpdateSchema.safeParse({ ...valid, id: "" }).success, false);
});

test("delete payloads never accept an empty identifier", () => {
  assert.equal(idSchema.safeParse({ id: "record" }).success, true);
  assert.equal(idSchema.safeParse({ id: "" }).success, false);
  assert.equal(idSchema.safeParse({}).success, false);
});
