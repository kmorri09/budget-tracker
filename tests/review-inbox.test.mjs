import test from "node:test";
import assert from "node:assert/strict";
import { refundMatchingReviews, obligationMatchingReviews, openReviewCount } from "../lib/review-inbox.ts";

const refund = (id, description, remaining = 10) => ({ id, description, remaining });
const dashboard = refundReviews => ({ refundReviews, activity: refundReviews.map(({ id }) => ({ id })), reviews: [], obligations: [] });

test("purchase refunds need matching while Dining benefits and completed matches do not", () => {
  const data = dashboard([
    refund("blooms", "BLOOMS", 20.85), refund("target", "Target", 45.45),
    refund("dunkin", "Dunkin' Donuts", 7), refund("amex", "AMEX Dining Credit"),
    refund("grubhub", "Grubhub", 10), refund("matched", "Target", 0),
  ]);
  assert.deepEqual(refundMatchingReviews(data).map(item => item.id), ["blooms", "target"]);
  assert.equal(openReviewCount(data), 2);
});

test("all review counts include transaction, refund and active obligation matching tasks", () => {
  const data = dashboard([refund("target", "Target")]);
  data.reviews = [{ id: "import" }];
  data.obligations = [{ id: "bill", active: true, suggestion: {} }, { id: "inactive", active: false, suggestion: {} }, { id: "no-match", active: true, suggestion: null }];
  assert.equal(openReviewCount(data), 3);
  assert.deepEqual(obligationMatchingReviews(data).map(item => item.id), ["bill"]);
  data.refundReviews[0].remaining = 0;
  data.obligations[0].suggestion = null;
  assert.equal(openReviewCount(data), 1);
});

test("missing refund data and refunds outside the active ledger cannot leave unopenable reviews", () => {
  const data = dashboard([refund("removed", "Target")]);
  data.activity = [];
  assert.equal(openReviewCount(data), 0);
  delete data.refundReviews;
  assert.equal(openReviewCount(data), 0);
});
