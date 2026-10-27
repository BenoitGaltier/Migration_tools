import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { projectPlacementDetailsUrl, assertProjectFolderPlacement } from "../lib/project-folder.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const envFile = option("--env-file", path.join(root, ".env"));
const output = path.resolve(option("--output", path.join(root, ".diagnostics", "project-stability-audit.json")));
const env = Object.fromEntries((await readFile(envFile, "utf8")).split(/\r?\n/).filter((line) => line.includes("=") && !line.trim().startsWith("#")).map((line) => {
  const i = line.indexOf("="); return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^['"]|['"]$/g, "")];
}));
const sources = JSON.parse(env.ALTIUM_SOURCE_WORKSPACES_JSON || "[]");
const source = sources.find((workspace) => /^ZPCE$/i.test(workspace.id || workspace.name));
const target = JSON.parse(env.ALTIUM_TARGET_WORKSPACE_JSON || "null");
if (!source?.accessToken || !target?.accessToken) throw new Error("Configure source ZPCE and target credentials locally before running this read-only audit.");
const config = JSON.parse(await readFile(path.join(root, "config", "operations.json"), "utf8"));
const warnings = [];
const safe = (value) => Array.isArray(value) ? value.map(safe) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /token|session|password|secret/i.test(key) ? "[redacted]" : safe(item)]))
  : typeof value === "string" ? value.replace(/(https?:\/\/[^\s"?]+)\?[^\s"]+/g, "$1?[redacted]") : value;
async function gql(workspace, query, variables = {}) {
  if (!/^\s*query\b/.test(query)) throw new Error("This audit permits GraphQL queries only.");
  const response = await fetch(workspace.apiUrl, { method: "POST", headers: { authorization: `Bearer ${workspace.accessToken}`, "content-type": "application/json" }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(60000) });
  const result = await response.json();
  if (!response.ok || !result.data) throw new Error(`Read-only GraphQL request failed (${response.status}): ${(result.errors || []).map((error) => error.message).join("; ")}`);
  if (result.errors?.length) warnings.push(...result.errors.map((error) => ({ workspace: workspace.name, message: error.message, path: error.path })));
  return result.data;
}
async function get(url) {
  const endpoint = new URL(url, target.apiUrl);
  if (endpoint.protocol !== "https:" || !endpoint.hostname.endsWith(".365.altium.com") || endpoint.username || endpoint.password) throw new Error("Unexpected audit service endpoint.");
  const response = await fetch(endpoint, { headers: { authorization: `Bearer ${target.accessToken}`, "cache-control": "no-cache" }, signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Read-only project API failed (${response.status})`);
  return response.json();
}
async function projects(workspace) {
  const rows = [], cursors = new Set(); let after = null;
  for (;;) {
    const data = await gql(workspace, config.queries.projects.query, { first: 50, after });
    const connection = data.desProjects;
    if (!connection?.nodes) throw new Error("Project inventory was not returned.");
    rows.push(...connection.nodes);
    if (!connection.pageInfo?.hasNextPage) return rows;
    after = connection.pageInfo.endCursor;
    if (!after || cursors.has(after)) throw new Error("Project pagination did not advance.");
    cursors.add(after);
  }
}
async function catalog(folder) {
  const rows = []; const seen = new Set();
  for (let page = 0;; page++) {
    const url = new URL("/svc/explorer/api/v1/entities", target.apiUrl);
    url.search = new URLSearchParams({ selectedFolder: folder.folderId, pageSize: "100", page: String(page) });
    const result = await get(url);
    for (const entity of result.entities || []) { if (seen.has(entity.id)) throw new Error("Catalog pagination did not advance."); seen.add(entity.id); rows.push(entity); }
    if (rows.length >= Number(result.totalEntities ?? rows.length)) return rows;
    if (!(result.entities || []).length) throw new Error("Incomplete destination catalog listing.");
  }
}
const [sourceProjects, targetProjects, library] = await Promise.all([
  projects(source), projects(target), gql(target, "query AuditProjectFolders { desLibrary { folders { folderId name path folderType parent { folderId path } } } }")
]);
const folders = library.desLibrary.folders;
const whitespaceCatalogs = folders.filter((folder) => folder.folderType === "PROJECT_CATALOG" && /white[\s_-]*space/i.test(folder.path));
const whitespace = [], included = new Set();
for (const folder of whitespaceCatalogs) {
  const listedProjects = await catalog(folder);
  for (const entity of listedProjects.filter((entry) => entry.type === "Project")) {
    if (included.has(entity.id.toLowerCase())) continue; included.add(entity.id.toLowerCase());
    const project = targetProjects.find((entry) => entry.projectId.toLowerCase() === entity.id.toLowerCase());
    const entry = { name: entity.name, targetGuid: entity.id, targetId: project?.id, folder: { ...folder, id: folder.folderId } };
    try {
      const detailsUrl = projectPlacementDetailsUrl(entity, target.apiUrl, entity.id);
      const processingUrl = new URL(detailsUrl); processingUrl.pathname = `/multicad/api/v1.0/projects/${entity.id}/details`;
      const [metadata, processing, full] = await Promise.all([get(detailsUrl), get(processingUrl), project ? gql(target, "query AuditPublishedProject($id: ID!) { desProjectById(id: $id) { latestRevision { revisionId } design { variants { name schematics { documentName } pcb { documentName } } } } }", { id: project.id }) : null]);
      entry.placement = assertProjectFolderPlacement({ projectGuid: entity.id, projectName: entity.name, folder: entry.folder, projectFolders: folders, listedProjects, projectMetadata: metadata });
      entry.processing = processing.WorkInProgressInfoWithStatus || processing.WorkInProgressInfo;
      entry.project = { ...project, ...full?.desProjectById };
    } catch (error) { entry.error = error.message; }
    whitespace.push(entry);
  }
}
const targetNames = new Map();
for (const project of targetProjects) { const key = project.name?.trim().toLowerCase(); targetNames.set(key, [...(targetNames.get(key) || []), project]); }
const sourceInventory = sourceProjects.map((project) => ({ ...project, matchingTargetNames: (targetNames.get(project.name?.trim().toLowerCase()) || []).map((entry) => ({ id: entry.id, projectId: entry.projectId, name: entry.name })) }));
const report = safe({ checkedAt: new Date().toISOString(), mode: "read-only", source: { name: source.name, apiUrl: source.apiUrl }, target: { name: target.name, apiUrl: target.apiUrl }, counts: { sourceProjects: sourceProjects.length, targetProjects: targetProjects.length, sourceWithoutMatchingTargetName: sourceInventory.filter((entry) => !entry.matchingTargetNames.length).length, whitespaceProjects: whitespace.length }, whitespaceCatalogs, whitespace, sourceProjects: sourceInventory, targetProjects, warnings });
await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ output, counts: report.counts, whitespaceCatalogs: whitespaceCatalogs.map((folder) => folder.path), whitespace: whitespace.map((entry) => ({ name: entry.name, guid: entry.targetGuid, placement: entry.placement?.verified || false, generationStatus: entry.processing?.GenerationStatus, head: entry.project?.latestRevision?.revisionId, variants: entry.project?.design?.variants?.map((variant) => variant.name), error: entry.error })), warnings: warnings.length }));
