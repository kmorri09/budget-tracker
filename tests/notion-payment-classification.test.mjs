import test from "node:test";
import assert from "node:assert/strict";
import { isNotionCardPayment } from "../lib/notion-import.ts";

test("numeric Partial Payment rollups do not turn categorized expenses into payments", () => {
  assert.equal(isNotionCardPayment({ Description: "Rent", Category: "Rent (folder/Rent.md)", "Partial Payment": "0", "Partial Payment Of": "" }), false);
  assert.equal(isNotionCardPayment({ Description: "Purchase", Category: "Dining (folder/Dining.md)", "Partial Payment": "25.00", "Partial Payment Of": "" }), false);
});

test("the payment-side relation identifies an actual partial card payment", () => {
  assert.equal(isNotionCardPayment({ Description: "Card transfer", Category: "", "Partial Payment": "0", "Partial Payment Of": "Purchase (folder/Purchase.md)" }), true);
});

test("uncategorized descriptions can flag likely payments for review", () => {
  assert.equal(isNotionCardPayment({ Description: "Credit card autopay", Category: "" }), true);
  assert.equal(isNotionCardPayment({ Description: "Payment processing fee", Category: "Fees (folder/Fees.md)" }), false);
});
