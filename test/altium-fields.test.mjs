import assert from "node:assert/strict";
import test from "node:test";
import { explorerName, explorerRevisionId, internalRevisionGuid } from "../public/altium-fields.js";

test("matches Altium Explorer's Name and Revision ID columns", () => {
  const row = {
    name: "CMP-012-00013-2",
    comment: "DMT6012LSS-13",
    revisionId: "794a9a43-5645-4fde-a12d-3c5c7f396d73"
  };
  assert.equal(explorerName(row), "DMT6012LSS-13");
  assert.equal(explorerRevisionId(row), "CMP-012-00013-2");
  assert.equal(internalRevisionGuid(row), "794a9a43-5645-4fde-a12d-3c5c7f396d73");
});

test("does not substitute the technical GUID when Name is empty", () => {
  assert.equal(explorerName({ name: "PCC-012-0014-1", revisionInternalId: "guid" }), "");
});
