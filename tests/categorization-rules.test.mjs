import assert from "node:assert/strict";
import test from "node:test";
import { findCategorizationRule, normalizeCategorizationMatch } from "../lib/categorization-rules.ts";

test("merchant rules ignore capitalization and punctuation", () => {
  assert.equal(normalizeCategorizationMatch("  SPOTIFY-USA, Inc. "), "spotify usa inc");
  const rule = findCategorizationRule("Spotify USA * Monthly", [{ id: "spotify", matchText: "Spotify", normalizedMatch: "spotify", categoryId: "software" }]);
  assert.equal(rule?.categoryId, "software");
});

test("the most specific matching merchant rule wins", () => {
  const rule = findCategorizationRule("Amazon Web Services", [
    { id: "amazon", matchText: "Amazon", normalizedMatch: "amazon", categoryId: "shopping" },
    { id: "aws", matchText: "Amazon Web Services", normalizedMatch: "amazon web services", categoryId: "software" },
  ]);
  assert.equal(rule?.id, "aws");
  assert.equal(findCategorizationRule("Local market", []) , null);
});
