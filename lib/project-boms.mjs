import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

// BOM Portal has its own store. Never treat .BomDoc or a Git transfer as proof
// that a Managed BOM, its project association or its procurement data migrated.
const sourceFields = `__typename quantity
  ... on BomDesignSource { currentDesignId: designId currentVariantName: variantName }
  ... on BomDesignRevisionSource { revisionDesignId: designId sourceRevisionId revisionVariantName: variantName }
  ... on BomDesignReleaseSource { releaseDesignId: designId sourceRevisionId assemblyRevisionId }
  ... on BomProjectReleaseSource { projectReleaseDesignId: designId sourceRevisionId }`;
export const bomInventoryQuery = `query ProjectManagedBoms($after: String) {
  bomBoms(first: 100, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { id bomId name updatedAt sources { ${sourceFields} } }
  }
}`;
const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function bomGuid(value) {
  const text = String(value || "");
  const guid = text.includes("/") ? text.slice(text.lastIndexOf("/") + 1) : text;
  if (!guidPattern.test(guid)) throw new Error("A valid BOM/project GUID is required.");
  return guid.toLowerCase();
}
const sameGuid = (a, b) => { try { return bomGuid(a) === bomGuid(b); } catch { return false; } };
export async function listManagedBoms(query) {
  const rows = [], ids = new Set(), cursors = new Set();
  let after = null;
  for (;;) {
    const connection = (await query(bomInventoryQuery, { after }, "ProjectManagedBoms"))?.bomBoms;
    if (!connection || !Array.isArray(connection.nodes) || !connection.pageInfo) throw new Error("The BOM Portal inventory could not be read completely.");
    for (const bom of connection.nodes) {
      const id = bomGuid(bom.bomId || bom.id);
      if (ids.has(id)) throw new Error("BOM Portal inventory contains repeated identifiers.");
      ids.add(id); rows.push({ ...bom, sources: (bom.sources || []).map((source) => ({ ...source,
        designId: source.designId ?? source.currentDesignId ?? source.revisionDesignId ?? source.releaseDesignId ?? source.projectReleaseDesignId,
        variantName: source.variantName ?? source.currentVariantName ?? source.revisionVariantName ?? "" })) });
    }
    if (!connection.pageInfo.hasNextPage) return rows;
    after = connection.pageInfo.endCursor;
    if (!after || cursors.has(after)) throw new Error("BOM Portal inventory pagination did not advance.");
    cursors.add(after);
  }
}
export function bomsForProject(rows, projectGuid) {
  return rows.filter((bom) => bom.sources?.some((source) => sameGuid(source.designId, projectGuid))).map((bom) => {
    const supported = bom.sources.length === 1 && bom.sources[0].__typename === "BomDesignSource";
    return { ...bom, supported, reason: supported ? null : "source-snapshot", variantName: bom.sources.find((source) => sameGuid(source.designId, projectGuid))?.variantName || "" };
  });
}

export function bomServiceUrl(configuration, workspaceUrl) {
  const service = configuration.services?.find((entry) => entry.name === "bom")?.apiUrl;
  if (!service) throw new Error("This workspace does not advertise the BOM Portal service.");
  const url = new URL(service);
  if (url.protocol !== "https:" || url.origin !== new URL(workspaceUrl).origin || url.username || url.password || url.search || url.hash) throw new Error("The BOM service must belong to the authenticated workspace.");
  return `${url.href.replace(/\/$/, "")}/v1/`;
}

