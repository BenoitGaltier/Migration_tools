import assert from "node:assert/strict";
import test from "node:test";
import { isMigratableComponentState } from "../lib/component-states.mjs";

test("includes every Prototype revision-state variant", () => {
  for (const state of ["Prototype", "Prototype Open_Indus", "Prototype_Viveris", "prototype custom"]) {
    assert.equal(isMigratableComponentState(state), true, state);
  }
  assert.equal(isMigratableComponentState("Production"), true);
});

test("does not include unrelated lifecycle states", () => {
  for (const state of ["Draft", "Planned", "Obsolete", "Deleted", ""]) {
    assert.equal(isMigratableComponentState(state), false, state);
  }
});
