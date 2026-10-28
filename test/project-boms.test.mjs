import assert from "node:assert/strict";
import test from "node:test";
import { bomGuid, bomDesignDocuments, listManagedBoms, bomsForProject, bomServiceUrl, requestBomService, assertBomParent,
  assertBomBinding, bomSnapshotHash, planBomData, migrateManagedBom } from "../lib/project-boms.mjs";

const guid = (n) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const context = { sourceEndpoint: "https://source.example/api/graphql", targetEndpoint: "https://target.example/api/graphql", sourceProjectId: "source-project",
  sourceBomId: guid(1), targetProjectGuid: guid(3), folderGuid: guid(4), name: "Procurement BOM", variantName: "Export" };
function details(target = false) {
  const id = target ? guid(2) : guid(1);
  const column = (id, hrid, title, dataType = "string") => ({ id, hrid, title, dataType, origin: "bom", attributes: { editable: true } });
  return { guid: id, bom: { guid: id, name: context.name, folderGuid: guid(4), initializationInProgress: false,
    source: { type: "design", designId: target ? guid(3) : guid(8), variantName: "Export" },
    production: { quantity: 25, dueDate: null }, settings: { country: { code: "FR" }, currency: { code: "EUR" } } },
    grid: { columns: [column("ref", "bom:designator", "Designator"), column("qty", "bom:quantity", "Quantity", "integer"),
      column("part", "bom:part-number", "MPN"), column("desc", "bom:description", "Description"),
      column(target ? "new-note" : "old-note", `bom:custom-attribute:${guid(target ? 7 : 6)}`, "Purchasing note"),
      column("vault", `bom:custom-attribute:${guid(9)}`, "VaultGUID")],
      rows: [{ id: target ? "target-row" : "source-row", data: { ref: { rawValue: "R2, R1" }, qty: { rawValue: 2 }, part: { rawValue: "RES100" }, desc: { rawValue: target ? "old" : "Resistor" },
        [target ? "new-note" : "old-note"]: { rawValue: target ? "" : "Use approved substitute" }, vault: { rawValue: target ? guid(3) : guid(8) } } }] } };
}
test("BOM discovery paginates completely and associates by project GUID including current BomDesignSource", async () => {
  let calls = 0;
  const rows = await listManagedBoms(async (query, vars) => {
    assert.match(query, /on BomDesignSource/); assert.match(query, /^query /);
    assert.match(query, /currentDesignId: designId/); assert.match(query, /revisionDesignId: designId/);
    calls++; assert.equal(vars.after, calls === 1 ? null : "page-2");
    return { bomBoms: { nodes: [{ id: guid(calls), name: "same name", sources: [{ __typename: calls === 1 ? "BomDesignSource" : "BomDesignReleaseSource", [calls === 1 ? "currentDesignId" : "releaseDesignId"]: guid(8).toUpperCase() }] }],
      pageInfo: { hasNextPage: calls === 1, endCursor: "page-2" } } };
  });
  const matched = bomsForProject(rows, guid(8));
  assert.equal(matched.length, 2); assert.equal(matched[0].supported, true); assert.equal(matched[1].supported, false);
  assert.equal(bomsForProject(rows, guid(9)).length, 0);
  await assert.rejects(listManagedBoms(async () => ({ bomBoms: { nodes: [], pageInfo: { hasNextPage: true, endCursor: "stuck" } } })), /pagination/);
  await assert.rejects(listManagedBoms(async () => ({})), /completely/);
});
test("native BOM service stays on the authenticated HTTPS workspace and never retries writes or follows redirects", async () => {
  const baseUrl = bomServiceUrl({ services: [{ name: "bom", apiUrl: "https://target.example/svc/bom/api" }] }, context.targetEndpoint);
  assert.equal(baseUrl, "https://target.example/svc/bom/api/v1/");
  assert.throws(() => bomServiceUrl({ services: [{ name: "bom", apiUrl: "https://other.example/api" }] }, context.targetEndpoint), /authenticated workspace/);
  assert.throws(() => bomServiceUrl({ services: [] }, context.targetEndpoint), /advertise/);
  let calls = 0;
  await assert.rejects(requestBomService({ baseUrl, token: "fake", route: "import/design", method: "POST", body: { name: "test" }, fetchImpl: async (url, options) => {
    calls++; assert.equal(options.redirect, "error"); assert.equal(options.headers.authorization, "Bearer fake"); return new Response("Unauthorized", { status: 401 });
  } }), /token.*entitlement/);
  assert.equal(calls, 1);
  await assert.rejects(requestBomService({ baseUrl, route: "https://other.example/", token: "fake" }), /route/);
});
test("a Managed BOM requires a completely verified parent, not only a newly created project", () => {
  const record = { sourceProjectId: "source-project", targetEndpoint: context.targetEndpoint, targetFolderId: "folder", phase: "completed", targetProjectGuid: guid(3), targetProjectId: "target",
    historyVerification: { verified: true, fileVerification: { verified: true } }, cloudVerification: { verified: true }, placementVerification: { verified: true } };
  assert.equal(assertBomParent(record, { ...context, targetFolderId: "folder" }), record);
  for (const override of [{ phase: "cloud-validation-pending" }, { targetEndpoint: "foreign" }, { cloudVerification: { verified: false } }, { historyVerification: { verified: true } }]) {
    assert.throws(() => assertBomParent({ ...record, ...override }, { ...context, targetFolderId: "folder" }), /verify/);
  }
});
test("BOM qualification targets its actual variant and primary PCB while all auxiliary source files still require separate Git verification", () => {
  const variants = [{ name: "[No Variations]", pcb: { documentName: "Layout.PcbDoc" } }, { name: "Production", pcb: { documentName: "Other.PcbDoc" } }];
  const documents = ["Power.SchDoc", "Layout.PcbDoc", "Panelization.PcbDoc", "Other.PcbDoc"];
  const result = bomDesignDocuments(variants, "", documents);
  assert.deepEqual(result.expectedDocuments, ["Power.SchDoc", "Layout.PcbDoc"]);
  assert.deepEqual(result.secondaryPcbDocuments, ["Panelization.PcbDoc", "Other.PcbDoc"]);
  assert.throws(() => bomDesignDocuments(variants, "Unknown", documents), /no published PCB/);
  assert.throws(() => bomDesignDocuments(variants, "Production", ["Power.SchDoc"]), /absent/);
});
test("procurement rows and columns match semantically; source workspace bindings are never copied", () => {
  const source = details(), target = details(true), plan = planBomData(source, target);
  assert.deepEqual(plan.cells, [{ rowId: "target-row", columnId: "desc", rawValue: "Resistor" }, { rowId: "target-row", columnId: "new-note", rawValue: "Use approved substitute" }]);
  assert.deepEqual(plan.gaps, []); assert.equal(plan.settings, null);
  const hash = bomSnapshotHash(source); source.grid.rows[0].data.qty.rawValue = 3;
  assert.notEqual(bomSnapshotHash(source), hash); assert.ok(planBomData(source, target).gaps.some((gap) => gap.type === "design-data"));
  target.grid.rows.push(structuredClone(target.grid.rows[0]));
  assert.equal(planBomData(source, target).cells.length, 0);
  assert.ok(planBomData(source, target).gaps.some((gap) => gap.type === "row"));
});
test("changing tracking URLs and supplier ordering do not produce false BOM differences", () => {
  const source = details(), target = details(true);
  for (const [d, url, ids] of [[source, "old-url", ["a", "b"]], [target, "new-url", ["b", "a"]]]) {
    d.bom.settings.suppliersSettings = { selectedSuppliers: ids.map((id) => ({ id })) };
    d.grid.columns.push({ id: "offers", hrid: "supply-chain:selected-offers", title: "Order List", dataType: "objectList", origin: "cloud" });
    d.grid.rows[0].data.offers = { rawValue: [{ offerId: "offer-1", supplierId: "a", quantity: 25, url }] };
  }
  assert.deepEqual(planBomData(source, target).gaps, []); assert.equal(planBomData(source, target).settings, null);
  target.grid.rows[0].data.offers.rawValue[0].quantity = 50;
  assert.ok(planBomData(source, target).gaps.some((gap) => gap.field === "Order List"));
});
function fixture({ lostCreation = false, lostCells = false, duplicate = false } = {}) {
  let record = null, creates = 0, writes = 0, target = details(true), saves = [];
  const input = { context, source: details(), readRecord: async () => structuredClone(record), saveRecord: async (value) => { record = structuredClone(value); saves.push(record); },
    listTargets: async () => duplicate ? [{ name: context.name }] : [], native: async (route, options = {}) => {
      if (route === "import/design") { assert.equal(record.phase, "creating"); assert.equal(record.sourceBomId, guid(1)); creates++;
        assert.equal(options.body.designId, guid(3)); assert.equal(options.body.variantName, "Export"); if (lostCreation) throw new Error("lost reply"); return { guid: guid(2) }; }
      if (options.method === "PUT") { assert.equal(record.operation, "cells:0"); writes++; for (const cell of options.body.cells) target.grid.rows.find((r) => r.id === cell.rowId).data[cell.columnId] = { rawValue: cell.rawValue };
        if (lostCells) throw new Error("lost reply"); return {}; }
      assert.equal(options.method, undefined); return structuredClone(target);
    } };
  return { input, get record() { return record; }, get creates() { return creates; }, get writes() { return writes; }, get target() { return target; }, saves };
}
test("creates from the target design, restores scalar data and verifies the same native link without re-creating", async () => {
  const f = fixture(); const result = await migrateManagedBom(f.input);
  assert.equal(result.status, "copied"); assert.equal(result.verification.binding, true); assert.equal(result.nativeHistoryPreserved, false);
  assert.equal(result.releasesPreservedInSource, true); assert.equal(f.creates, 1); assert.equal(f.writes, 1);
  assert.equal((await migrateManagedBom(f.input)).status, "copied"); assert.equal(f.creates, 1); assert.equal(f.writes, 1);
  f.target.bom.source.designId = guid(9);
  await assert.rejects(migrateManagedBom(f.input), /not bound/); assert.equal(f.creates, 1);
});
test("missing custom columns and procurement settings are recorded, restored and re-read before cells", async () => {
  const f = fixture(); f.target.grid.columns = f.target.grid.columns.filter((c) => c.id !== "new-note");
  f.target.bom.settings.currency.code = "USD";
  const native = f.input.native, operations = [];
  f.input.native = async (route, options = {}) => {
    if (options.method === "PATCH") {
      operations.push("settings"); assert.equal(f.record.operation, "settings");
      Object.assign(f.target.bom, structuredClone(options.body)); return {};
    }
    if (options.method === "POST" && route.endsWith("/grid/columns")) {
      operations.push("column"); assert.match(f.record.operation, /^column:/);
      const column = { ...options.body, id: "new-note", hrid: "bom:custom-attribute:new-note", origin: "bom", attributes: { editable: true } };
      f.target.grid.columns.push(column); return { column };
    }
    return native(route, options);
  };
  assert.equal((await migrateManagedBom(f.input)).status, "copied");
  assert.deepEqual(operations, ["settings", "column"]); assert.equal(f.writes, 1);
});
test("an unknown creation reply is durably recorded and never triggers a duplicate, even after a restart", async () => {
  const f = fixture({ lostCreation: true });
  await assert.rejects(migrateManagedBom(f.input), /not be repeated/);
  assert.equal(f.record.phase, "outcome-unknown");
  await assert.rejects(migrateManagedBom(f.input), /outcome is unknown/); assert.equal(f.creates, 1);
});
test("native BOM initialization is pending validation and resumes the recorded GUID without another creation", async () => {
  const f = fixture(); f.target.bom.initializationInProgress = true;
  const input = { ...f.input, polling: { attempts: 2, delayMs: 0, wait: async () => {} } };
  assert.equal((await migrateManagedBom(input)).status, "initializing"); assert.equal(f.creates, 1); assert.equal(f.writes, 0);
  assert.equal(f.record.initializationPending, true); assert.equal(f.record.phase, "created");
  f.target.bom.initializationInProgress = false;
  assert.equal((await migrateManagedBom(input)).status, "copied"); assert.equal(f.creates, 1); assert.equal(f.writes, 1);
});
test("read-only reconciliation after a lost update verifies applied cells without sending a second update", async () => {
  const f = fixture({ lostCells: true });
  await assert.rejects(migrateManagedBom(f.input), /interrupted/);
  assert.equal(f.record.phase, "outcome-unknown");
  assert.equal((await migrateManagedBom({ ...f.input, verifyOnly: true })).status, "copied"); assert.equal(f.writes, 1); assert.equal(f.creates, 1);
});
test("verification does not create a BOM; collisions and changed source data stop before any write", async () => {
  const f = fixture(); assert.equal((await migrateManagedBom({ ...f.input, verifyOnly: true })).status, "not-started"); assert.equal(f.creates, 0);
  await assert.rejects(migrateManagedBom(fixture({ duplicate: true }).input), /without transfer provenance/);
  await migrateManagedBom(f.input); f.input.source.grid.rows[0].data.desc.rawValue = "Source edited later";
  await assert.rejects(migrateManagedBom(f.input), /source BOM.*changed/); assert.equal(f.writes, 1);
});
test("extra rows, alternate part changes and wrong native variants remain explicit review issues", async () => {
  const f = fixture(); f.target.grid.rows[0].data.part.rawValue = "DIFFERENT";
  assert.equal((await migrateManagedBom(f.input)).status, "review-required");
  assert.equal(f.record.verification.supportedData, false);
  f.target.bom.source.variantName = "Another variant";
  assert.throws(() => assertBomBinding(f.target, { ...context, targetBomId: guid(2) }), /variant/);
  assert.throws(() => bomGuid("not-a-guid"), /GUID/);
});