export async function requestBomService({ baseUrl, token, route, method = "GET", body, fetchImpl = fetch }) {
  const url = new URL(route, baseUrl), base = new URL(baseUrl);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || url.search || url.hash) throw new Error("Invalid BOM service route.");
  const response = await fetchImpl(url.href, { method, redirect: "error", signal: AbortSignal.timeout(180_000),
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await response.text();
  if (!response.ok) {
    let reason = "";
    try { const error = JSON.parse(text); reason = String(error.detail || error.message || error.title || "").slice(0, 800).replaceAll(token, "[redacted]"); } catch { /* Do not log HTML, sessions or server traces. */ }
    throw new Error(`BOM Portal ${method} failed (HTTP ${response.status}). ${[401, 403].includes(response.status) ? "Check this workspace token, BOM Portal entitlement and permissions." : "Inspect the saved transfer before continuing."}${reason ? ` ${reason}` : ""}`);
  }
  if (!text.trim()) return null;
  try { return JSON.parse(text); } catch { throw new Error("BOM Portal returned invalid JSON."); }
}

export function assertBomProvenance(record, { sourceProjectId, targetEndpoint, targetFolderId }) {
  if (!record || record.sourceProjectId !== sourceProjectId || record.targetEndpoint !== targetEndpoint || record.targetFolderId !== targetFolderId
    || !["completed", "cloud-validation-pending"].includes(record.phase) || !record.historyVerification?.verified || !record.historyVerification?.fileVerification?.verified
    || !record.placementVerification?.verified || !record.targetProjectId || !record.targetProjectGuid) {
    throw new Error("Migrate and verify the destination project before creating its Managed BOM.");
  }
  bomGuid(record.targetProjectGuid);
  return record;
}
export function assertBomParent(record, context) {
  assertBomProvenance(record, context);
  if (record.phase !== "completed" || !record.cloudVerification?.verified) throw new Error("Migrate and verify the destination project before creating its Managed BOM.");
  return record;
}

export function bomDesignDocuments(variants, variantName, sourceDocuments) {
  const selected = variantName ? variants.find((variant) => variant.name === variantName)
    : variants.find((variant) => /^\[no variations\]$/i.test(variant.name)) || (variants.length === 1 ? variants[0] : null);
  if (!selected?.pcb?.documentName) throw new Error("The BOM variant has no published PCB design in the destination.");
  const normalized = (value) => value.replaceAll("\\", "/").split("/").pop().toLowerCase();
  const board = selected.pcb.documentName;
  if (!sourceDocuments.some((name) => normalized(name) === normalized(board))) throw new Error("The published BOM board is absent from the verified source design files.");
  // Altium exposes one primary PCB per variant. Panelization/auxiliary PCB
  // files remain verified as Git blobs, not falsely required as BOM sources.
  return { expectedDocuments: [...sourceDocuments.filter((name) => /\.schdoc$/i.test(name)), board],
    secondaryPcbDocuments: sourceDocuments.filter((name) => /\.pcbdoc$/i.test(name) && normalized(name) !== normalized(board)) };
}

function assertDetails(details) {
  if (!details?.bom || !Array.isArray(details.grid?.rows) || !Array.isArray(details.grid?.columns)) throw new Error("Incomplete BOM Portal details; no writes are permitted.");
  if (details.bom.initializationInProgress) throw new Error("BOM initialization is pending; verify the same BOM later.");
}
export function assertBomBinding(details, { targetBomId, targetProjectGuid, folderGuid, name, variantName }) {
  assertDetails(details);
  const bom = details.bom, source = bom.source;
  if (!sameGuid(details.guid, targetBomId) || !sameGuid(bom.guid, targetBomId) || bom.name !== name
    || !sameGuid(bom.folderGuid, folderGuid) || !sameGuid(source?.designId, targetProjectGuid) || source?.type !== "design"
    || (source.variantName || "") !== (variantName || "")) throw new Error("The Managed BOM is not bound to the recorded destination project, variant and folder.");
  return true;
}
const technicalNames = /^(?:vaultguid|itemguid|revisionguid|designitemid|revision|itemtype)$/i;
const scalarTypes = new Set(["string", "integer", "float", "money", "percent"]);
const builtins = new Set(["bom:name", "bom:description", "bom:extra-quantity", "bom:target-price"]);
const isCustom = (column) => column.hrid?.startsWith("bom:custom-attribute:");
const canCopy = (column) => column.origin === "bom" && column.attributes?.editable === true && scalarTypes.has(column.dataType)
  && (builtins.has(column.hrid) || (isCustom(column) && !technicalNames.test(column.title)));
const raw = (row, column) => row.data?.[column?.id]?.rawValue;
const columnKey = (column) => isCustom(column) ? `custom:${column.title.trim().toLowerCase()}:${column.dataType}` : column.hrid;
const clone = (value) => structuredClone(value);
export function bomSettings(details) {
  const settings = details.bom.settings || {};
  return { production: clone(details.bom.production || {}), settings: Object.fromEntries([
    "country", "currency", "suppliersSettings", "orderListPackagingPrioritiesSettings", "targetPriceSettings"
  ].filter((key) => settings[key] !== undefined).map((key) => [key, clone(settings[key])])) };
}
function comparableSettings(details) {
  const settings = bomSettings(details), suppliers = settings.settings.suppliersSettings;
  if (suppliers?.selectedSuppliers) suppliers.selectedSuppliers.sort((a, b) => a.id.localeCompare(b.id));
  return settings;
}
function comparableValue(value, hrid) {
  if (hrid !== "supply-chain:selected-offers") return value;
  // Tracking URLs, captions and live market enrichment are not offer choices.
  return (value || []).map(({ offerId, supplierId, quantity }) => ({ offerId, supplierId, quantity }))
    .sort((a, b) => String(a.offerId).localeCompare(String(b.offerId)));
}
function rowKey(details, row) {
  const designators = raw(row, details.grid.columns.find((c) => c.hrid === "bom:designator"));
  if (typeof designators !== "string" || !designators.trim()) return null;
  return designators.split(/[,;\s]+/).filter(Boolean).sort().join(",");
}
function uniqueMap(rows, key) {
  const map = new Map();
  for (const row of rows) { const id = key(row); if (id) map.set(id, map.has(id) ? null : row); }
  return map;
}
export function bomSnapshotHash(details) {
  assertDetails(details);
  const columns = details.grid.columns.filter((col) => col.origin === "bom");
  const value = { name: details.bom.name, source: details.bom.source, settings: bomSettings(details),
    rows: details.grid.rows.map((row) => ({ key: rowKey(details, row), values: columns.map((col) => [columnKey(col), raw(row, col)]) })) };
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

// Copy scalar procurement data by semantic column and an unambiguous complete
// set of designators. Never match by row position, human name or source GUID.
export function planBomData(source, target) {
  assertDetails(source); assertDetails(target);
  const targetColumns = uniqueMap(target.grid.columns, columnKey);
  const targetRows = uniqueMap(target.grid.rows, (row) => rowKey(target, row));
  const sourceRows = uniqueMap(source.grid.rows, (row) => rowKey(source, row));
  const sourceColumns = uniqueMap(source.grid.columns, columnKey);
  const samePart = (row, to) => ["bom:part-number", "bom:manufacturer"].every((hrid) => {
    const a = source.grid.columns.find((col) => col.hrid === hrid), b = target.grid.columns.find((col) => col.hrid === hrid);
    return !a || (b && isDeepStrictEqual(raw(row, a), raw(to, b)));
  });
  const rowLabel = (row) => {
    if (!row.parentId) return rowKey(source, row) || String(raw(row, source.grid.columns.find((c) => c.hrid === "bom:part-number")) || "Unidentified row");
    const parent = source.grid.rows.find((r) => r.id === row.parentId);
    return `${parent ? rowKey(source, parent) || "" : ""} — ${raw(row, source.grid.columns.find((c) => c.hrid === "bom:part-number")) || "Alternate"}`;
  };
  const columns = [], cells = [], gaps = [];
  for (const col of source.grid.columns.filter(canCopy)) {
    const key = columnKey(col), dest = targetColumns.get(key);
    if (!sourceColumns.get(key)) { gaps.push({ type: "column", name: col.title }); continue; }
    if (!targetColumns.has(key) && isCustom(col) && !target.grid.columns.some((c) => c.title.trim().toLowerCase() === col.title.trim().toLowerCase())) columns.push({ title: col.title, dataType: col.dataType, viewId: "main" });
    else if (!dest || !canCopy(dest)) gaps.push({ type: "column", name: col.title });
    if (!dest || !canCopy(dest)) continue;
    for (const row of source.grid.rows) {
      const value = raw(row, col), id = rowKey(source, row), to = id && sourceRows.get(id) && targetRows.get(id);
      if (value === undefined) continue;
      if (!to) { gaps.push({ type: "row", name: rowLabel(row) }); continue; }
      if (!samePart(row, to)) { gaps.push({ type: "part", name: id,
        sourceValue: raw(row, source.grid.columns.find((c) => c.hrid === "bom:part-number")), targetValue: raw(to, target.grid.columns.find((c) => c.hrid === "bom:part-number")) }); continue; }
      if ((value !== null && typeof value === "object") || (typeof value === "number" && !Number.isFinite(value))) { gaps.push({ type: "value", name: col.title }); continue; }
      if (!isDeepStrictEqual(value, raw(to, dest))) cells.push({ rowId: to.id, columnId: dest.id, rawValue: value });
    }
  }
  // Designators, quantities, MPNs and alternate/extra rows are compared, never
  // silently rewritten to force a regenerated design to resemble a snapshot.
  const compared = ["bom:quantity", "bom:part-number", "bom:manufacturer", "supply-chain:selected-offers"];
  for (const row of source.grid.rows) {
    const id = rowKey(source, row), to = id && sourceRows.get(id) && targetRows.get(id);
    if (!to) { gaps.push({ type: "row", name: rowLabel(row) }); continue; }
    for (const hrid of compared) {
      const a = source.grid.columns.find((col) => col.hrid === hrid), b = target.grid.columns.find((col) => col.hrid === hrid);
      const from = a && comparableValue(raw(row, a), hrid), dest = b && comparableValue(raw(to, b), hrid);
      if (a && (!b || !isDeepStrictEqual(from, dest))) gaps.push({ type: "design-data", name: id, field: a.title, sourceValue: from, targetValue: dest });
    }
  }
  if (source.grid.rows.length !== target.grid.rows.length) gaps.push({ type: "row-count", name: `${source.grid.rows.length} / ${target.grid.rows.length}` });
  for (const row of target.grid.rows) {
    const key = rowKey(target, row);
    if (key && !sourceRows.has(key)) gaps.push({ type: "target-row", name: key,
      targetValue: raw(row, target.grid.columns.find((col) => col.hrid === "bom:part-number")) });
  }
  return { columns, cells, gaps: [...new Map(gaps.map((gap) => [JSON.stringify(gap), gap])).values()],
    settings: isDeepStrictEqual(comparableSettings(source), comparableSettings(target)) ? null : bomSettings(source) };
}

export async function migrateManagedBom({ context, source, readRecord, saveRecord, native, listTargets, verifyOnly = false,
  polling = { attempts: 6, delayMs: 2000, wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } }) {
  assertDetails(source);
  const identity = { ...context, sourceHash: bomSnapshotHash(source) };
  let record = await readRecord();
  if (record && Object.entries(identity).some(([key, value]) => record[key] !== value)) throw new Error("The source BOM or transfer destination changed. Inspect its saved transfer before continuing.");
  if (!record) {
    if (verifyOnly) return { status: "not-started" };
    if ((await listTargets()).some((bom) => bom.name === context.name)) throw new Error("A destination BOM with this name already exists without transfer provenance. No BOM will be created.");
    record = { ...identity, phase: "creating", createdAt: new Date().toISOString(), operation: "import-design" };
    await saveRecord(record); // durable provenance BEFORE the non-idempotent call
    try {
      const created = await native("import/design", { method: "POST", body: { designId: context.targetProjectGuid,
        bomName: context.name, folderGuid: context.folderGuid, ...(context.variantName ? { variantName: context.variantName } : {}) } });
      record.targetBomId = bomGuid(created.guid);
      record.phase = "created"; record.operation = null;
      await saveRecord(record);
    } catch (error) {
      record.phase = "outcome-unknown";
      record.error = error.message;
      await saveRecord(record);
      throw new Error("BOM creation did not return a verified result. Inspect BOM Portal; creation will not be repeated automatically.", { cause: error });
    }
  }
  if (!record.targetBomId) throw new Error("The previous BOM creation outcome is unknown. Inspect BOM Portal before any further creation.");
  const route = `boms/${bomGuid(record.targetBomId)}`;
  const loadTarget = async () => {
    for (let attempt = 0; ; attempt++) {
      const details = await native(`${route}/details`);
      if (!details?.bom?.initializationInProgress || attempt + 1 >= polling.attempts) return details;
      await polling.wait(polling.delayMs);
    }
  };
  const pending = async () => {
    await saveRecord({ ...record, initializationPending: true });
    return { status: "initializing", targetBomId: record.targetBomId, nativeHistoryPreserved: false, releasesPreservedInSource: true };
  };
  let target = await loadTarget();
  if (target?.bom?.initializationInProgress) return pending();
  const binding = { ...context, targetBomId: record.targetBomId };
  assertBomBinding(target, binding);
  let plan = planBomData(source, target);
  const readOnly = verifyOnly || record.phase === "verified" || record.phase === "review-required" || record.phase === "outcome-unknown" || Boolean(record.operation);
  if (!readOnly) {
    const mutate = async (operation, url, options) => {
      record = { ...record, phase: "restoring", operation };
      await saveRecord(record);
      try {
        const value = await native(url, options);
        record.operation = null; await saveRecord(record);
        return value;
      } catch (error) {
        record.phase = "outcome-unknown"; record.error = error.message;
        await saveRecord(record);
        throw new Error("BOM data restoration was interrupted. Verify the same target before continuing; no creation will be repeated.", { cause: error });
      }
    };
    if (plan.settings) await mutate("settings", `${route}/details`, { method: "PATCH", body: plan.settings });
    for (const column of plan.columns) await mutate(`column:${column.title}`, `${route}/grid/columns`, { method: "POST", body: column });
    target = await loadTarget(); if (target?.bom?.initializationInProgress) return pending(); assertBomBinding(target, binding);
    plan = planBomData(source, target);
    // Each batch is recorded. A lost reply must never trigger a blind replay.
    for (let i = 0; i < plan.cells.length; i += 100) await mutate(`cells:${i}`, `${route}/grid/batch/cells`, { method: "PUT", body: { cells: plan.cells.slice(i, i + 100) } });
    target = await loadTarget(); if (target?.bom?.initializationInProgress) return pending(); assertBomBinding(target, binding);
    plan = planBomData(source, target);
  }
  const complete = !plan.columns.length && !plan.cells.length && !plan.settings && !plan.gaps.length;
  record = { ...record, phase: complete ? "verified" : "review-required", operation: null, initializationPending: false, verifiedAt: new Date().toISOString(),
    verification: { binding: true, supportedData: complete, remaining: plan }, releaseStrategy: "source-workspace", historyStrategy: "source-workspace" };
  await saveRecord(record);
  return { status: complete ? "copied" : "review-required", targetBomId: record.targetBomId, verification: record.verification,
    nativeHistoryPreserved: false, releasesPreservedInSource: true,
    notTransferred: ["history", "releases", "comments", "costed-boms", "health-check-waivers", "display-preferences"] };
}
