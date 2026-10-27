import assert from "node:assert/strict";
import test from "node:test";
import { projectCloudState, projectDesignDocuments, waitForProjectCloudData } from "../lib/project-cloud.mjs";
const projectGuid = "5169F031-0FC6-40AF-B42F-F11DCF7D6B88";
const fixture = () => ({ projectGuid, targetHead: "current-commit", details: { Guid: projectGuid, WorkInProgressInfo: { GenerationStatus: 1, Sources: [{ Source: "Metadata", VcsRevision: "current-commit" }] } },
  variants: [{ schematics: [{ documentName: "Carte_Pool_Bridge_1.SchDoc" }], pcb: { documentName: "Carte_Pool_Bridge.PcbDoc" } }],
  expectedDocuments: ["iQ Bridge ZB/Carte_Pool_Bridge_1.SchDoc", "iQ Bridge ZB/Carte_Pool_Bridge.PcbDoc", "missing-legacy-report.html"] });
test("checks the design documents actually linked by the project, including native relocation and UTF-16 files", () => {
  const text = "\uFEFF[Design]\r\n[Document1]\r\nDocumentPath=iQ Bridge ZB\\Carte_Pool_Bridge.PcbDoc\r\n[Document2]\r\nDocumentPath=iQ Bridge ZB\\Carte_Pool_Bridge_1.SchDoc\r\n[Document3]\r\nDocumentPath=missing-report.html\r\n[OutputConfiguration]\r\nDocumentPath=Other.SchDoc\r\n";
  for (const encoding of ["utf8", "utf16le"]) assert.deepEqual(projectDesignDocuments(Buffer.from(text, encoding)), ["iQ Bridge ZB\\Carte_Pool_Bridge.PcbDoc", "iQ Bridge ZB\\Carte_Pool_Bridge_1.SchDoc"]);
});
test("requires the current commit and the schematic/PCB data before confirming a web-ready project", () => {
  assert.equal(projectCloudState(fixture()).verified, true);
  for (const mutate of [(f) => { f.details.WorkInProgressInfo = { GenerationStatus: 0, Sources: [] }; },
    (f) => { f.details.WorkInProgressInfo.Sources[0].VcsRevision = "old-commit"; },
    (f) => { f.variants[0].pcb = null; }, (f) => { f.variants = []; }]) {
    const f = fixture(); mutate(f); assert.equal(projectCloudState(f).verified, false);
  }
  const wrong = fixture(); wrong.details.Guid = "other-project";
  assert.throws(() => projectCloudState(wrong), /different project/);
});
test("waits only with read operations, detects completion, and retains a clear pending status", async () => {
  let reads = 0, waits = 0;
  assert.equal((await waitForProjectCloudData(async () => ({ verified: ++reads === 3 }), { attempts: 3, wait: async () => waits++ })).verified, true);
  assert.equal(reads, 3); assert.equal(waits, 2);
  await assert.rejects(waitForProjectCloudData(async () => ({ verified: false, generationStatus: 0 }), { attempts: 1 }), (error) => {
    assert.equal(error.cloudVerification.generationStatus, 0); return /awaiting cloud validation/.test(error.message);
  });
  await assert.rejects(waitForProjectCloudData(async () => ({ verified: false, message: "Data generation failed" })), /Cloud design generation failed/);
});
