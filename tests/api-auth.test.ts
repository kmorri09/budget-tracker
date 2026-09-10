import assert from "node:assert/strict";
import test from "node:test";
import { DELETE as deleteAccount, GET as getAccounts, PATCH as patchAccount, POST as postAccount } from "../app/api/accounts/route";
import { DELETE as deleteAllocation, PATCH as patchAllocation } from "../app/api/allocations/route";
import { DELETE as deleteAdjustment, PATCH as patchAdjustment } from "../app/api/budget/adjustments/route";
import { DELETE as deletePayment, PATCH as patchPayment, POST as postPayment } from "../app/api/card-payments/route";
import { GET as getCategories, PATCH as patchCategory, POST as postCategory } from "../app/api/categories/route";
import { DELETE as deleteEntry, PATCH as patchEntry, POST as postEntry } from "../app/api/entries/route";
import { DELETE as deleteObligation, PATCH as patchObligation, POST as postObligation } from "../app/api/obligations/route";
import { GET as getDashboard } from "../app/api/dashboard/route";
import { GET as getConnections } from "../app/api/connections/route";

const jsonRequest = (method: string, body: unknown = {}) => new Request("http://localhost/api/test", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function assertUnauthorized(handler: (request: Request) => Promise<Response>, method: string, body?: unknown) {
  const response = await handler(jsonRequest(method, body));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Unauthorized" });
}

async function assertUnauthorizedGet(handler: () => Promise<Response>, label: string) {
  const response = await handler();
  assert.equal(response.status, 401, `${label} should require authentication`);
  assert.deepEqual(await response.json(), { error: "Unauthorized" });
}

test("all user-owned mutation routes reject unauthenticated requests", async () => {
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const cases: Array<[string, (request: Request) => Promise<Response>, string, unknown?]> = [
      ["accounts POST", postAccount, "POST", { name: "Cash", institution: "Bank", type: "checking" }],
      ["accounts PATCH", patchAccount, "PATCH", { id: "account" }],
      ["accounts DELETE", deleteAccount, "DELETE", { id: "account" }],
      ["allocations PATCH", patchAllocation, "PATCH", { id: "allocation", amount: -10, date: "2026-09-08", categoryId: "category", note: "Correction" }],
      ["allocations DELETE", deleteAllocation, "DELETE", { id: "allocation" }],
      ["budget adjustments PATCH", patchAdjustment, "PATCH", { id: "adjustment", amount: -10, date: "2026-09-08", note: "Correction" }],
      ["budget adjustments DELETE", deleteAdjustment, "DELETE", { id: "adjustment" }],
      ["card payments POST", postPayment, "POST", { amount: 10, date: "2026-09-08", fromAccountId: "cash", toAccountId: "card", description: "Payment" }],
      ["card payments PATCH", patchPayment, "PATCH", { id: "payment", amount: 10, date: "2026-09-08", fromAccountId: "cash", toAccountId: "card", description: "Payment", applications: [] }],
      ["card payments DELETE", deletePayment, "DELETE", { id: "payment" }],
      ["categories POST", postCategory, "POST", { name: "Food" }],
      ["categories PATCH", patchCategory, "PATCH", { id: "category", name: "Food" }],
      ["entries POST", postEntry, "POST", { kind: "allocation", amount: -10, date: "2026-09-08", categoryId: "category", description: "Correction" }],
      ["entries PATCH", patchEntry, "PATCH", { id: "entry", kind: "expense", amount: 10, date: "2026-09-08", accountId: "cash", categoryId: "category", description: "Expense", status: "posted", pending: false }],
      ["entries DELETE", deleteEntry, "DELETE", { id: "entry" }],
      ["obligations POST", postObligation, "POST", { name: "Rent", amount: 100, dueDate: "2026-09-15", accountId: "cash", categoryId: "rent" }],
      ["obligations PATCH", patchObligation, "PATCH", { id: "obligation", name: "Rent", amount: 100, dueDate: "2026-09-15", accountId: "cash", categoryId: "rent" }],
      ["obligations DELETE", deleteObligation, "DELETE", { id: "obligation" }],
    ];
    for (const [label, handler, method, body] of cases) await assertUnauthorized(handler, method, body).catch(error => { throw new Error(`${label}: ${error instanceof Error ? error.message : error}`); });
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});

test("all user-owned read routes reject unauthenticated requests", async () => {
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    for (const [label, handler] of [["accounts", getAccounts], ["categories", getCategories], ["dashboard", getDashboard], ["connections", getConnections]] as const) {
      await assertUnauthorizedGet(handler, label);
    }
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});
