import assert from "node:assert/strict";
import test from "node:test";
import { suggestCategory } from "../lib/category-suggestions.ts";

const categories = [
  { id: "dining", name: "Dining (Kevin)", active: true },
  { id: "groceries", name: "Groceries (Kevin)", active: true },
  { id: "software", name: "Software", active: true },
  { id: "inactive", name: "Dining old", active: false },
];

test("merchant wording can suggest a matching user category", () => {
  const suggestion = suggestCategory({ description: "Shugs Bagels", accountId: "amex", categories, history: [] });
  assert.deepEqual(suggestion, { categoryId: "dining", category: "Dining (Kevin)", confidence: "medium", source: "merchant", reason: "The merchant name looks like dining." });
});

test("Plaid detailed categories distinguish groceries from dining", () => {
  const suggestion = suggestCategory({ description: "Corner Market", accountId: "amex", categories, history: [], providerCategory: { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_GROCERIES", confidenceLevel: "VERY_HIGH" } });
  assert.equal(suggestion?.categoryId, "groceries");
  assert.equal(suggestion?.confidence, "high");
  assert.equal(suggestion?.source, "plaid");
});

test("the user's merchant history outranks provider metadata", () => {
  const suggestion = suggestCategory({ description: "Spotify", accountId: "amex", categories, history: [{ description: "Spotify", categoryId: "software", accountId: "amex" }], providerCategory: { primary: "ENTERTAINMENT", detailed: "ENTERTAINMENT_MUSIC", confidenceLevel: "HIGH" } });
  assert.equal(suggestion?.categoryId, "software");
  assert.equal(suggestion?.source, "history");
});

test("ambiguous user categories are not guessed without personalized evidence", () => {
  const choices = [{ id: "kevin", name: "Travel (Kevin)" }, { id: "steph", name: "Travel (Steph)" }];
  assert.equal(suggestCategory({ description: "Hyatt", accountId: "shared", categories: choices, history: [] }), null);
  assert.equal(suggestCategory({ description: "Hyatt", accountId: "shared", categories: choices, history: [{ description: "Flight", categoryId: "kevin", accountId: "shared" }] })?.categoryId, "kevin");
});
