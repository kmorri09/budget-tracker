import test from "node:test";
import assert from "node:assert/strict";
import { categoriesAllocatedInLastDays } from "../lib/recent-allocations.ts";

test("dashboard categories are selected by allocations in the inclusive last 28 days", () => {
  const categories = [{ id: "rent", name: "Rent" }, { id: "food", name: "Food" }, { id: "old", name: "Old" }, { id: "future", name: "Future" }];
  const result = categoriesAllocatedInLastDays(categories, [
    { category: "Rent", date: "2026-09-08" },
    { category: "Food", date: "2026-08-12" },
    { category: "Old", date: "2026-08-11" },
    { category: "Future", date: "2026-09-09" },
  ], "2026-09-08");
  assert.deepEqual(result.map(category => category.name), ["Rent", "Food"]);
});

test("recent allocation membership does not depend on lifetime net amount", () => {
  const result = categoriesAllocatedInLastDays([{ id: "travel", name: "Travel" }], [
    { category: "Travel", date: "2026-09-01" },
    { category: "Travel", date: "2026-09-02" },
  ], "2026-09-08");
  assert.equal(result.length, 1);
});
