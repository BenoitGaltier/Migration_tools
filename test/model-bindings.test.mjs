import assert from "node:assert/strict";
import test from "node:test";
import { embeddedModelRevisionGuid, removeSourceRevisionBindings } from "../lib/model-bindings.mjs";

test("clears source GUID values without changing any binary offsets", () => {
  const guid = "47DAFCE2-0EB3-46B8-9BF1-E275F73E8252";
  const original = Buffer.from(`\x00\xff|SymbolITEMGUID=${guid}|SymbolREVISIONGUID=${guid}|SymbolVAULTGUID=${guid}|FOLDERGUID=${guid}\x00`, "latin1");
  const result = removeSourceRevisionBindings(original, "model.SchLib");
  assert.equal(result.length, original.length);
  assert.equal(result[0], 0);
  assert.equal(result[1], 255);
  assert.equal(result.includes(guid), false);
  assert.equal(embeddedModelRevisionGuid(result, "model.SchLib"), null);
  assert.equal(removeSourceRevisionBindings(original, "other.txt").equals(original), true);
});

test("detects native and formerly renamed source revision bindings", () => {
  const guid = "47DAFCE2-0EB3-46B8-9BF1-E275F73E8252";
  assert.equal(embeddedModelRevisionGuid(Buffer.from(`|REVISIONGUID=${guid}|`), "model.PcbLib"), guid);
  assert.equal(embeddedModelRevisionGuid(Buffer.from(`|SymbolREVISIONGUID=${guid}|`), "model.SchLib"), guid);
  assert.equal(embeddedModelRevisionGuid(Buffer.from(`|SOURCE_REVID=${guid}|`), "model.PcbLib"), guid);
  assert.equal(embeddedModelRevisionGuid(Buffer.from(`|SymbolSOURCE_REVID=${guid}|`), "model.SchLib"), guid);
  assert.equal(embeddedModelRevisionGuid(Buffer.from(`|SOURCE_REVID=${guid}|`), "readme.txt"), null);
});
