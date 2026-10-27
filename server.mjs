import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { readFile, writeFile, mkdir, rename, readdir, mkdtemp, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import { promisify } from "node:util";
import { embeddedModelRevisionGuid, removeSourceRevisionBindings } from "./lib/model-bindings.mjs";
import { isMigratableComponentState } from "./lib/component-states.mjs";
import { assertMirroredProjectRefs, checkProjectApiAccess } from "./lib/project-api.mjs";
import { assertEmptyProjectTarget, assertProjectTargetUnchanged, emptyTargetDefaultBranchAlias, guardedProjectMirrorArgs } from "./lib/project-target.mjs";
import { assertDesignerDestination, detachManagedProject, managedProjectGuid, projectRefs, verifyNativeProjectHistory, trySaveProjectMigrationLog, nativeVcsMigrationScript, nativeProjectDescription } from "./lib/project-designer.mjs";
import { projectNativeRequest } from "./lib/project-native-request.mjs";
import { projectFolderRow, projectPublicationPath, projectPlacementDetailsUrl, assertProjectFolderPlacement } from "./lib/project-folder.mjs";
import { selectMigrationProjectFile, selectPublishedProjectFile, validateMigrationProjectPath } from "./lib/project-paths.mjs";
import { projectCloudState, projectDesignDocuments, waitForProjectCloudData } from "./lib/project-cloud.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const configPath = path.join(__dirname, "config", "operations.json");
const envPath = path.join(__dirname, ".env");
const cacheDir = path.join(__dirname, "cache");
const migrationStatePath = path.join(__dirname, "migration_state", "model-map.json");
const completedMigrationPath = path.join(__dirname, "migration_state", "completed.json");
const parameterMappingsPath = path.join(__dirname, "migration_state", "parameter-mappings.json");
const templateDefinitionsPath = path.join(__dirname, "cache", "target-template-definitions.json");
const dictionaryValuesPath = path.join(__dirname, "cache", "target-dictionary-values.json");
const projectAnalysisCachePath = path.join(__dirname, "cache", "project-migration-analyses.json");
const footprintBindingCachePath = path.join(__dirname, "cache", "footprint-binding-diagnostics.json");
const migrationLogsDir = path.join(__dirname, "migration_logs");
const renderCacheDir = path.join(cacheDir, "library-renders");
const rendererDllPath = path.join(__dirname, "renderer", "runtime", "Fluidra.AltiumRenderer.dll");
const execFileAsync = promisify(execFile);
const CACHE_VERSION = 1;
const COMPONENT_FILTER_VERSION = 2;
const SYMBOL_REVISION_LIST_VERSION = 3;
const MODEL_TRANSFER_VERSION = 2;
const TEMPLATE_DEFINITIONS_VERSION = 3;
const DICTIONARY_VALUES_VERSION = 2;
const LIBRARY_RENDER_VERSION = 7;
const PROJECT_ANALYSIS_VERSION = 10;

// Keep the local URL stable across updates and troubleshooting sessions.
const PORT = 4173;
let endpoints;
let tokens;
let targetUsesLegacyToken;
let cacheTtlMs;
let filesUploadEndpoints;
let dictionaryValuesCache;
let dictionariesApiUrl;
let partCatalogApiUrl;
let partCatalogIdentityUrls = [];
let projectUploadEndpoints;
let altiumDesignerBridgeUrl;
let altiumDesignerBridgeToken;
let sourceWorkspaces;
let activeSourceWorkspaceId;
let targetWorkspace;

let workspaceLabels = {
  source: "ZPCE",
  target: "Global Fluidra"
};
const entityCaches = new Map();
const entityCacheLoads = new Map();
const entityCacheSources = new Map();
const projectAnalysisCache = new Map();
let projectAnalysisCacheLoaded = false;
let footprintBindingDiagnosticsLoad = null;
const activeProjectTransfers = new Set();

function configureSystemCertificates(env) {
  if (env.ALTIUM_USE_SYSTEM_CA === "false") return;
  const certificates = [
    ...getCACertificates("default"),
    ...getCACertificates("system")
  ];
  setDefaultCACertificates([...new Set(certificates)]);
}

function readDotEnv(filePath) {
  if (!existsSync(filePath)) return {};
  const values = {};
  const text = readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function runtimeEnv() {
  // Explicit process variables are useful for isolated test/runtime overrides.
  return { ...readDotEnv(envPath), ...process.env };
}

function parseWorkspaceJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid workspace JSON in .env: ${error.message}`);
  }
}

function normalizeWorkspace(workspace, fallbackId) {
  const id = String(workspace?.id || fallbackId || "workspace").trim().replace(/[^A-Za-z0-9_-]/g, "-");
  return {
    id,
    name: String(workspace?.name || id).trim(),
    apiUrl: String(workspace?.apiUrl || "").trim(),
    filesUploadUrl: String(workspace?.filesUploadUrl || "").trim(),
    accessToken: String(workspace?.accessToken || "").trim()
  };
}

function workspaceConfiguration(env) {
  const legacySource = normalizeWorkspace({
    id: "ZPCE",
    name: "ZPCE",
    apiUrl: env.ZPCE_API_URL,
    filesUploadUrl: env.ZPCE_FILES_UPLOAD_URL,
    accessToken: env.ZPCE_ACCESS_TOKEN
  }, "ZPCE");
  const parsedSources = parseWorkspaceJson(env.ALTIUM_SOURCE_WORKSPACES_JSON, [legacySource]);
  const sources = (Array.isArray(parsedSources) ? parsedSources : [])
    .map((workspace, index) => normalizeWorkspace(workspace, `SOURCE_${index + 1}`));
  if (!sources.length) sources.push(legacySource);
  const activeId = sources.some((workspace) => workspace.id === env.ACTIVE_SOURCE_WORKSPACE)
    ? env.ACTIVE_SOURCE_WORKSPACE
    : sources[0].id;
  const target = normalizeWorkspace(parseWorkspaceJson(env.ALTIUM_TARGET_WORKSPACE_JSON, {
    id: "GLOBAL_FLUIDRA",
    name: "Global Fluidra",
    apiUrl: env.GLOBAL_FLUIDRA_API_URL,
    filesUploadUrl: env.GLOBAL_FLUIDRA_FILES_UPLOAD_URL,
    accessToken: env.GLOBAL_FLUIDRA_ACCESS_TOKEN || env.ALTIUM_ACCESS_TOKEN
  }), "GLOBAL_FLUIDRA");
  return { sources, activeId, target };
}

function reloadRuntimeConfig() {
  const env = runtimeEnv();
  const workspaceConfig = workspaceConfiguration(env);
  sourceWorkspaces = workspaceConfig.sources;
  activeSourceWorkspaceId = workspaceConfig.activeId;
  targetWorkspace = workspaceConfig.target;
  const activeSource = sourceWorkspaces.find((workspace) => workspace.id === activeSourceWorkspaceId);
  endpoints = {
    source: activeSource?.apiUrl || "",
    target: targetWorkspace.apiUrl || ""
  };
  filesUploadEndpoints = {
    source: activeSource?.filesUploadUrl || deriveFilesUploadUrl(endpoints.source),
    target: targetWorkspace.filesUploadUrl || deriveFilesUploadUrl(endpoints.target)
  };
  tokens = {
    source: activeSource?.accessToken || "",
    target: targetWorkspace.accessToken || ""
  };
  targetUsesLegacyToken = !env.GLOBAL_FLUIDRA_ACCESS_TOKEN
    && Boolean(env.ALTIUM_ACCESS_TOKEN);
  cacheTtlMs = Math.max(1, Number(env.ALTIUM_CACHE_TTL_HOURS || 168)) * 60 * 60 * 1000;
  entityCaches.clear();
  entityCacheLoads.clear();
  entityCacheSources.clear();
  dictionaryValuesCache = null;
  dictionariesApiUrl = null;
  partCatalogApiUrl = null;
  partCatalogIdentityUrls = [];
  projectUploadEndpoints = null;
  altiumDesignerBridgeUrl = (env.ALTIUM_DESIGNER_BRIDGE_URL || "").replace(/\/$/, "");
  altiumDesignerBridgeToken = env.ALTIUM_DESIGNER_BRIDGE_TOKEN || "";
  workspaceLabels = {
    source: activeSource?.name || activeSourceWorkspaceId,
    target: targetWorkspace.name || "Target"
  };
  configureSystemCertificates(env);
}

function deriveFilesUploadUrl(graphqlUrl) {
  if (!graphqlUrl) return "";
  return new URL("/api/files/File/Upload", graphqlUrl).href;
}

function publicConfig() {
  return {
    sourceConfigured: Boolean(endpoints.source),
    targetConfigured: Boolean(endpoints.target),
    sourceTokenConfigured: Boolean(tokens.source),
    targetTokenConfigured: Boolean(tokens.target),
    altiumDesignerBridgeConfigured: Boolean(altiumDesignerBridgeUrl),
    targetUsesLegacyToken,
    activeSourceWorkspaceId,
    sources: sourceWorkspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      configured: Boolean(workspace.apiUrl),
      tokenConfigured: Boolean(workspace.accessToken)
    })),
    target: {
      id: targetWorkspace.id,
      name: targetWorkspace.name
    },
    endpoints: {
      source: endpoints.source.replace(/^https?:\/\//, ""),
      target: endpoints.target.replace(/^https?:\/\//, "")
    }
  };
}

function editableSettings() {
  const env = runtimeEnv();
  return {
    activeSourceWorkspaceId,
    sources: sourceWorkspaces.map(({ id, name, apiUrl, filesUploadUrl, accessToken }) => ({
      id, name, apiUrl, filesUploadUrl, tokenConfigured: Boolean(accessToken), accessToken: ""
    })),
    target: {
      id: targetWorkspace.id,
      name: targetWorkspace.name,
      apiUrl: targetWorkspace.apiUrl,
      filesUploadUrl: targetWorkspace.filesUploadUrl,
      tokenConfigured: Boolean(targetWorkspace.accessToken),
      accessToken: ""
    },
    application: {
      port: PORT,
      cacheTtlHours: Number(env.ALTIUM_CACHE_TTL_HOURS || 168),
      useSystemCa: env.ALTIUM_USE_SYSTEM_CA !== "false",
      designerBridgeUrl: env.ALTIUM_DESIGNER_BRIDGE_URL || "",
      designerBridgeTokenConfigured: Boolean(env.ALTIUM_DESIGNER_BRIDGE_TOKEN),
      designerBridgeToken: ""
    }
  };
}

function validateWorkspaceUrl(value, label, optional = false) {
  if (!value && optional) return "";
  let url;
  try { url = new URL(value); } catch { throw httpError(400, `${label} must be a valid URL`); }
  if (!new Set(["http:", "https:"]).has(url.protocol)) throw httpError(400, `${label} must use HTTP or HTTPS`);
  return url.href;
}

function envJson(value) {
  return JSON.stringify(value).replace(/[\r\n]/g, "");
}

async function saveEditableSettings(input) {
  if (!Array.isArray(input.sources) || !input.sources.length) {
    throw httpError(400, "At least one source workspace is required");
  }
  const existingSources = new Map(sourceWorkspaces.map((workspace) => [workspace.id, workspace]));
  const seen = new Set();
  const sources = input.sources.map((workspace, index) => {
    const normalized = normalizeWorkspace(workspace, `SOURCE_${index + 1}`);
    if (!normalized.name || !normalized.apiUrl) throw httpError(400, "Each source workspace requires a name and GraphQL URL");
    if (seen.has(normalized.id)) throw httpError(400, `Duplicate source workspace id: ${normalized.id}`);
    seen.add(normalized.id);
    normalized.apiUrl = validateWorkspaceUrl(normalized.apiUrl, `${normalized.name} GraphQL URL`);
    normalized.filesUploadUrl = normalized.filesUploadUrl
      ? validateWorkspaceUrl(normalized.filesUploadUrl, `${normalized.name} upload URL`) : "";
    normalized.accessToken ||= existingSources.get(normalized.id)?.accessToken || "";
    return normalized;
  });
  const activeId = sources.some((workspace) => workspace.id === input.activeSourceWorkspaceId)
    ? input.activeSourceWorkspaceId : sources[0].id;
  const target = normalizeWorkspace(input.target, targetWorkspace.id || "GLOBAL_FLUIDRA");
  if (!target.name || !target.apiUrl) throw httpError(400, "The target workspace requires a name and GraphQL URL");
  target.apiUrl = validateWorkspaceUrl(target.apiUrl, `${target.name} GraphQL URL`);
  target.filesUploadUrl = target.filesUploadUrl
    ? validateWorkspaceUrl(target.filesUploadUrl, `${target.name} upload URL`) : "";
  target.accessToken ||= targetWorkspace.accessToken || "";
  const application = input.application || {};
  const bridgeUrl = application.designerBridgeUrl
    ? validateWorkspaceUrl(application.designerBridgeUrl, "Designer bridge URL") : "";
  const bridgeToken = String(application.designerBridgeToken || "").trim()
    || altiumDesignerBridgeToken || "";
  const cacheHours = Math.max(1, Number(application.cacheTtlHours || 168));
  const lines = [
    "# Altium Migration Assistant configuration.",
    "# Managed by the Configuration menu. Never commit this file because it contains access tokens.",
    "",
    "# Source workspaces. Each entry has: id, display name, GraphQL URL, optional Files upload URL, token.",
    `ALTIUM_SOURCE_WORKSPACES_JSON=${envJson(sources)}`,
    "# Source workspace id selected when the application starts.",
    `ACTIVE_SOURCE_WORKSPACE=${activeId}`,
    "",
    "# Single destination workspace used for every migration.",
    `ALTIUM_TARGET_WORKSPACE_JSON=${envJson(target)}`,
    "",
    "# Use the Windows certificate store in addition to Node.js certificates.",
    `ALTIUM_USE_SYSTEM_CA=${application.useSystemCa === false ? "false" : "true"}`,
    "# Lifetime of persisted entity caches, in hours.",
    `ALTIUM_CACHE_TTL_HOURS=${cacheHours}`,
    "",
    "# Optional local Fluidra DXP Bridge hosted by Altium Designer.",
    `ALTIUM_DESIGNER_BRIDGE_URL=${bridgeUrl}`,
    `ALTIUM_DESIGNER_BRIDGE_TOKEN=${bridgeToken}`,
    ""
  ];
  const temporaryPath = `${envPath}.tmp`;
  await writeFile(temporaryPath, lines.join("\n"), "utf8");
  await rename(temporaryPath, envPath);
  reloadRuntimeConfig();
  return editableSettings();
}

reloadRuntimeConfig();

async function readJsonBody(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

function sendJson(res, status, data) {
  const payload = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(payload);
}

function sendText(res, status, text, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(text);
}

function sendBinary(res, status, bytes, type = "application/octet-stream") {
  res.writeHead(status, {
    "content-type": type,
    "content-length": bytes.length,
    "cache-control": "private, max-age=300"
  });
  res.end(bytes);
}

async function graphql(workspace, query, variables, operationName, urlOverride = null) {
  if (!Object.hasOwn(endpoints, workspace)) {
    throw new Error(`Unknown workspace: ${workspace}`);
  }

  const token = tokens[workspace];
  const workspaceLabel = workspaceLabels[workspace];
  if (!token) {
    throw new Error(`The access token is missing in .env for ${workspaceLabel}`);
  }
  const url = urlOverride || endpoints[workspace];
  if (!url) throw new Error(`${workspaceLabel} API URL is missing in .env`);

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ query, variables, operationName })
    });
  } catch (error) {
    const cause = error.cause;
    const details = [cause?.code, cause?.message || error.message].filter(Boolean).join(": ");
    throw new Error(
      `Unable to reach ${workspaceLabel} at ${url}. Network error: ${details}. `
      + "Check the URL, DNS, VPN, proxy, and TLS certificate."
    );
  }

  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      `${workspaceLabel} returned a non-GraphQL response (HTTP ${response.status}). `
      + `Check the workspace API URL. Response: ${text.slice(0, 500)}`
    );
  }
  if (!response.ok || parsed.errors) {
    const details = parsed.errors
      ? parsed.errors.map((error) => {
        const message = error.extensions?.message && !String(error.message || "").includes(error.extensions.message)
          ? `${error.message}: ${error.extensions.message}` : error.message;
        const path = error.path?.length ? ` (${error.path.join(".")})` : "";
        return `${message || "Unexpected GraphQL error"}${path}`;
      }).join("; ")
      : text.slice(0, 1000);
    const authenticationHint = response.status === 401 || response.status === 403
      ? " Check that this workspace's token is valid and has the required permissions."
      : "";
    throw new Error(
      `GraphQL error on ${workspaceLabel} (HTTP ${response.status}): ${details}${authenticationHint}`
    );
  }
  return parsed.data;
}

const introspectionQuery = `
query IntrospectionQuery {
  __schema {
    queryType { name }
    mutationType { name }
    types {
      kind
      name
      description
      enumValues(includeDeprecated: true) { name isDeprecated deprecationReason }
      fields(includeDeprecated: true) {
        name
        description
        args {
          name
          type { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } } }
        }
        type { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } } }
        isDeprecated
        deprecationReason
      }
      inputFields {
        name
        description
        type { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } } }
        defaultValue
      }
    }
  }
}`;

function getByPath(root, segments) {
  return segments.reduce((acc, key) => (acc ? acc[key] : undefined), root);
}

async function listEntities(kind, workspace = "source", maxItems = null, forceRefresh = false) {
  const workspaceCacheKey = workspace === "source" ? `source-${activeSourceWorkspaceId}` : workspace;
  const cacheKey = `${workspaceCacheKey}:${kind}`;
  if (!forceRefresh && entityCaches.has(cacheKey)) {
    entityCacheSources.set(cacheKey, "memory");
    const rows = entityCaches.get(cacheKey).rows;
    return maxItems ? rows.slice(0, maxItems) : rows;
  }

  if (!forceRefresh) {
    const persisted = await readPersistentEntityCache(workspace, kind);
    if (persisted) {
      entityCaches.set(cacheKey, persisted);
      entityCacheSources.set(cacheKey, "disk");
      return maxItems ? persisted.rows.slice(0, maxItems) : persisted.rows;
    }
  }

  if (!maxItems && !forceRefresh && entityCacheLoads.has(cacheKey)) {
    return entityCacheLoads.get(cacheKey);
  }

  const load = fetchEntities(kind, workspace, maxItems).then(async (rows) => {
    if (!maxItems) {
      const entry = { rows, cachedAt: new Date().toISOString() };
      entityCaches.set(cacheKey, entry);
      entityCacheSources.set(cacheKey, "network");
      await writePersistentEntityCache(workspace, kind, entry);
    }
    return rows;
  }).finally(() => {
    entityCacheLoads.delete(cacheKey);
  });

  if (!maxItems) entityCacheLoads.set(cacheKey, load);
  return load;
}

async function listTargetSelectableModels(kind, forceRefresh = false) {
  if (!new Set(["symbols", "footprints"]).has(kind)) {
    throw new Error(`Unsupported target model kind: ${kind}`);
  }
  const persistedKind = `${kind}-selectable-all-revisions`;
  const cacheKey = `target:${persistedKind}`;
  if (!forceRefresh && entityCaches.has(cacheKey)) {
    return entityCaches.get(cacheKey).rows;
  }
  if (!forceRefresh) {
    const persisted = await readPersistentEntityCache("target", persistedKind);
    if (persisted) {
      entityCaches.set(cacheKey, persisted);
      return persisted.rows;
    }
  }
  if (!forceRefresh && entityCacheLoads.has(cacheKey)) {
    return entityCacheLoads.get(cacheKey);
  }

  const load = (async () => {
    const config = JSON.parse(await readFile(configPath, "utf8"));
    const operation = config.queries[kind];
    const nodes = [];
    let after = null;
    for (;;) {
      const data = await graphql(
        "target",
        operation.query,
        { first: 250, after },
        operation.operationName
      );
      const connection = getByPath(data, operation.connectionPath);
      if (!connection) {
        throw new Error(`Connection path not found for target ${kind}: ${operation.connectionPath.join(".")}`);
      }
      nodes.push(...(connection.nodes || []));
      if (!connection.pageInfo?.hasNextPage) break;
      after = connection.pageInfo.endCursor;
    }
    const rows = nodes.map((node) => normalizeDesEntity(node, kind))
      .filter((row) => row.id)
      .sort((left, right) => (left.name || "").localeCompare(right.name || "", undefined, { numeric: true }));
    const entry = { rows, cachedAt: new Date().toISOString() };
    entityCaches.set(cacheKey, entry);
    await writePersistentEntityCache("target", persistedKind, entry);
    return rows;
  })().finally(() => entityCacheLoads.delete(cacheKey));

  entityCacheLoads.set(cacheKey, load);
  return load;
}

function persistentCachePath(workspace, kind) {
  const workspaceKey = workspace === "source" ? `source-${activeSourceWorkspaceId}` : workspace;
  return path.join(cacheDir, `${workspaceKey.replace(/[^A-Za-z0-9_-]/g, "-")}-${kind}.json`);
}

async function readPersistentEntityCache(workspace, kind) {
  const paths = [persistentCachePath(workspace, kind)];
  if (workspace === "source") paths.push(path.join(cacheDir, `source-${kind}.json`));
  for (const cachePath of paths) {
    try {
      const payload = JSON.parse(await readFile(cachePath, "utf8"));
      const age = Date.now() - Date.parse(payload.cachedAt);
      if (payload.version !== CACHE_VERSION
        || (kind === "components" && payload.componentFilterVersion !== COMPONENT_FILTER_VERSION)
        || (kind === "symbols" && payload.symbolRevisionListVersion !== SYMBOL_REVISION_LIST_VERSION)
        || payload.endpoint !== endpoints[workspace]
        || !Array.isArray(payload.rows)
        || !Number.isFinite(age)
        || age > cacheTtlMs) continue;
      return { rows: payload.rows, cachedAt: payload.cachedAt };
    } catch {
      // Try the next compatible cache name.
    }
  }
  return null;
}

async function writePersistentEntityCache(workspace, kind, entry) {
  await mkdir(cacheDir, { recursive: true });
  const payload = {
    version: CACHE_VERSION,
    ...(kind === "components" ? { componentFilterVersion: COMPONENT_FILTER_VERSION } : {}),
    ...(kind === "symbols" ? { symbolRevisionListVersion: SYMBOL_REVISION_LIST_VERSION } : {}),
    workspace,
    endpoint: endpoints[workspace],
    cachedAt: entry.cachedAt,
    rows: entry.rows
  };
  const json = JSON.stringify(payload, (key, value) => (
    /^(dataDownloadUrl|downloadUrl)$/i.test(key) ? undefined : value
  ));
  await writeFile(persistentCachePath(workspace, kind), json);
}

async function fetchEntities(kind, workspace, maxItems) {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const operation = config.queries[kind];
  if (!operation) throw new Error(`Unknown entity kind: ${kind}`);

  const nodes = [];
  let after = null;
  for (;;) {
    const pageSize = 250;
    const first = maxItems ? Math.min(pageSize, maxItems - nodes.length) : pageSize;
    if (first <= 0) break;
    const data = await graphql(
      workspace,
      operation.query,
      { first, after },
      operation.operationName
    );
    const connection = getByPath(data, operation.connectionPath);
    if (!connection) {
      throw new Error(`Connection path not found for ${kind}: ${operation.connectionPath.join(".")}`);
    }
    nodes.push(...(connection.nodes || []));
    if (maxItems && nodes.length >= maxItems) break;
    if (!connection.pageInfo?.hasNextPage) break;
    after = connection.pageInfo.endCursor;
  }
  const normalized = nodes.map((node) => normalizeDesEntity(node, kind));
  if (kind === "symbols") {
    return normalized.sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { numeric: true }));
  }
  return selectLatestAllowedRevisions(normalized, kind);
}

async function listProjectsForMigration(forceRefresh = false) {
  const rows = await listEntities("projects", "source", null, forceRefresh);
  return rows.map((project) => ({
    ...project,
    revisionCount: project.revisions?.totalCount || 0,
    releaseCount: project.design?.releases?.totalCount || 0,
    historyPreservable: project.repositoryType === "INTERNAL" && Boolean(project.repositoryUrl)
  }));
}

async function projectMigrationDetails(projectId) {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const operation = config.queries.projectDetails;
  const data = await graphql("source", operation.query, { id: projectId }, operation.operationName);
  const project = getByPath(data, operation.resultPath);
  if (!project) throw httpError(404, "Source project not found");
  return project;
}

async function findTargetProjectsByName(name) {
  const query = `query FindTargetProject($name: String!) {
    desProjects(first: 20, where: { name: { eq: $name } }) {
      nodes { id projectId name repositoryType repositoryUrl url updatedAt }
    }
  }`;
  const data = await graphql("target", query, { name }, "FindTargetProject");
  return data.desProjects?.nodes || [];
}

async function listTargetProjectsInFolder(targetFolderId) {
  if (!targetFolderId) throw httpError(400, "Target project folder is required");
  const folder = await resolveTargetFolder("projects", targetFolderId);
  const rows = [];
  const warnings = [];
  // Use the actual catalog listing. A direct project entity can synthesize a
  // plausible path even when publication did not create a PROJECT folder.
  for (const entity of await targetProjectCatalogEntities(folder)) {
    const row = projectFolderRow(entity, folder);
    if (row) rows.push(row);
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return { folder: { id: folder.id, folderId: folder.folderId, name: folder.name, path: folder.path }, rows, warnings };
}

async function targetProjectCatalogEntities(folder) {
  const entities = [];
  const ids = new Set();
  for (let page = 0; ; page++) {
    const endpoint = new URL("/svc/explorer/api/v1/entities", endpoints.target);
    endpoint.search = new URLSearchParams({ selectedFolder: folder.folderId, pageSize: "100", page: String(page) }).toString();
    const payload = await targetServiceJson(endpoint.href, "Read destination project catalog");
    const batch = payload.entities || [];
    for (const entity of batch) {
      if (ids.has(entity.id)) throw new Error("Destination project catalog pagination did not advance.");
      ids.add(entity.id);
      entities.push(entity);
    }
    if (entities.length >= Number(payload.totalEntities ?? entities.length)) return entities;
    if (!batch.length) throw new Error("Destination project catalog listing is incomplete.");
  }
}

async function verifyTargetProjectPlacement(projectGuid, projectName, folder) {
  const [data, listedProjects, entity] = await Promise.all([
    graphql("target", `query VerifyProjectFolderPlacement {
      desLibrary { folders { folderId path folderType parent { folderId } } }
    }`, {}, "VerifyProjectFolderPlacement"),
    targetProjectCatalogEntities(folder), targetProjectEntity(projectGuid)
  ]);
  const detailsUrl = projectPlacementDetailsUrl(entity, endpoints.target, projectGuid);
  const projectMetadata = await targetServiceJson(detailsUrl, "Read destination project's native folder binding");
  return { ...assertProjectFolderPlacement({ projectGuid, projectName, folder,
    projectFolders: data.desLibrary?.folders || [], listedProjects, projectMetadata }), checkedAt: new Date().toISOString() };
}

async function targetProjectEntity(projectGuid) {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(projectGuid || "")) throw new Error("Invalid destination project GUID.");
  const endpoint = new URL(`/svc/explorer/api/v1/entities/${projectGuid}`, new URL(endpoints.target).origin);
  return targetServiceJson(endpoint.href, "Read destination project folder");
}

function projectAnalysisKey(projectId, targetFolderId, reuseEmptyTarget = false) {
  return [activeSourceWorkspaceId, endpoints.target, projectId, targetFolderId, reuseEmptyTarget ? "reuse-empty" : "create"].join("|");
}

async function loadProjectAnalysisCache() {
  if (projectAnalysisCacheLoaded) return;
  projectAnalysisCacheLoaded = true;
  try {
    const payload = JSON.parse(await readFile(projectAnalysisCachePath, "utf8"));
    if (payload.version !== PROJECT_ANALYSIS_VERSION || typeof payload.entries !== "object") return;
    for (const [key, value] of Object.entries(payload.entries)) {
      const age = Date.now() - Date.parse(value.cachedAt);
      if (Number.isFinite(age) && age <= cacheTtlMs && value.report) projectAnalysisCache.set(key, value);
    }
  } catch {
    // The cache is optional and is recreated after the first analysis.
  }
}

async function saveProjectAnalysisCache() {
  await mkdir(path.dirname(projectAnalysisCachePath), { recursive: true });
  await writeFile(projectAnalysisCachePath, JSON.stringify({
    version: PROJECT_ANALYSIS_VERSION,
    entries: Object.fromEntries(projectAnalysisCache)
  }, null, 2));
}

async function invalidateProjectAnalysis(projectId = null) {
  await loadProjectAnalysisCache();
  for (const key of [...projectAnalysisCache.keys()]) {
    if (!projectId || key.includes(`|${projectId}|`)) projectAnalysisCache.delete(key);
  }
  await saveProjectAnalysisCache();
}

function projectTransferRecordPath(projectId) {
  const key = createHash("sha256").update(`${endpoints.source}|${endpoints.target}|${projectId}`).digest("hex");
  return path.join(__dirname, "migration_state", "project-transfers", `${key}.json`);
}

async function saveProjectTransfer(record) {
  const filename = projectTransferRecordPath(record.sourceProjectId);
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(`${filename}.tmp`, JSON.stringify({ ...record, updatedAt: new Date().toISOString() }, null, 2));
  await rename(`${filename}.tmp`, filename);
  await invalidateProjectAnalysis(record.sourceProjectId);
}

async function recoverableProjectTransfer(project, folder, duplicates, { includeCompleted = false } = {}) {
  const record = await readJsonFile(projectTransferRecordPath(project.id), null);
  if (!record || (record.phase === "completed" && !includeCompleted) || record.sourceProjectId !== project.id
      || record.targetEndpoint !== endpoints.target || record.targetFolderId !== folder.id) return null;
  if (!record.localWorkingCopy || !record.tempRoot || !record.projectFilename) return null;
  const sourceOrigin = (await git([`--git-dir=${path.join(record.tempRoot, "source.git")}`, "remote", "get-url", "origin"], tokens.source)).stdout.trim();
  if (sourceOrigin !== project.repositoryUrl) return null;
  const currentSourceHead = (await git(["ls-remote", project.repositoryUrl, "HEAD"], tokens.source)).stdout.trim().split(/\s+/)[0];
  if (record.sourceHead && record.sourceHead !== currentSourceHead) throw new Error("The source changed since the interrupted transfer; inspect the saved migration before resuming.");
  if (duplicates.length !== 1) return null;
  const expectedGuid = record.targetProjectGuid || duplicates[0].projectId;
  const projectFilename = await publishedProjectWorkingCopyFile(record.localWorkingCopy, expectedGuid);
  const guid = managedProjectGuid(await readFile(path.join(record.localWorkingCopy, projectFilename)));
  if (!guid || duplicates.length !== 1 || guid.toLowerCase() !== duplicates[0].projectId.toLowerCase()) return null;
  if (record.targetProjectGuid && guid.toLowerCase() !== record.targetProjectGuid.toLowerCase()) return null;
  if (!projectFolderRow(await targetProjectEntity(guid), folder)) return null;
  // A completed transfer must also exist as a proper project folder in A365.
  // Keep incomplete transfers recoverable on the same GUID.
  const placementVerification = record.phase === "completed" ? await verifyTargetProjectPlacement(guid, project.name, folder) : null;
  return { ...record, sourceProjectFilename: record.sourceProjectFilename || record.projectFilename,
    projectFilename, targetProjectGuid: guid, targetProjectId: duplicates[0].id, placementVerification };
}

async function publishedProjectWorkingCopyFile(workingCopy, projectGuid) {
  const listing = await git(["-C", workingCopy, "ls-files", "-z"], tokens.target);
  return selectPublishedProjectFile(listing.stdout.split("\0").filter(Boolean), projectGuid, async (filename) => {
    const paths = await validateMigrationProjectPath(workingCopy, filename);
    return readFile(paths.projectFullPath);
  });
}

async function projectMigrationPreflight(projectId, targetFolderId, forceRefresh = false, reuseEmptyTarget = false) {
  if (!projectId) throw httpError(400, "Source project id is required");
  if (!targetFolderId) throw httpError(400, "Target project folder is required");
  await loadProjectAnalysisCache();
  const cacheKey = projectAnalysisKey(projectId, targetFolderId, reuseEmptyTarget);
  if (!forceRefresh && projectAnalysisCache.has(cacheKey)) {
    const cached = projectAnalysisCache.get(cacheKey);
    return projectDesignerReadiness({ ...cached.report, cache: { hit: true, cachedAt: cached.cachedAt } }, reuseEmptyTarget);
  }
  const folder = await resolveTargetFolder("projects", targetFolderId);
  const project = await projectMigrationDetails(projectId);
  const duplicates = await findTargetProjectsByName(project.name || "");
  const blockers = [];
  const warnings = [];
  if (!reuseEmptyTarget && project.projectType !== "PCB_PROJECT") {
    blockers.push("Native Designer migration currently supports PCB projects (.PrjPcb) only. No project will be published for this project type.");
  }
  let existingTargetProject = null;
  let resumeTransfer = null;
  let completedTransfer = null;
  let placementInvalid = false;
  let emptyTargetCheck = null;
  let targetApi = null;
  try {
    targetApi = await checkProjectApiAccess({
      services: await discoverProjectUploadEndpoints(), token: tokens.target
    });
  } catch (error) {
    blockers.push(`The destination Project API cannot be accessed: ${error.message}`);
  }
  let gitReadable = false;
  if (project.repositoryType !== "INTERNAL" || !project.repositoryUrl) {
    blockers.push("The project is not backed by an accessible internal Git repository; its full history cannot be mirrored.");
  } else {
    try {
      await git(["ls-remote", "--heads", project.repositoryUrl], tokens.source, { timeout: 60_000 });
      gitReadable = true;
    } catch (error) {
      blockers.push(`The source Git repository cannot be read: ${error.message}`);
    }
  }
  if (!reuseEmptyTarget && duplicates.length) {
    try {
      const transfer = await recoverableProjectTransfer(project, folder, duplicates, { includeCompleted: true });
      if (transfer?.phase === "completed") completedTransfer = transfer;
      else resumeTransfer = transfer;
    }
    catch (error) {
      if (error.code === "PROJECT_FOLDER_INVALID") { placementInvalid = true; blockers.push(error.message); }
      else warnings.push(`The previous local transfer cannot be resumed: ${error.message}`);
    }
    if (!resumeTransfer && !completedTransfer && !placementInvalid) blockers.push("A project with the same name already exists in the target workspace and is not identified as an unfinished transfer from this app. No new project will be created.");
    else if (resumeTransfer) {
      warnings.push("An unfinished project created by this app was found. Migration will resume that same project; no duplicate will be created.");
      if (resumeTransfer.phase === "native-in-flight") {
        const evidence = resumeTransfer.nativeEvidencePath ? await readFile(resumeTransfer.nativeEvidencePath, "utf8").catch(() => "") : "";
        if (!/^returned$/m.test(evidence.replaceAll("\r", ""))) blockers.push("The native VCS migration has not returned. Finish or cancel the pending Designer dialog before any retry; no second command will be sent.");
      }
    }
  }
  if (reuseEmptyTarget) {
    if (duplicates.length !== 1) {
      blockers.push(`Create exactly one empty project named ${project.name} in ${folder.path}, then refresh the destination projects.`);
    } else {
      try {
        const destination = await listTargetProjectsInFolder(targetFolderId);
        if (!destination.rows.some((row) => String(row.projectId).toLowerCase() === String(duplicates[0].projectId).toLowerCase())) {
          throw new Error("The existing target project is not in the selected destination folder");
        }
        await verifyTargetProjectPlacement(duplicates[0].projectId, project.name, folder);
        existingTargetProject = await targetProjectRepository(duplicates[0].id, { includeCounts: true });
        emptyTargetCheck = await inspectEmptyTargetProject(existingTargetProject);
      } catch (error) {
        blockers.push(error.message);
      }
    }
  }
  const report = {
    project: {
      id: project.id,
      projectId: project.projectId,
      name: project.name,
      description: project.description,
      projectType: project.projectType,
      repositoryType: project.repositoryType,
      revisionCount: project.revisions?.totalCount || 0,
      releaseCount: project.design?.releases?.totalCount || 0,
      latestRevision: project.latestRevision
    },
    targetFolder: { id: folder.id, folderId: folder.folderId, name: folder.name, path: folder.path },
    targetDuplicates: duplicates,
    targetApi,
    creationMode: reuseEmptyTarget ? "reuse-empty" : placementInvalid ? "placement-invalid" : completedTransfer ? "completed" : resumeTransfer ? "designer-resume" : "designer-native",
    resumeTransfer,
    alreadyMigrated: Boolean(completedTransfer),
    placementVerification: completedTransfer?.placementVerification || null,
    existingTargetProject,
    emptyTargetCheck,
    sourceProjectUrl: project.url,
    preservation: {
      gitHistory: gitReadable,
      nativeReleaseAssociations: false,
      releaseFileStrategy: "source-workspace"
    },
    blockers,
    warnings,
    executable: blockers.length === 0 && !completedTransfer
  };
  const cachedAt = new Date().toISOString();
  projectAnalysisCache.set(cacheKey, { cachedAt, report });
  await saveProjectAnalysisCache();
  return projectDesignerReadiness({ ...report, cache: { hit: false, cachedAt } }, reuseEmptyTarget);
}

async function projectDesignerReadiness(report, reuseEmptyTarget) {
  if (report.alreadyMigrated) {
    try {
      const placementVerification = await verifyTargetProjectPlacement(report.targetDuplicates[0].projectId, report.project.name, report.targetFolder);
      return { ...report, placementVerification };
    } catch (error) { return { ...report, placementVerification: null, alreadyMigrated: false, creationMode: "placement-invalid", executable: false, blockers: [...report.blockers, error.message] }; }
  }
  if (reuseEmptyTarget) return report;
  if (report.blockers.some((message) => message.includes("native VCS migration has not returned"))) {
    const evidence = report.resumeTransfer?.nativeEvidencePath ? await readFile(report.resumeTransfer.nativeEvidencePath, "utf8").catch(() => "") : "";
    if (!/^returned$/m.test(evidence.replaceAll("\r", ""))) return report;
    report = { ...report, blockers: report.blockers.filter((message) => !message.includes("native VCS migration has not returned")) };
  }
  const blockers = [...report.blockers];
  let designer = null;
  try {
    const health = await designerBridgeRequest("/health", { authenticated: false });
    if (!health.capabilities?.includes("project-migration")) {
      throw new Error("Load Designer bridge 1.1.35 or later to enable native project publication.");
    }
    designer = assertDesignerDestination(await designerBridgeRequest("/v1/projects/migration-status"), endpoints.target);
  } catch (error) { blockers.push(error.message); }
  return { ...report, designer, blockers, executable: blockers.length === 0 };
}

function gitAuthenticationEnv(token) {
  const basicCredentials = Buffer.from(`token:${token}`, "utf8").toString("base64");
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${basicCredentials}`
  };
}

async function git(args, token, options = {}) {
  try {
    return await execFileAsync("git", args, {
      windowsHide: true,
      timeout: options.timeout || 15 * 60_000,
      maxBuffer: 10 * 1024 * 1024,
      env: gitAuthenticationEnv(token),
      ...options
    });
  } catch (error) {
    const detail = [error.stderr, error.stdout, error.message].filter(Boolean).join("\n");
    throw new Error(`Git operation failed: ${detail}`);
  }
}

async function targetProjectRepository(projectId, { allowExternal = false, includeCounts = false } = {}) {
  const query = `query TargetMigratedProject($id: ID!) {
    desProjectById(id: $id) { id projectId name repositoryType repositoryUrl url design { releases(first: 1) { totalCount } } }
  }`;
  let lastError = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const data = await graphql("target", query, { id: projectId }, "TargetMigratedProject");
      const project = data.desProjectById;
      if (project?.repositoryType === "EXTERNAL") {
        if (allowExternal) return project;
        const error = new Error(`Project ${project.projectId} is still registered with external version control. The native migration to Altium Versioned Storage did not complete; no duplicate will be created.`);
        error.code = "EXTERNAL_PROJECT";
        throw error;
      }
      if (project?.repositoryType === "INTERNAL" && project.repositoryUrl) {
        if (includeCounts) {
          const counts = await graphql("target", "query TargetProjectRevisionCount($id: ID!) { desProjectById(id: $id) { revisions(first: 1) { totalCount } } }", { id: projectId }, "TargetProjectRevisionCount");
          project.revisions = counts.desProjectById.revisions;
        }
        return project;
      }
    } catch (error) {
      if (error.code === "EXTERNAL_PROJECT") throw error;
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`The target project repository was not available after upload${lastError ? `: ${lastError.message}` : ""}`);
}

async function inspectEmptyTargetProject(project) {
  if (project.revisions?.totalCount > 1 || project.design?.releases?.totalCount > 0) {
    throw new Error("The existing target project has history or releases and cannot be reused as an empty project");
  }
  if (project.repositoryType !== "INTERNAL") throw new Error("The target project must use an internal Git repository");
  const remote = await git(["ls-remote", project.repositoryUrl], tokens.target, { timeout: 60_000 });
  if (!remote.stdout.trim()) return assertEmptyProjectTarget({ refsOutput: "", commitCount: 0, files: [] });
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "altium-empty-target-check-"));
  const mirror = path.join(temporaryDirectory, "target.git");
  try {
    await git(["clone", "--mirror", project.repositoryUrl, mirror], tokens.target, { timeout: 60_000 });
    const count = await git([`--git-dir=${mirror}`, "rev-list", "--all", "--count"], tokens.target);
    if (Number(count.stdout.trim()) > 1) throw new Error("The target repository has more than one commit and will not be overwritten");
    const listing = await git([`--git-dir=${mirror}`, "ls-tree", "-r", "-z", "--name-only", "HEAD"], tokens.target);
    const paths = listing.stdout.split("\0").filter(Boolean);
    if (paths.length > 1) throw new Error("The target repository contains files and will not be overwritten");
    const files = [];
    for (const filename of paths) {
      const blob = await git([`--git-dir=${mirror}`, "show", `HEAD:${filename}`], tokens.target, { encoding: "buffer" });
      files.push({ path: filename, bytes: blob.stdout });
    }
    return assertEmptyProjectTarget({ refsOutput: remote.stdout, commitCount: Number(count.stdout.trim()), files });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function createTargetProjectThroughDesigner(project, folder, mirrorPath, tempRoot, resumeTransfer = null) {
  // A new local bare origin prevents Designer from ever pushing to the source.
  const localOrigin = path.join(tempRoot, "temporary-origin.git");
  const workingCopy = path.join(tempRoot, "working-copy");
  if (!resumeTransfer) {
    await git(["clone", "--bare", mirrorPath, localOrigin], tokens.source);
    await git(["clone", localOrigin, workingCopy], tokens.source);
  }
  const listing = await git(["-C", workingCopy, "ls-files", "-z"], tokens.source);
  const filename = selectMigrationProjectFile(listing.stdout.split("\0").filter(Boolean), project.name, resumeTransfer?.projectFilename);
  const projectPaths = await validateMigrationProjectPath(workingCopy, filename);
  const { projectFullPath, workingCopyPath } = projectPaths;
  if (projectPaths.nestedProject) {
    const status = assertDesignerDestination(await designerBridgeRequest("/v1/projects/migration-status"), endpoints.target);
    if (!status.nestedProjectPathsSupported) throw new Error("Load Designer bridge 1.1.36 or later to migrate a PCB project stored in a Git subfolder. No project was published.");
  }
  let record = resumeTransfer || { sourceProjectId: project.id, sourceHead: (await git([`--git-dir=${mirrorPath}`, "rev-parse", "HEAD"], tokens.source)).stdout.trim(),
    targetEndpoint: endpoints.target, targetFolderId: folder.id, tempRoot, localWorkingCopy: workingCopy, projectFilename: filename, phase: "prepared" };
  let published;
  if (resumeTransfer) {
    published = { projectGuid: resumeTransfer.targetProjectGuid, workspace: await designerBridgeRequest("/v1/projects/migration-status") };
  } else {
    await writeFile(projectFullPath, detachManagedProject(await readFile(projectFullPath)));
    await git(["-C", workingCopy, "add", "--", filename], tokens.source);
    await git(["-C", workingCopy, "-c", "user.name=Altium Migration Assistant", "-c", "user.email=altium-migration@localhost",
      "commit", "--allow-empty", "-m", "Detach migration copy from source workspace"], tokens.source);
    await git(["-C", workingCopy, "push", "origin", "HEAD"], tokens.source);
    await saveProjectTransfer(record);
    published = await projectNativeRequest(altiumDesignerBridgeUrl, altiumDesignerBridgeToken, "/v1/projects/publish-migration", {
      projectFullPath, workingCopyPath, name: project.name, description: nativeProjectDescription(project.description),
      folderPath: projectPublicationPath(folder, project.name), workspaceUrl: endpoints.target
    });
  }
  const workspace = assertDesignerDestination(published.workspace, endpoints.target);
  const guid = String(published.projectGuid || "").replace(/[{}]/g, "");
  if (!/^[0-9a-f-]{36}$/i.test(guid)) throw new Error("Designer returned no valid target project identifier; inspect it before retrying.");
  const targetId = `grid:workspace:${workspace.workspaceGuid.replace(/[{}]/g, "")}:design:project/${guid}`;
  record = { ...record, targetProjectGuid: guid, targetProjectId: targetId };
  await saveProjectTransfer(record);
  const registration = await targetProjectRepository(targetId, { allowExternal: true });
  if (registration.repositoryType === "EXTERNAL") {
    assertDesignerDestination(await designerBridgeRequest("/v1/projects/migration-status"), endpoints.target);
    const nativeScriptPath = path.join(tempRoot, `complete-vcs-${Date.now()}.pas`);
    const nativeEvidencePath = `${nativeScriptPath}.result.txt`;
    await writeFile(nativeScriptPath, nativeVcsMigrationScript({ projectFullPath, projectGuid: guid, evidencePath: nativeEvidencePath }));
    record = { ...record, phase: "native-in-flight", nativeEvidencePath };
    await saveProjectTransfer(record);
    await projectNativeRequest(altiumDesignerBridgeUrl, altiumDesignerBridgeToken, "/v1/processes/execute", {
      process: "ScriptingSystem:RunScriptFile", parameters: `FileName=${nativeScriptPath}|ProcName=CompleteProjectVcsMigration`
    });
    const evidence = await readFile(nativeEvidencePath, "utf8").catch(() => "");
    if (!/^returned$/m.test(evidence.replaceAll("\r", ""))) throw new Error("The native VCS migration has not returned a completion marker. Inspect Designer before retrying.");
    record = { ...record, phase: "native-returned" };
    await saveProjectTransfer(record);
  }
  const target = await targetProjectRepository(targetId);
  const publishedFilename = await publishedProjectWorkingCopyFile(workingCopy, guid);
  record = { ...record, sourceProjectFilename: record.sourceProjectFilename || record.projectFilename, projectFilename: publishedFilename };
  await saveProjectTransfer(record);
  const targetEntity = await targetProjectEntity(guid);
  if (!projectFolderRow(targetEntity, folder)) {
    throw new Error(`Designer created project ${guid} outside the selected destination folder. Inspect it before retrying.`);
  }
  await verifyTargetProjectPlacement(guid, project.name, folder);
  return { ...target, migrationFilename: publishedFilename, localWorkingCopy: workingCopy };
}

async function verifyDesignerProjectHistory(project, mirrorPath, tempRoot, sourceOutput) {
  const audit = path.join(await mkdtemp(path.join(tempRoot, "destination-audit-")), "repository.git");
  await git(["clone", "--mirror", project.repositoryUrl, audit], tokens.target);
  const targetHead = (await git([`--git-dir=${audit}`, "rev-parse", "HEAD"], tokens.target)).stdout.trim();
  const sourceHead = (await git([`--git-dir=${mirrorPath}`, "rev-parse", "HEAD"], tokens.source)).stdout.trim();
  await git([`--git-dir=${audit}`, "fetch", "--no-tags", mirrorPath, "+refs/heads/*:refs/migration-source/*"], tokens.source);
  // The destination default branch must actually contain the original history,
  // not just a disconnected archive branch holding the old commits.
  await git([`--git-dir=${audit}`, "merge-base", "--is-ancestor", sourceHead, targetHead], tokens.target);
  const remoteRefs = await git(["ls-remote", project.repositoryUrl], tokens.target);
  const refs = projectRefs(remoteRefs.stdout);
  for (const [ref, sha] of projectRefs(sourceOutput)) {
    if (!refs.has(ref)) {
      // Preserve additional original branches/tags, without replacing any ref.
      await git([`--git-dir=${mirrorPath}`, "push", `--force-with-lease=${ref}:`, project.repositoryUrl, `${sha}:${ref}`], tokens.target);
    }
  }
  await git([`--git-dir=${audit}`, "fetch", "origin"], tokens.target);
  const targetRefs = await git(["ls-remote", project.repositoryUrl], tokens.target);
  const verification = await verifyNativeProjectHistory({ sourceOutput, targetOutput: targetRefs.stdout,
    isAncestor: async (source, destination) => {
      try { await git([`--git-dir=${audit}`, "merge-base", "--is-ancestor", source, destination], tokens.target); return true; }
      catch { return false; }
    }
  });
  const targetFiles = await git([`--git-dir=${audit}`, "ls-tree", "-r", "-z", "--name-only", targetHead], tokens.target);
  const publishedFilename = await selectPublishedProjectFile(targetFiles.stdout.split("\0").filter(Boolean), project.projectId,
    async (filename) => (await git([`--git-dir=${audit}`, "show", `${targetHead}:${filename}`], tokens.target, { encoding: "buffer" })).stdout);
  const savedProject = await git([`--git-dir=${audit}`, "show", `${targetHead}:${publishedFilename}`], tokens.target, { encoding: "buffer" });
  if (managedProjectGuid(savedProject.stdout).toLowerCase() !== project.projectId.replace(/[{}]/g, "").toLowerCase()) {
    throw new Error("The published default branch is not bound to the destination project. No successful migration was recorded.");
  }
  const expectedDocuments = projectDesignDocuments(savedProject.stdout);
  return { ...verification, projectFilename: publishedFilename, targetHead, expectedDocuments };
}

async function verifyPublishedProjectCloud(project, historyVerification) {
  const entity = await targetProjectEntity(project.projectId);
  const nativeDetails = new URL(projectPlacementDetailsUrl(entity, endpoints.target, project.projectId));
  nativeDetails.pathname = `/multicad/api/v1.0/projects/${project.projectId}/details`;
  return waitForProjectCloudData(async () => {
    const [details, data] = await Promise.all([
      targetServiceJson(nativeDetails.href, "Read published project's cloud generation status"),
      graphql("target", `query VerifyPublishedDesign($id: ID!) { desProjectById(id: $id) { latestRevision { revisionId files { path } } design { variants { schematics { documentName } pcb { documentName } } } } }`, { id: project.id }, "VerifyPublishedDesign")
    ]);
    const current = data.desProjectById;
    const targetHead = historyVerification.targetHead || current?.latestRevision?.revisionId;
    if (!targetHead || current?.latestRevision?.revisionId !== targetHead) throw new Error("The destination changed during cloud validation. Inspect the existing target before resuming.");
    return projectCloudState({ projectGuid: project.projectId, targetHead, details,
      variants: current?.design?.variants || [], expectedDocuments: historyVerification.expectedDocuments || (current?.latestRevision?.files || []).map((file) => file.path) });
  });
}

async function migrateProjectWithHistory(projectId, targetFolderId, reuseEmptyTarget = false) {
  const analysis = await projectMigrationPreflight(projectId, targetFolderId, true, reuseEmptyTarget);
  if (!analysis.executable) throw httpError(409, `Migration blocked: ${analysis.blockers.join(" ")}`);
  const [project, folder] = await Promise.all([
    projectMigrationDetails(projectId),
    resolveTargetFolder("projects", targetFolderId)
  ]);
  const tempRoot = analysis.resumeTransfer?.tempRoot || await mkdtemp(path.join(os.tmpdir(), "altium-project-migration-"));
  const mirrorPath = path.join(tempRoot, "source.git");
  let targetProject = null;
  try {
    if (!analysis.resumeTransfer) await git(["clone", "--mirror", project.repositoryUrl, mirrorPath], tokens.source);

    targetProject = reuseEmptyTarget ? analysis.existingTargetProject
      : await createTargetProjectThroughDesigner(project, folder, mirrorPath, tempRoot, analysis.resumeTransfer);

    const sourceRefs = await git([`--git-dir=${mirrorPath}`, "for-each-ref", "--format=%(objectname) %(refname)"], tokens.source);
    let defaultBranchAlias = null;
    if (reuseEmptyTarget) {
      const currentRefs = await git(["ls-remote", targetProject.repositoryUrl], tokens.target);
      assertProjectTargetUnchanged(analysis.emptyTargetCheck.refsOutput, currentRefs.stdout);
      const sourceHead = await git([`--git-dir=${mirrorPath}`, "rev-parse", "HEAD"], tokens.source);
      defaultBranchAlias = emptyTargetDefaultBranchAlias(sourceRefs.stdout, currentRefs.stdout, sourceHead.stdout);
      if (defaultBranchAlias) {
        await git([`--git-dir=${mirrorPath}`, "update-ref", defaultBranchAlias.name, defaultBranchAlias.sha], tokens.source);
        sourceRefs.stdout += `${defaultBranchAlias.sha} ${defaultBranchAlias.name}\n`;
      }
      await git([`--git-dir=${mirrorPath}`, ...guardedProjectMirrorArgs(targetProject.repositoryUrl, sourceRefs.stdout, currentRefs.stdout)], tokens.target);
    }

    const historyVerification = reuseEmptyTarget
      ? assertMirroredProjectRefs(sourceRefs.stdout, (await git(["ls-remote", targetProject.repositoryUrl], tokens.target)).stdout)
      : await verifyDesignerProjectHistory(targetProject, mirrorPath, tempRoot, sourceRefs.stdout);

    // Recheck the native association after history transfer, including
    // the existing-empty-target path, before recording any successful migration.
    const placementVerification = await verifyTargetProjectPlacement(targetProject.projectId, project.name, folder);
    if (!reuseEmptyTarget) {
      const record = await readJsonFile(projectTransferRecordPath(projectId), null);
      if (record) await saveProjectTransfer({ ...record, phase: "cloud-validation-pending", historyVerification, placementVerification });
    }
    const cloudVerification = await verifyPublishedProjectCloud(targetProject, historyVerification);
    await invalidateProjectAnalysis(projectId);
    if (!reuseEmptyTarget) {
      const record = await readJsonFile(projectTransferRecordPath(projectId), null);
      if (record) await saveProjectTransfer({ ...record, phase: "completed", placementVerification, cloudVerification, releaseStrategy: "source-workspace" });
    }
    const result = {
      status: "migrated",
      sourceProjectId: project.id,
      targetProjectId: targetProject.id,
      targetProjectUrl: targetProject.url,
      historyRevisions: analysis.project.revisionCount,
      historyVerification,
      placementVerification,
      cloudVerification,
      creationMode: analysis.creationMode,
      defaultBranchAlias: defaultBranchAlias?.name || null,
      releaseStrategy: "source-workspace",
      sourceProjectUrl: project.url,
      localWorkingCopy: targetProject.localWorkingCopy || null
    };
    const logWarning = await trySaveProjectMigrationLog(saveMigrationLog, { project: analysis.project, targetFolder: analysis.targetFolder, result });
    if (logWarning) result.logWarning = logWarning;
    return result;
  } catch (error) {
    if (!reuseEmptyTarget) error.message += ` Local migration data retained at ${tempRoot}. Do not retry until Designer and the destination have been checked.`;
    if (targetProject) {
      error.message += ` Target project ${targetProject.name || targetProject.id} may contain a partial migration; review it before retrying.`;
    }
    const logWarning = await trySaveProjectMigrationLog(saveMigrationLog, { project: analysis.project, targetFolder: analysis.targetFolder,
      result: { status: "failed", error: error.message, requestId: error.requestId || null,
        uploadedFileId: error.uploadedFileId || null, creationMode: analysis.creationMode } });
    if (logWarning) error.message += ` ${logWarning}`;
    throw error;
  } finally {
    // Designer may still hold the working copy, including after an HTTP timeout.
    // Never delete it under an open project or an in-flight native command.
    if (reuseEmptyTarget) await rm(tempRoot, { recursive: true, force: true });
  }
}

function selectLatestAllowedRevisions(rows, kind, allowedStatesOverride = null) {
  if (!new Set(["symbols", "footprints", "components"]).has(kind)) return rows;

  const allowedStates = allowedStatesOverride || (kind === "components"
    ? new Set(["prototype", "production"])
    : new Set(["approved"]));
  if (kind === "components" && !allowedStatesOverride) {
    return rows.filter((row) => isMigratableComponentState(row.lifecycleState))
      .sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { numeric: true }));
  }
  const latestByItem = new Map();
  for (const row of rows) {
    if (!allowedStates.has((row.lifecycleState || "").trim().toLowerCase())) continue;
    const key = stableLibraryItemKey(row, kind);
    const current = latestByItem.get(key);
    if (!current || compareLibraryRevisions(row, current) > 0) latestByItem.set(key, row);
  }

  return [...latestByItem.values()]
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { numeric: true }));
}

function stableLibraryItemKey(row, kind) {
  if (kind !== "components" && row.itemInternalId) return row.itemInternalId;
  return (row.name || row.id).replace(/[-.]\d+$/, "").toLowerCase();
}

function compareLibraryRevisions(left, right) {
  const leftDate = Date.parse(left.releasedAt || left.modifiedAt || left.createdAt || 0) || 0;
  const rightDate = Date.parse(right.releasedAt || right.modifiedAt || right.createdAt || 0) || 0;
  if (leftDate !== rightDate) return leftDate - rightDate;
  return revisionSequence(left.name) - revisionSequence(right.name);
}

function revisionSequence(name = "") {
  const match = name.match(/[-.](\d+)$/);
  return match ? Number(match[1]) : 0;
}

function normalizeDesEntity(entity, kind) {
  const folderPath = entity.folder?.path || "";
  if (kind === "symbols" || kind === "footprints") {
    return {
      ...entity,
      revisionId: entity.revisionInternalId,
      folderPath,
      lifecycleState: entity.lifeCycleState?.name || ""
    };
  }

  if (kind === "componentTemplates") {
    return {
      ...entity,
      revisionId: entity.latestRevision?.id,
      folderPath
    };
  }

  if (kind === "components") {
    const details = entity.details || {};
    const symbols = details.symbols || [];
    const footprints = details.footprints || [];
    return {
      ...entity,
      folderPath,
      componentTypeId: entity.componentType?.componentTypeId || "",
      componentTypeName: entity.componentType?.name || "",
      lifecycleState: entity.revision?.details?.lifeCycleState?.name || "",
      template: entity.componentTemplate || null,
      parameters: details.parameters || [],
      itemParameters: details.itemParameters || [],
      manufacturerParts: entity.manufacturerParts || [],
      symbols,
      footprints,
      models: [
        ...symbols.map((model) => ({ ...model, modelType: "symbol" })),
        ...footprints.map((model) => ({ ...model, modelType: "footprint" }))
      ]
    };
  }

  return entity;
}

async function hydrateComponentDetails(component, workspace = "source") {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const operation = config.queries.componentDetails;
  try {
    const data = await graphql(workspace, operation.query, { id: component.id }, operation.operationName);
    const hydrated = getByPath(data, operation.resultPath);
    if (!hydrated) throw new Error(`Component not found: ${component.id}`);
    return normalizeDesEntity({ ...component, ...hydrated }, "components");
  } catch (error) {
    return {
      ...component,
      parameters: [],
      itemParameters: [],
      symbols: [],
      footprints: [],
      models: [],
      detailsLoadError: error.message
    };
  }
}

async function hydrateLibraryModel(item, kind, workspace = "source") {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const operation = config.queries[kind === "symbols" ? "symbolDetails" : "footprintDetails"];
  const data = await graphql(workspace, operation.query, { id: item.id }, operation.operationName);
  const hydrated = getByPath(data, operation.resultPath);
  if (!hydrated) throw new Error(`${kind} not found: ${item.id}`);
  return normalizeDesEntity({ ...item, ...hydrated }, kind);
}

async function downloadModelThumbnail(kind, id, workspace = "source") {
  const item = await hydrateLibraryModel({ id }, kind, workspace);
  if (!item.imageThumbnailUrl) throw httpError(404, `No preview is available for ${item.name}`);
  let response;
  try {
    response = await fetch(item.imageThumbnailUrl, { signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    throw new Error(`Preview download failed for ${item.name}: ${error.message}`);
  }
  if (!response.ok) {
    throw new Error(`Preview download failed for ${item.name} (HTTP ${response.status})`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const responseType = response.headers.get("content-type") || "";
  const contentType = responseType.startsWith("image/") ? responseType
    : bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      ? "image/png"
      : bytes[0] === 0xff && bytes[1] === 0xd8 ? "image/jpeg" : "application/octet-stream";
  return { bytes, contentType };
}

async function downloadLibraryModelFiles(item, kind, workspace) {
  if (!item.dataDownloadUrl) throw httpError(404, `No library file is available for ${item.name || item.id}`);
  const response = await fetch(item.dataDownloadUrl, {
    headers: { authorization: `Bearer ${tokens[workspace]}` },
    signal: AbortSignal.timeout(60_000)
  });
  if (!response.ok) {
    throw new Error(`Download ${item.name || item.id} failed on ${workspaceLabels[workspace]} (HTTP ${response.status})`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const fallbackExtension = kind === "symbols" ? ".SchLib" : ".PcbLib";
  const filename = responseFilename(response.headers.get("content-disposition"))
    || `${baseItemName(item.name || kind)}${fallbackExtension}`;
  if (bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50) return extractZipFiles(bytes);
  return [{ bytes, filename: path.basename(filename) }];
}

function renderCacheKey(kind, id, workspace) {
  return createHash("sha256")
    .update(`${LIBRARY_RENDER_VERSION}:${workspace}:${kind}:${id}`)
    .digest("hex");
}

async function ensureLibraryRender(kind, id, workspace, view, layers = null) {
  const key = renderCacheKey(kind, id, workspace);
  const folder = path.join(renderCacheDir, key.slice(0, 2), key);
  const layerSuffix = Array.isArray(layers) ? `-${createHash("sha1").update(layers.join(",")).digest("hex").slice(0, 12)}` : "";
  const outputPath = path.join(folder, view === "3d" ? "scene.json" : `preview${layerSuffix}.svg`);
  if (existsSync(outputPath)) return outputPath;
  if (!existsSync(rendererDllPath)) {
    throw new Error("The local Altium library renderer is not installed in renderer/runtime");
  }

  await mkdir(folder, { recursive: true });
  const item = await hydrateLibraryModel({ id }, kind, workspace);
  const files = await downloadLibraryModelFiles(item, kind, workspace);
  const expectedExtension = kind === "symbols" ? ".schlib" : ".pcblib";
  const libraryFile = files.find((file) => path.extname(file.filename).toLowerCase() === expectedExtension);
  if (!libraryFile) throw new Error(`${item.name || id} did not provide a ${expectedExtension} file`);
  const inputPath = path.join(folder, `source${expectedExtension}`);
  await writeFile(inputPath, libraryFile.bytes);
  const command = view === "3d" ? "scene3d" : "render2d";
  try {
    const rendererArgs = [rendererDllPath, command, inputPath, outputPath];
    if (view === "2d" && Array.isArray(layers)) rendererArgs.push(layers.join(","));
    await execFileAsync("dotnet", rendererArgs, {
      timeout: 90_000,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024
    });
  } catch (error) {
    const detail = [error.stderr, error.stdout, error.message].filter(Boolean).join("\n");
    throw new Error(`Unable to render ${item.name || id}: ${detail}`);
  }
  return outputPath;
}

const targetFolderRules = {
  symbols: { folderType: "SCHEMATIC_SYMBOL_LIBRARY" },
  footprints: { folderType: "PCB_COMPONENT_LIBRARY" },
  components: { folderType: "COMPONENT_LIBRARY" },
  projects: { folderType: "PROJECT_CATALOG" }
};
const ignoredTargetFolderNames = new Set([
  "temp_symbol_migration",
  "temp_ftp_migration",
  "temp_migration"
]);

async function listTargetFolders(kind) {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const rule = targetFolderRules[kind];
  if (!rule) throw new Error(`No target folder rule configured for ${kind}`);
  const query = config.queries.folders;
  const data = await graphql("target", query.query, {}, query.operationName);
  const folders = getByPath(data, query.resultPath) || [];
  const foldersById = new Map(folders.map((folder) => [folder.id, folder]));
  return folders
    .filter((folder) => folder.folderType === rule.folderType)
    .filter((folder) => !ignoredTargetFolderNames.has(folder.name.toLowerCase()))
    .map((folder) => ({
      ...folder,
      effectiveItemNamingSchemeTemplate: effectiveFolderNamingScheme(folder, foldersById)
    }))
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
}

function effectiveFolderNamingScheme(folder, foldersById) {
  const visited = new Set();
  let current = folder;
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    if (current.itemNamingSchemeTemplate) return current.itemNamingSchemeTemplate;
    current = current.parent?.id
      ? (foldersById.get(current.parent.id) || current.parent)
      : null;
  }
  return null;
}

async function resolveTargetFolder(kind, folderId) {
  if (!folderId) throw httpError(400, `Select a ${workspaceLabels.target} destination folder before migration`);
  const folders = await listTargetFolders(kind);
  const folder = folders.find((candidate) => candidate.id === folderId);
  if (!folder) {
    throw httpError(400, "The selected destination folder is invalid, incompatible, or excluded");
  }
  return folder;
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function assertNoPayloadErrors(payload, action) {
  const messages = (payload?.errors || []).map((error) => error.message).filter(Boolean);
  if (messages.length) throw new Error(`${action}: ${messages.join("; ")}`);
}

async function downloadSourceModelFiles(item, kind) {
  if (!item.dataDownloadUrl) throw new Error(`No download URL returned for ${item.name}`);
  const response = await fetch(item.dataDownloadUrl, {
    headers: { authorization: `Bearer ${tokens.source}` }
  });
  if (!response.ok) throw new Error(`Download ${item.name} failed (HTTP ${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const fallbackExtension = kind === "symbols" ? ".SchLib" : ".PcbLib";
  const filename = responseFilename(response.headers.get("content-disposition"))
    || `${baseItemName(item.name)}${fallbackExtension}`;
  if (bytes.readUInt32LE(0) === 0x04034b50) {
    return extractZipFiles(bytes).map((file) => ({
      ...file,
      bytes: removeSourceRevisionBindings(file.bytes, file.filename)
    }));
  }
  return [{
    bytes: removeSourceRevisionBindings(bytes, filename),
    filename: path.basename(filename),
    relativePath: `Released/${path.basename(filename)}`,
    contentType: response.headers.get("content-type") || "application/octet-stream"
  }];
}

async function inspectTargetModelRevisionBinding(model, kind) {
  const current = await hydrateLibraryModel({ id: model.id }, kind, "target");
  if (!current.dataDownloadUrl || !current.revisionInternalId) {
    throw new Error(`The selected target model revision is unavailable: ${model.name}`);
  }
  const response = await fetch(current.dataDownloadUrl, {
    headers: { authorization: `Bearer ${tokens.target}` }
  });
  if (!response.ok) throw new Error(`Cannot inspect target model ${model.name} (HTTP ${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const files = bytes.readUInt32LE(0) === 0x04034b50
    ? extractZipFiles(bytes) : [{ bytes, filename: model.name }];
  for (const file of files) {
    const embeddedRevision = embeddedModelRevisionGuid(file.bytes, file.filename);
    if (embeddedRevision && embeddedRevision.toLowerCase() !== current.revisionInternalId.toLowerCase()) {
      return { status: "affected", embeddedRevisionId: embeddedRevision };
    }
  }
  return { status: "clean" };
}

async function assertTargetModelRevisionBinding(model, kind) {
  if (model.origin !== "migration") return;
  const diagnostic = await inspectTargetModelRevisionBinding(model, kind);
  if (diagnostic.status === "affected") {
    throw new Error(`The migrated model ${model.name} still contains source revision ${diagnostic.embeddedRevisionId}; select a different target revision before releasing this component.`);
  }
}

async function completedFootprintBindingDiagnostics() {
  if (footprintBindingDiagnosticsLoad) return footprintBindingDiagnosticsLoad;
  footprintBindingDiagnosticsLoad = (async () => {
    const completed = await loadCompletedMigrations();
    const cache = await readJsonFile(footprintBindingCachePath, { version: 2, entries: {} });
    if (cache.version !== 2) {
      cache.version = 2;
      cache.entries = {};
    }
    cache.entries ||= {};
    const results = {};
    const pending = [];
    for (const [sourceId, entry] of Object.entries(completed.footprints)) {
      if (!entry.targetId) continue;
      const cached = cache.entries[entry.targetId];
      if (cached?.status && Date.now() - Date.parse(cached.checkedAt) < cacheTtlMs) {
        results[sourceId] = cached;
      } else {
        pending.push({ sourceId, targetId: entry.targetId, name: entry.targetName || entry.name });
      }
    }
    for (let index = 0; index < pending.length; index += 4) {
      await Promise.all(pending.slice(index, index + 4).map(async (entry) => {
        try {
          const diagnostic = await inspectTargetModelRevisionBinding({
            id: entry.targetId, name: entry.name
          }, "footprints");
          const result = { ...diagnostic, checkedAt: new Date().toISOString() };
          results[entry.sourceId] = result;
          cache.entries[entry.targetId] = result;
        } catch (error) {
          results[entry.sourceId] = { status: "unavailable", message: error.message };
        }
      }));
    }
    if (pending.length) await writeJsonFile(footprintBindingCachePath, cache);
    return { results };
  })().finally(() => { footprintBindingDiagnosticsLoad = null; });
  return footprintBindingDiagnosticsLoad;
}

async function downloadTargetTemplateFiles(template) {
  let resolved = template;
  if (!resolved?.latestRevision?.downloadableFile?.downloadUrl) {
    const templates = await listEntities("componentTemplates", "target", null, true);
    resolved = templates.find((candidate) => candidate.id === template.id
      || candidate.latestRevision?.id === template.latestRevision?.id);
  }
  const url = resolved?.latestRevision?.downloadableFile?.downloadUrl;
  if (!url) throw new Error(`No download URL returned for template ${template.name}`);
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${tokens.target}` }
  });
  if (!response.ok) {
    throw new Error(`Download template ${template.name} failed (HTTP ${response.status})`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.readUInt32LE(0) !== 0x04034b50) {
    throw new Error(`Template ${template.name} did not return a ZIP package`);
  }
  return extractZipFiles(bytes);
}

function extractZipFiles(archive) {
  const eocdSignature = 0x06054b50;
  let eocdOffset = -1;
  for (let offset = archive.length - 22; offset >= Math.max(0, archive.length - 65557); offset -= 1) {
    if (archive.readUInt32LE(offset) === eocdSignature) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("Invalid ZIP release package: end record not found");

  const entryCount = archive.readUInt16LE(eocdOffset + 10);
  let centralOffset = archive.readUInt32LE(eocdOffset + 16);
  const files = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (archive.readUInt32LE(centralOffset) !== 0x02014b50) {
      throw new Error("Invalid ZIP release package: central directory is corrupt");
    }
    const compression = archive.readUInt16LE(centralOffset + 10);
    const compressedSize = archive.readUInt32LE(centralOffset + 20);
    const nameLength = archive.readUInt16LE(centralOffset + 28);
    const extraLength = archive.readUInt16LE(centralOffset + 30);
    const commentLength = archive.readUInt16LE(centralOffset + 32);
    const localOffset = archive.readUInt32LE(centralOffset + 42);
    const archivePath = archive.subarray(centralOffset + 46, centralOffset + 46 + nameLength)
      .toString("utf8")
      .replaceAll("\\", "/");
    centralOffset += 46 + nameLength + extraLength + commentLength;
    if (!archivePath || archivePath.endsWith("/")) continue;
    if (archivePath.startsWith("/") || archivePath.split("/").includes("..")) {
      throw new Error(`Unsafe path in ZIP release package: ${archivePath}`);
    }
    if (archive.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`Invalid ZIP local entry: ${archivePath}`);
    }
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = archive.subarray(dataOffset, dataOffset + compressedSize);
    const fileBytes = compression === 0 ? Buffer.from(compressed)
      : compression === 8 ? inflateRawSync(compressed)
        : null;
    if (!fileBytes) throw new Error(`Unsupported ZIP compression ${compression}: ${archivePath}`);
    const relativePath = archivePath.includes("/") ? archivePath : `Released/${archivePath}`;
    files.push({
      bytes: fileBytes,
      filename: path.posix.basename(archivePath),
      relativePath,
      contentType: "application/octet-stream"
    });
  }
  if (!files.length) throw new Error("The ZIP release package contains no files");
  return files;
}

function responseFilename(contentDisposition) {
  if (!contentDisposition) return null;
  const encoded = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) return decodeURIComponent(encoded.replace(/^"|"$/g, ""));
  return contentDisposition.match(/filename="?([^";]+)"?/i)?.[1] || null;
}

async function uploadTargetFile(file, uploadUrl = filesUploadEndpoints.target) {
  const form = new FormData();
  form.append("file", new Blob([file.bytes], { type: file.contentType }), file.filename);
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: { authorization: `Bearer ${tokens.target}` },
    body: form
  });
  const text = (await response.text()).trim();
  if (!response.ok) {
    throw new Error(`${workspaceLabels.target} file upload failed (HTTP ${response.status}): ${text.slice(0, 500)}`);
  }
  const fileId = text.replace(/^"|"$/g, "");
  if (!fileId) throw new Error(`${workspaceLabels.target} file upload returned an empty file id`);
  return fileId;
}

function baseItemName(name = "") {
  return name.replace(/[-.]\d+$/, "");
}

async function loadModelMap() {
  try {
    return JSON.parse(await readFile(migrationStatePath, "utf8"));
  } catch {
    return { version: 1, symbols: {}, footprints: {} };
  }
}

async function saveModelMap(modelMap) {
  await mkdir(path.dirname(migrationStatePath), { recursive: true });
  await writeFile(migrationStatePath, JSON.stringify(modelMap, null, 2));
}

async function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return structuredClone(fallback);
  }
}

async function writeJsonFile(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2));
}

async function loadCompletedMigrations() {
  const state = await readJsonFile(completedMigrationPath, {
    version: 1,
    symbols: {},
    footprints: {},
    components: {}
  });
  state.symbols ||= {};
  state.footprints ||= {};
  state.components ||= {};
  return state;
}

async function rememberCompletedMigration(kind, sourceItem, result, folder) {
  const state = await loadCompletedMigrations();
  state[kind][sourceItem.id] = {
    sourceId: sourceItem.id,
    name: sourceItem.name,
    revisionId: sourceItem.revisionInternalId || sourceItem.revisionId || "",
    targetId: result.targetId || null,
    targetRevisionId: result.targetRevisionId || String(result.targetId || "").split("/").at(-1) || "",
    targetName: result.targetName || null,
    targetFolderId: folder.id,
    targetFolder: result.targetFolder || folder.path || folder.name,
    migratedAt: new Date().toISOString(),
    ...(kind === "components" ? {
      indexingPending: Boolean(result.indexingPending),
      previousTargetRevision: result.previousTargetRevision || 0
    } : {})
  };
  await writeJsonFile(completedMigrationPath, state);
}

async function forgetCompletedMigration(kind, sourceId) {
  if (kind !== "components") throw httpError(400, "Only components can be returned to the migration list");
  const state = await loadCompletedMigrations();
  if (!state.components[sourceId]) return false;
  delete state.components[sourceId];
  await writeJsonFile(completedMigrationPath, state);
  return true;
}

async function completedMigrationState() {
  const state = await loadCompletedMigrations();
  const modelMap = await loadModelMap();
  let changed = false;
  for (const kind of ["symbols", "footprints"]) {
    for (const [sourceId, mapping] of Object.entries(modelMap[kind] || {})) {
      if (!sourceId.startsWith("grid:")
        || mapping.contentTransferVersion !== MODEL_TRANSFER_VERSION
        || !mapping.folderId
        || state[kind][sourceId]) continue;
      state[kind][sourceId] = {
        sourceId,
        name: null,
        revisionId: sourceId.split("/").at(-1),
        targetId: mapping.id,
        targetName: mapping.name || null,
        targetFolderId: mapping.folderId,
        targetFolder: mapping.folderPath || null,
        migratedAt: null
      };
      changed = true;
    }
  }
  if (await reconcileCompletedComponents(state)) changed = true;
  if (changed) await writeJsonFile(completedMigrationPath, state);
  return state;
}

async function modelRevisionChoices(kind, sourceId) {
  if (!new Set(["symbols", "footprints"]).has(kind)) throw httpError(400, "Invalid model kind");
  const completed = await loadCompletedMigrations();
  const entry = completed[kind][sourceId];
  if (!entry?.targetId) throw httpError(404, "Migrated model not found");
  const current = await hydrateLibraryModel({ id: entry.targetId }, kind, "target");
  const candidates = await findTargetModelCandidates(kind, baseItemName(current.name));
  const revisions = candidates
    .filter((candidate) => candidate.itemInternalId?.toLowerCase()
      === current.itemInternalId?.toLowerCase()
      && candidate.folder?.id === current.folder?.id)
    .sort(compareLibraryRevisions)
    .map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      comment: candidate.comment || "",
      revisionId: candidate.revisionInternalId || "",
      lifecycleState: candidate.lifeCycleState?.name || "",
      selected: candidate.id === entry.targetId
    }));
  return { kind, sourceId, currentTargetId: entry.targetId, revisions };
}

async function selectMigratedModelRevision(kind, sourceId, targetId) {
  const choices = await modelRevisionChoices(kind, sourceId);
  const chosen = choices.revisions.find((revision) => revision.id === targetId);
  if (!chosen) throw httpError(400, "The target revision is not part of the migrated model item");
  const diagnostic = await inspectTargetModelRevisionBinding(chosen, kind);
  if (diagnostic.status === "affected") {
    throw httpError(400, `Revision ${chosen.name} still contains source revision ${diagnostic.embeddedRevisionId}`);
  }
  const current = await hydrateLibraryModel({ id: targetId }, kind, "target");
  const modelMap = await loadModelMap();
  for (const mapping of Object.values(modelMap[kind] || {})) {
    if (mapping?.id !== choices.currentTargetId) continue;
    mapping.id = current.id;
    mapping.name = current.name;
    mapping.comment = current.comment || "";
  }
  await saveModelMap(modelMap);
  const completed = await loadCompletedMigrations();
  for (const entry of Object.values(completed[kind])) {
    if (entry?.targetId !== choices.currentTargetId) continue;
    entry.targetId = current.id;
    entry.targetName = current.name;
    entry.targetRevisionId = current.revisionInternalId;
  }
  await writeJsonFile(completedMigrationPath, completed);
  const parameterMappings = await loadParameterMappings();
  let changed = false;
  for (const selection of Object.values(parameterMappings.componentModels)) {
    if (kind === "symbols") {
      if (selection.symbolId === choices.currentTargetId) {
        selection.symbolId = current.id;
        changed = true;
      }
    } else {
      let selectionChanged = false;
      const next = (selection.footprintIds || []).map((id) => {
        if (id !== choices.currentTargetId) return id;
        changed = true;
        selectionChanged = true;
        return current.id;
      });
      if (selectionChanged) selection.footprintIds = [...new Set(next)];
    }
  }
  if (changed) await writeJsonFile(parameterMappingsPath, parameterMappings);
  return { sourceId, targetId: current.id, targetName: current.name,
    targetRevisionId: current.revisionInternalId };
}

function migrationLogDate(filename) {
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-components\.json$/);
  if (!match) return null;
  const date = new Date(`${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`);
  return Number.isFinite(date.getTime()) ? date : null;
}

function componentRevisionDate(component) {
  const value = component.modifiedAt || component.revision?.details?.modifiedAt
    || component.revision?.details?.releaseDate || component.createdAt;
  const date = new Date(value || "");
  return Number.isFinite(date.getTime()) ? date : null;
}

async function reconcileCompletedComponents(state) {
  let changed = false;
  const candidatesByName = new Map();
  const candidates = async (name, allowPrefix = false) => {
    const key = `${allowPrefix ? "prefix" : "exact"}:${String(name).toLowerCase()}`;
    if (!candidatesByName.has(key)) {
      candidatesByName.set(key, findTargetComponentRowsByName(name, { allowPrefix }).catch(() => []));
    }
    return candidatesByName.get(key);
  };

  for (const entry of Object.values(state.components)) {
    if (!entry.indexingPending || !entry.targetName) continue;
    const latest = (await candidates(entry.targetName))
      .filter((row) => !entry.targetFolderId || row.folder?.id === entry.targetFolderId)
      .filter((row) => revisionSequence(row.name) > (entry.previousTargetRevision || 0))
      .at(-1);
    if (!latest) continue;
    entry.targetId = latest.id;
    entry.targetName = latest.name;
    entry.indexingPending = false;
    changed = true;
  }

  let filenames = [];
  try {
    filenames = (await readdir(migrationLogsDir)).filter((name) => name.endsWith("-components.json"));
  } catch {
    return changed;
  }
  for (const filename of filenames) {
    const loggedAt = migrationLogDate(filename);
    if (!loggedAt) continue;
    const payload = await readJsonFile(path.join(migrationLogsDir, filename), { results: [] });
    for (const result of payload.results || []) {
      if (state.components[result.sourceId] || result.status !== "failed") continue;
      const match = String(result.error || "").match(/^Released component (.+) could not be found in its destination folder$/);
      if (!match) continue;
      const target = (await candidates(match[1], true)).filter((row) => {
        const releasedAt = componentRevisionDate(row);
        return releasedAt && Math.abs(releasedAt.getTime() - loggedAt.getTime()) <= 5 * 60 * 1000;
      }).at(-1);
      if (!target) continue;
      state.components[result.sourceId] = {
        sourceId: result.sourceId,
        name: result.name || null,
        revisionId: result.sourceId.split("/").at(-1),
        targetId: target.id,
        targetName: target.name,
        targetFolderId: target.folder?.id || null,
        targetFolder: target.folder?.path || target.folder?.name || null,
        migratedAt: componentRevisionDate(target)?.toISOString() || loggedAt.toISOString(),
        indexingPending: false,
        recoveredFromReleaseLog: true
      };
      changed = true;
    }
  }
  return changed;
}

function mappedModel(modelMap, kind, model, destinationFolderId = null) {
  const mapping = modelMap[kind]?.[model.id] || modelMap[kind]?.[model.revisionInternalId];
  if (mapping?.contentTransferVersion !== MODEL_TRANSFER_VERSION) return null;
  if (destinationFolderId && mapping?.folderId !== destinationFolderId) return null;
  if (!destinationFolderId && mapping) {
    const folderName = path.basename(mapping.folderPath || "").toLowerCase();
    if (!mapping.folderId || ignoredTargetFolderNames.has(folderName)) return null;
  }
  return mapping;
}

function mappedModelNames(modelMap, kind, sourceModels) {
  return (sourceModels || []).map((model) => mappedModel(modelMap, kind, model)?.name).filter(Boolean);
}

async function findExistingTargetModel(kind, sourceItem, folder) {
  const candidates = await findTargetModelCandidates(kind, baseItemName(sourceItem.name));
  return candidates
    .filter((item) => item.folder?.id === folder.id)
    .sort(compareLibraryRevisions)
    .at(-1) || null;
}

async function findTargetModelCandidates(kind, baseName) {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const operation = config.queries[kind === "symbols" ? "findTargetSymbol" : "findTargetFootprint"];
  const data = await graphql("target", operation.query, { name: baseName }, operation.operationName);
  return (getByPath(data, operation.resultPath) || [])
    .filter((item) => baseItemName(item.name).toLowerCase() === baseName.toLowerCase());
}

async function findTargetComponentCandidates(sourceItem, folder) {
  return findTargetComponentCandidatesByName(baseItemName(sourceItem.name), folder);
}

async function findTargetComponentCandidatesByName(itemName, folder) {
  return (await findTargetComponentRowsByName(itemName))
    .filter((row) => row.folder?.id === folder.id);
}

async function findTargetComponentRowsByName(itemName, { allowPrefix = false } = {}) {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const operation = config.queries.findTargetComponent;
  const name = String(itemName || "").trim();
  const data = await graphql("target", operation.query, { name }, operation.operationName);
  const candidates = getByPath(data, operation.resultPath) || [];
  return candidates.map((row) => normalizeDesEntity(row, "components"))
    .filter((row) => {
      const candidateName = baseItemName(row.name).toLowerCase();
      const requestedName = name.toLowerCase();
      return candidateName === requestedName
        || (allowPrefix && candidateName.startsWith(`${requestedName}-`));
    })
    .sort(compareLibraryRevisions);
}

async function findCreatedTargetComponent(itemName, folder, previousRevision = 0) {
  const name = previousRevision > 0 ? baseItemName(itemName) : String(itemName || "").trim();
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const rows = await findTargetComponentCandidatesByName(name, folder);
      const latest = rows.at(-1);
      if (latest && revisionSequence(latest.name) > previousRevision) return latest;
    } catch {
      // The mutation is authoritative; transient indexing/query errors are retried below.
    }
    if (attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  return null;
}

function itemNameMatchesTemplate(name, namingTemplate) {
  const token = String(namingTemplate || "").match(/\{(0+)\}/);
  if (!token) return baseItemName(name).toLowerCase() === String(namingTemplate || "").toLowerCase();
  const escaped = namingTemplate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tokenPattern = `\\{${token[1]}\\}`;
  const expression = escaped.replace(tokenPattern, `\\d{${token[1].length},}`);
  return new RegExp(`^${expression}$`, "i").test(baseItemName(name));
}

async function listTargetComponentRows() {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const operation = config.queries.findTargetComponentsByPrefix;
  const rows = [];
  let after = null;
  for (;;) {
    const data = await graphql(
      "target",
      operation.query,
      { first: 250, after },
      operation.operationName
    );
    const connection = getByPath(data, operation.connectionPath);
    if (!connection) throw new Error("Target component connection was not returned");
    rows.push(...(connection.nodes || []));
    if (!connection.pageInfo?.hasNextPage) break;
    after = connection.pageInfo.endCursor;
  }
  return rows.map((row) => normalizeDesEntity(row, "components"));
}

async function nextComponentItemName(namingTemplate) {
  const template = String(namingTemplate || "").trim();
  const tokens = [...template.matchAll(/\{(\d+)\}/g)];
  if (tokens.length !== 1 || /\$[A-Z_]+/i.test(template)) {
    throw new Error(
      `Item Naming Scheme "${template}" cannot be expanded by the component release API`
    );
  }
  const token = tokens[0][0];
  const seedText = tokens[0][1];
  const width = seedText.length;
  const seed = Number(seedText) || 1;
  const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expression = new RegExp(
    `^${escaped.replace(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), `(\\d{${width}})`)}$`,
    "i"
  );
  const usedNames = new Set();
  let next = seed;
  for (const row of await listTargetComponentRows()) {
    const itemName = baseItemName(row.name);
    usedNames.add(itemName.toLowerCase());
    const match = itemName.match(expression);
    if (match) next = Math.max(next, Number(match[1]) + 1);
  }
  const limit = (10 ** width) - 1;
  while (next <= limit) {
    const candidate = template.replace(token, String(next).padStart(width, "0"));
    if (!usedNames.has(candidate.toLowerCase())) return candidate;
    next += 1;
  }
  throw new Error(`Item Naming Scheme "${template}" has no available identifier`);
}

async function findTargetComponentByComment(sourceItem, folder, namingTemplate) {
  const comment = String(sourceItem.comment || "").trim();
  if (!comment) return null;
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const operation = config.queries.findTargetComponentsByComment;
  const data = await graphql("target", operation.query, { comment }, operation.operationName);
  return (getByPath(data, operation.resultPath) || [])
    .map((row) => normalizeDesEntity(row, "components"))
    .filter((row) => row.folder?.id === folder.id)
    .filter((row) => itemNameMatchesTemplate(row.name, namingTemplate))
    .sort(compareLibraryRevisions)
    .at(-1) || null;
}

async function rememberModelMapping(modelMap, kind, sourceItem, target, folder, targetName = null) {
  modelMap[kind][sourceItem.id] = {
    id: target.id,
    name: targetName || target.name || baseItemName(sourceItem.name),
    comment: target.comment || sourceItem.comment || "",
    folderId: folder.id,
    folderPath: folder.path,
    contentTransferVersion: MODEL_TRANSFER_VERSION
  };
  if (sourceItem.revisionInternalId) {
    modelMap[kind][sourceItem.revisionInternalId] = modelMap[kind][sourceItem.id];
  }
  await saveModelMap(modelMap);
}

function normalizedCategory(value = "") {
  return value.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\band\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function singularCategory(value) {
  if (value.endsWith("ies")) return `${value.slice(0, -3)}y`;
  if (value.endsWith("s") && !value.endsWith("ss")) return value.slice(0, -1);
  return value;
}

function targetTemplateFor(folder, templates) {
  const folderSegments = (folder.path || folder.name || "")
    .split(/[\\/]/)
    .map(normalizedCategory)
    .filter(Boolean)
    .reverse();
  let best = null;
  for (const template of templates) {
    const labels = [
      template.latestRevision?.comment,
      template.latestRevision?.description?.replace(/^template\s+for\s+/i, ""),
      template.description?.replace(/^template\s+for\s+/i, "")
    ].map(normalizedCategory).filter(Boolean);
    for (const label of labels) {
      const segmentIndex = folderSegments.findIndex((segment) => segment === label
        || singularCategory(segment) === singularCategory(label));
      if (segmentIndex < 0) continue;
      const score = 100 - segmentIndex;
      if (!best || score > best.score) best = { template, score };
    }
  }
  return best?.template || null;
}

function sourceParameters(component) {
  const merged = new Map([
    ["@comment", { key: "@comment", name: "Comment", value: component.comment || "", type: "TEXT" }],
    ["@description", { key: "@description", name: "Description", value: component.description || "", type: "TEXT" }]
  ]);
  for (const parameter of [...(component.itemParameters || []), ...(component.parameters || [])]) {
    merged.set(parameter.name, { key: parameter.name, ...parameter });
  }
  return [...merged.values()];
}

function suggestedParameterMappings(component, definitions) {
  const sources = sourceParameters(component);
  const byName = new Map(sources.map((parameter) => [normalizedCategory(parameter.name), parameter.key]));
  const aliases = new Map([
    ["comment", "@comment"],
    ["description", "@description"],
    ["accurancy", byName.get("precision") || null]
  ]);
  return Object.fromEntries(definitions.map((definition) => [
    definition.name,
    byName.get(normalizedCategory(definition.name)) || aliases.get(normalizedCategory(definition.name)) || null
  ]));
}

function scientificToPlain(value) {
  const match = String(value || "").trim().match(/^([+-]?)(\d+)(?:\.(\d*))?[eE]([+-]?\d+)$/);
  if (!match) return String(value ?? "").trim();
  const sign = match[1] === "-" ? "-" : "";
  const integer = match[2];
  const fraction = match[3] || "";
  const exponent = Number(match[4]);
  const digits = `${integer}${fraction}`;
  const decimalIndex = integer.length + exponent;
  let plain;
  if (decimalIndex <= 0) plain = `0.${"0".repeat(-decimalIndex)}${digits}`;
  else if (decimalIndex >= digits.length) plain = `${digits}${"0".repeat(decimalIndex - digits.length)}`;
  else plain = `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
  plain = plain.replace(/^0+(?=\d)/, "").replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return `${sign}${plain || "0"}`;
}

function plainNumber(value) {
  if (!Number.isFinite(value)) return null;
  if (Object.is(value, -0)) return "0";
  const text = String(value);
  return /e/i.test(text) ? scientificToPlain(text) : text;
}

function parseTypedParameterValue(rawValue, type) {
  const raw = String(rawValue ?? "").trim();
  if (!raw || type === "TEXT") return raw;
  const normalized = raw.replaceAll(" ", "").replace(",", ".");
  const numberMatch = normalized.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)(.*)$/);
  if (!numberMatch) return raw;
  const number = Number(numberMatch[1]);
  let suffix = numberMatch[2];
  if (!Number.isFinite(number)) return raw;

  if (type === "TEMPERATURE") {
    if (!/^(?:°?[cC])?$/.test(suffix)) return raw;
    return plainNumber(number);
  }
  if (type === "PERCENT") {
    if (!/^%?$/.test(suffix)) return raw;
    return plainNumber(number);
  }
  if (type === "TIME") {
    const timeFactors = new Map([
      ["", 1], ["s", 1], ["ms", 1e-3], ["us", 1e-6], ["µs", 1e-6], ["μs", 1e-6],
      ["ns", 1e-9], ["ps", 1e-12], ["min", 60], ["h", 3600]
    ]);
    return timeFactors.has(suffix) ? plainNumber(number * timeFactors.get(suffix)) : raw;
  }

  const baseUnits = {
    CAPACITANCE: /^f?$/i,
    CURRENT: /^a?$/i,
    FREQUENCY: /^hz?$/i,
    INDUCTANCE: /^h?$/i,
    LENGTH: /^m?$/i,
    RESISTANCE: /^(?:ohms?|Ω)?$/i,
    POWER: /^w?$/i,
    VOLTAGE: /^v?$/i
  };
  const prefixes = new Map([
    ["p", 1e-12], ["n", 1e-9], ["u", 1e-6], ["µ", 1e-6], ["μ", 1e-6],
    ["m", 1e-3], ["k", 1e3], ["K", 1e3], ["M", 1e6], ["G", 1e9], ["T", 1e12]
  ]);
  let factor = 1;
  if (suffix && !baseUnits[type]?.test(suffix) && prefixes.has(suffix[0])) {
    factor = prefixes.get(suffix[0]);
    suffix = suffix.slice(1);
  }
  if (!baseUnits[type]) return suffix ? raw : plainNumber(number);
  if (!baseUnits[type].test(suffix)) return raw;
  return plainNumber(number * factor);
}

function normalizeComponentParameterValue(rawValue, type, source) {
  if (type === "TEXT") return { value: String(rawValue ?? "") };
  const sourceType = normalizedCategory(source?.type || "").toUpperCase();
  const matchesSourceDisplay = source && String(rawValue ?? "") === String(source.value ?? "");
  const canonical = matchesSourceDisplay && source.realValue && sourceType === type
    ? scientificToPlain(source.realValue)
    : parseTypedParameterValue(rawValue, type);
  const numeric = Number(canonical);
  return {
    value: canonical,
    ...(canonical !== "" && Number.isFinite(numeric)
      ? { realValue: numeric.toExponential(14).replace("e", "E") } : {})
  };
}

function designerUnitCandidate(rawValue, type) {
  const raw = String(rawValue ?? "").trim().replace(",", ".");
  const number = raw.match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/)?.[0];
  if (!number) return null;
  const unitPatterns = {
    CAPACITANCE: /[pnuµμmkKMGT]?[Ff]\b/g,
    CURRENT: /[pnuµμmkKMGT]?[Aa]\b/g,
    FREQUENCY: /[pnuµμmkKMGT]?[Hh][Zz]\b/g,
    INDUCTANCE: /[pnuµμmkKMGT]?[Hh]\b/g,
    LENGTH: /[pnuµμmkKMGT]?[Mm]\b/g,
    RESISTANCE: /(?:[pnuµμmkKMGT]?(?:[Oo]hms?|Ω))/g,
    POWER: /[pnuµμmkKMGT]?[Ww]\b/g,
    VOLTAGE: /[pnuµμmkKMGT]?[Vv]\b/g,
    TIME: /(?:ps|ns|us|µs|μs|ms|min|[sh])\b/g,
    TEMPERATURE: /°?[Cc]\b/g,
    PERCENT: /%/g
  };
  const units = [...raw.matchAll(unitPatterns[type] || /$a/g)];
  return units.length ? `${number}${units.at(-1)[0]}` : null;
}

function normalizeDesignerParameterValue(rawValue, targetParameter) {
  const raw = String(rawValue ?? "").trim();
  const type = normalizedCategory(targetParameter.dataType).toUpperCase() || "TEXT";
  if (!raw) return { rawValue: raw, value: "", type, siValidated: false, requiresConfirmation: false };
  if (type === "TEXT") {
    return { rawValue: raw, value: raw, type, siValidated: false, requiresConfirmation: true };
  }
  let value = parseTypedParameterValue(raw, type);
  let numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    const candidate = designerUnitCandidate(raw, type);
    if (candidate) {
      value = parseTypedParameterValue(candidate, type);
      numeric = Number(value);
    }
  }
  return {
    rawValue: raw,
    value: Number.isFinite(numeric) ? value : raw,
    type,
    siValidated: Number.isFinite(numeric),
    requiresConfirmation: !Number.isFinite(numeric)
  };
}

function componentParameters(component, definitions, savedMappings = {}, savedValues = {}) {
  const sources = new Map(sourceParameters(component).map((parameter) => [parameter.key, parameter]));
  const suggestions = suggestedParameterMappings(component, definitions);
  return definitions.map((definition) => {
    const source = sources.get(savedMappings[definition.name] ?? suggestions[definition.name]);
    const type = normalizedCategory(definition.dataType).toUpperCase() || "TEXT";
    const hasOverride = Object.hasOwn(savedValues, definition.name);
    const rawValue = hasOverride
      ? savedValues[definition.name]
      : source?.value ?? definition.defaultValue ?? "";
    const normalizedValue = normalizeComponentParameterValue(rawValue, type, source);
    return {
      name: definition.name,
      ...normalizedValue,
      type,
    };
  });
}

async function loadParameterMappings() {
  const state = await readJsonFile(parameterMappingsPath, {
    version: 1,
    templates: {},
    componentModels: {}
  });
  state.templates ||= {};
  state.componentModels ||= {};
  return state;
}

function migratedModelOptions(modelMap, kind) {
  const byTargetId = new Map();
  for (const mapping of Object.values(modelMap[kind] || {})) {
    if (!mapping?.id || mapping.contentTransferVersion !== MODEL_TRANSFER_VERSION) continue;
    const folderName = path.basename(mapping.folderPath || "").toLowerCase();
    if (!mapping.folderId || ignoredTargetFolderNames.has(folderName)) continue;
    byTargetId.set(mapping.id, {
      id: mapping.id,
      name: mapping.name || mapping.id,
      ...(mapping.comment ? { comment: mapping.comment } : {}),
      folderPath: mapping.folderPath || "",
      origin: "migration"
    });
  }
  return [...byTargetId.values()].sort((left, right) => (
    left.name.localeCompare(right.name, undefined, { numeric: true })
  ));
}

async function targetModelOptions(modelMap, kind, freshBaseNames = []) {
  const byTargetId = new Map();
  for (const model of await listTargetSelectableModels(kind, kind === "symbols")) {
    if (!model.id) continue;
    byTargetId.set(model.id, {
      id: model.id,
      name: model.name || model.id,
      description: model.description || "",
      comment: model.comment || "",
      guid: model.guid || "",
      itemInternalId: model.itemInternalId || "",
      revisionId: model.revisionId || model.revisionInternalId || "",
      folderPath: model.folderPath || model.folder?.path || "",
      lifecycleState: model.lifecycleState || "",
      origin: "workspace"
    });
  }
  for (const component of await listEntities("targetComponentModels", "target")) {
    const models = kind === "symbols" ? component.details?.symbols : component.details?.footprints;
    for (const model of models || []) {
      if (!model?.id || byTargetId.has(model.id)) continue;
      byTargetId.set(model.id, {
        id: model.id,
        name: model.name || model.id,
        description: model.description || "",
        comment: model.comment || "",
        revisionId: model.revisionId || model.revisionInternalId || "",
        folderPath: model.folder?.path || "",
        origin: "workspace-component"
      });
    }
  }
  for (const model of migratedModelOptions(modelMap, kind)) {
    const existing = byTargetId.get(model.id);
    if (kind === "symbols" && !existing) continue;
    byTargetId.set(model.id, { ...existing, ...model });
  }
  // The broad inventory is cached for speed; look up the revisions of models
  // used by this component directly so a recent -2/-3 is immediately usable.
  const names = [...new Set(freshBaseNames.filter(Boolean).map((name) => baseItemName(name)))];
  const freshRevisions = await Promise.all(names.map((name) => findTargetModelCandidates(kind, name)));
  for (const revision of freshRevisions.flat()) {
    if (!revision.id) continue;
    const existing = byTargetId.get(revision.id) || {};
    byTargetId.set(revision.id, {
      ...existing,
      id: revision.id,
      name: revision.name,
      comment: revision.comment || existing.comment || "",
      description: revision.description || existing.description || "",
      itemInternalId: revision.itemInternalId || existing.itemInternalId || "",
      revisionId: revision.revisionInternalId || existing.revisionId || "",
      folderPath: revision.folder?.path || existing.folderPath || "",
      lifecycleState: revision.lifeCycleState?.name || existing.lifecycleState || "",
      origin: existing.origin || "workspace"
    });
  }
  return [...byTargetId.values()].sort((left, right) => (
    left.name.localeCompare(right.name, undefined, { numeric: true })
  ));
}

function associatedFootprintOptions(componentFolder, footprintOptions, preferredIds = []) {
  const segments = (value, marker) => {
    const parts = String(value || "").split(/[\\/]/).filter(Boolean);
    const markerIndex = parts.findIndex((part) => normalizedCategory(part) === marker);
    const relevant = markerIndex >= 0 ? parts.slice(markerIndex + 1) : parts;
    return relevant.map((part) => singularCategory(normalizedCategory(part))).filter(Boolean);
  };
  const componentSegments = segments(componentFolder?.path || componentFolder?.name, "components");
  const scored = footprintOptions.map((model) => {
    const footprintSegments = segments(model.folderPath, "footprints");
    let score = 0;
    while (score < componentSegments.length && score < footprintSegments.length
      && componentSegments.at(-1 - score) === footprintSegments.at(-1 - score)) score += 1;
    return { model, score };
  });
  const bestScore = Math.max(0, ...scored.map((entry) => entry.score));
  const preferred = new Set(preferredIds.filter(Boolean));
  return scored.filter((entry) => (bestScore > 0 && entry.score === bestScore)
    || preferred.has(entry.model.id)).map((entry) => entry.model);
}

function unresolvedTemplateDefaultModels(packageInfo, symbolOptions, footprintOptions) {
  const unresolved = [];
  for (const link of packageInfo.modelLinks || []) {
    const identifier = String(link.defaultValue || "").trim();
    if (!identifier) continue;
    const linkName = link.name.toUpperCase();
    const options = linkName === "SCHLIB" ? symbolOptions
      : linkName === "PCBLIB" ? footprintOptions : null;
    if (!options) continue;
    const normalizedIdentifier = identifier.toLowerCase();
    const found = options.some((model) => [model.id, model.guid, model.itemInternalId]
      .filter(Boolean)
      .some((candidate) => String(candidate).toLowerCase() === normalizedIdentifier));
    if (!found) unresolved.push(`${linkName}=${identifier}`);
  }
  return unresolved;
}

function validateTemplateDefaultModels(template, packageInfo, symbolOptions, footprintOptions) {
  const unresolved = unresolvedTemplateDefaultModels(packageInfo, symbolOptions, footprintOptions);
  if (unresolved.length) {
    throw new Error(
      `Target template ${template.latestRevision?.name || template.name} has invalid default model links: `
      + `${unresolved.join(", ")}. Correct or clear these links in Global Fluidra before migration.`
    );
  }
}

function modelMatchScore(source, target) {
  const sourceValues = [source.name, source.comment, source.description]
    .map((value) => normalizedCategory(baseItemName(value || ""))).filter(Boolean);
  const targetValues = [target.name, target.comment, target.description]
    .map((value) => normalizedCategory(baseItemName(value || ""))).filter(Boolean);
  let score = 0;
  for (const sourceValue of sourceValues) {
    for (const targetValue of targetValues) {
      if (sourceValue === targetValue) score = Math.max(score, 100);
      else if (sourceValue.length > 4 && (sourceValue.includes(targetValue) || targetValue.includes(sourceValue))) {
        score = Math.max(score, 60);
      }
    }
  }
  return score;
}

function rankedModelMatches(sourceModels, options, selectedIds = []) {
  const selected = new Set(selectedIds.filter(Boolean));
  return options.map((model) => ({
    ...model,
    score: Math.max(0, ...(sourceModels || []).map((source) => modelMatchScore(source, model))),
    selected: selected.has(model.id)
  })).filter((model) => model.selected || model.score > 0)
    .sort((left, right) => Number(right.selected) - Number(left.selected) || right.score - left.score
      || left.name.localeCompare(right.name, undefined, { numeric: true }))
    .slice(0, 12);
}

function isIpcMediumDensity(model) {
  return /\bipc\s+(?:medium|nominal)\s+density\b/i.test([
    model?.description,
    model?.comment,
    model?.name,
    model?.sourceDescription,
    model?.sourceComment
  ].filter(Boolean).join(" "));
}

function orderFootprintsWithIpcMediumFirst(ids, options = [], sourceModels = []) {
  const uniqueIds = [...new Set((ids || []).filter(Boolean))];
  const optionsById = new Map(options.map((model) => [model.id, model]));
  const sourceByTargetId = new Map(sourceModels.map((model) => [model.targetId, model]));
  return uniqueIds.sort((leftId, rightId) => {
    const left = { ...optionsById.get(leftId), ...sourceByTargetId.get(leftId) };
    const right = { ...optionsById.get(rightId), ...sourceByTargetId.get(rightId) };
    return Number(isIpcMediumDensity(right)) - Number(isIpcMediumDensity(left));
  });
}

async function targetServiceJson(url, label) {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${tokens.target}` }
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${label} failed (HTTP ${response.status}): ${text.slice(0, 500)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

async function discoverProjectUploadEndpoints() {
  if (projectUploadEndpoints) return projectUploadEndpoints;
  const workspaceOrigin = new URL(endpoints.target).origin;
  const configuration = await targetServiceJson(
    `${workspaceOrigin}/api/configuration`,
    `${workspaceLabels.target} project upload service discovery`
  );
  const services = configuration.services || [];
  const platformApi = services.find((service) => service.name === "platform-api");
  const filesApi = services.find((service) => service.name === "files-service-api");
  if (!platformApi?.apiUrl || !filesApi?.apiUrl) {
    throw new Error(`${workspaceLabels.target} does not advertise its regional Platform API and Files Service`);
  }
  const graphqlUrl = new URL(platformApi.apiUrl);
  const filesBaseUrl = new URL(filesApi.apiUrl);
  if (graphqlUrl.protocol !== "https:" || filesBaseUrl.protocol !== "https:") {
    throw new Error(`${workspaceLabels.target} advertised an insecure project upload endpoint`);
  }
  projectUploadEndpoints = {
    graphqlUrl: graphqlUrl.href,
    filesUploadUrl: new URL(
      "File/Upload",
      filesBaseUrl.href.endsWith("/") ? filesBaseUrl.href : `${filesBaseUrl.href}/`
    ).href,
    workspaceUrl: `${workspaceOrigin}/`
  };
  return projectUploadEndpoints;
}

async function discoverDictionariesApiUrl() {
  if (dictionariesApiUrl) return dictionariesApiUrl;
  const workspaceOrigin = new URL(endpoints.target).origin;
  const configuration = await targetServiceJson(
    `${workspaceOrigin}/api/configuration`,
    "Global Fluidra service discovery"
  );
  const service = (configuration.services || []).find((candidate) => candidate.name === "dictionaries");
  if (!service?.apiUrl) throw new Error("Global Fluidra Dictionaries service is unavailable");
  dictionariesApiUrl = service.apiUrl.replace(/\/$/, "");
  return dictionariesApiUrl;
}

async function discoverPartCatalogApiUrl() {
  if (partCatalogApiUrl) return partCatalogApiUrl;
  const workspaceOrigin = new URL(endpoints.target).origin;
  const configuration = await targetServiceJson(
    `${workspaceOrigin}/api/configuration`,
    "Global Fluidra service discovery"
  );
  const service = (configuration.services || []).find((candidate) => (
    ["partcatalog", "part-catalog"].includes(String(candidate.name || "").toLowerCase())
  ));
  if (!service?.apiUrl) throw new Error("Global Fluidra Part Catalog service is unavailable");
  const apiRoot = service.apiUrl.replace(/\/$/, "");
  partCatalogApiUrl = /\/v\d+(?:\.\d+)?$/i.test(apiRoot) ? apiRoot : `${apiRoot}/v1.0`;
  partCatalogIdentityUrls = ["regional-ids", "global-ids"]
    .map((name) => (configuration.services || []).find((candidate) => candidate.name === name)?.apiUrl)
    .filter(Boolean);
  return partCatalogApiUrl;
}

async function loadDictionaryValuesCache(forceRefresh = false) {
  if (dictionaryValuesCache && !forceRefresh) return dictionaryValuesCache;
  if (!forceRefresh) {
    const cached = await readJsonFile(dictionaryValuesPath, null);
    if (cached?.version === DICTIONARY_VALUES_VERSION) {
      cached.byGuid ||= {};
      cached.byName ||= {};
      dictionaryValuesCache = cached;
      return cached;
    }
  }

  const apiUrl = await discoverDictionariesApiUrl();
  const response = await targetServiceJson(
    `${apiUrl}/v1/dictionaries`,
    "Global Fluidra dictionary refresh"
  );
  const state = {
    version: DICTIONARY_VALUES_VERSION,
    source: "altium-dictionaries-api",
    cachedAt: new Date().toISOString(),
    byGuid: {},
    byName: {}
  };
  for (const dictionary of response.items || []) {
    if (!dictionary.guid || !dictionary.name || !Array.isArray(dictionary.items)) continue;
    const record = {
      guid: dictionary.guid,
      name: dictionary.name,
      values: dictionary.items.filter((value) => typeof value === "string")
    };
    state.byGuid[dictionary.guid.toLowerCase()] = record;
    state.byName[normalizedCategory(dictionary.name)] = record;
  }
  await writeJsonFile(dictionaryValuesPath, state);
  dictionaryValuesCache = state;
  return state;
}

async function targetTemplatePackageInfo(template) {
  let cache = await readJsonFile(templateDefinitionsPath, {
    version: TEMPLATE_DEFINITIONS_VERSION,
    templates: {}
  });
  if (cache.version !== TEMPLATE_DEFINITIONS_VERSION) {
    cache = { version: TEMPLATE_DEFINITIONS_VERSION, templates: {} };
  }
  cache.templates ||= {};
  const revisionId = template.latestRevision?.id || template.id;
  if (cache.templates[revisionId]?.definitions) return cache.templates[revisionId];

  const files = await downloadTargetTemplateFiles(template);
  const cmptFile = files.find((file) => file.filename.toLowerCase().endsWith(".cmpt"));
  if (!cmptFile) throw new Error(`No .CMPT definition found in template ${template.name}`);
  let document;
  try {
    document = JSON.parse(cmptFile.bytes.toString("utf8"));
  } catch {
    throw new Error(`Invalid .CMPT JSON in target template ${template.name}`);
  }
  const definitions = (document.Parameters || []).map((parameter) => ({
    name: parameter.Name,
    dataType: parameter.DataType || "Text",
    required: Boolean(parameter.IsRequired),
    readOnly: Boolean(parameter.IsReadOnly),
    defaultValue: parameter.DefaultValue?.ParameterValue ?? "",
    definitionType: parameter.DefinitionType || "",
    definitionGuid: parameter.DefinitionGUID || ""
  })).filter((parameter) => parameter.name && !parameter.readOnly);
  const packageInfo = {
    templateId: template.id,
    templateName: template.name,
    category: template.latestRevision?.comment || "",
    cachedAt: new Date().toISOString(),
    itemNamingTemplate: document.ItemNamingTemplate?.ItemNamingTemplate || "",
    defaultFolderGuid: document.DefaultFolder?.DefaultFolderGUID || "",
    modelLinks: (document.ModelLinks || []).map((model) => ({
      name: model.Name || "",
      defaultValue: model.DefaultValue?.ParameterValue ?? model.DefaultValue ?? ""
    })).filter((model) => model.name),
    definitions
  };
  cache.templates[revisionId] = packageInfo;
  await writeJsonFile(templateDefinitionsPath, cache);
  return packageInfo;
}

async function targetTemplateDefinitions(template) {
  return (await targetTemplatePackageInfo(template)).definitions;
}

async function dictionaryValuesForTemplate(template, definitions, component = null) {
  const dictionaryDefinitions = definitions.filter((definition) => (
    definition.definitionType.toLowerCase() === "dictionary"
  ));
  if (!dictionaryDefinitions.length) return {};

  const dictionaries = await loadDictionaryValuesCache();
  const values = {};
  for (const definition of dictionaryDefinitions) {
    const record = dictionaries.byGuid[definition.definitionGuid.toLowerCase()]
      || dictionaries.byName[normalizedCategory(definition.name)];
    if (!record) {
      throw new Error(`Dictionary "${definition.name}" (${definition.definitionGuid}) was not found in Global Fluidra`);
    }
    values[definition.name] = [...record.values];
  }
  return values;
}

async function componentMappingPreview(component, folder, templates) {
  const template = targetTemplateFor(folder, templates);
  if (!template) {
    throw new Error(`No Global Fluidra template matches destination folder ${folder.path || folder.name}`);
  }
  const packageInfo = await targetTemplatePackageInfo(template);
  const definitions = packageInfo.definitions;
  const mappingsState = await loadParameterMappings();
  const templateKey = template.latestRevision?.id || template.id;
  const savedTemplate = mappingsState.templates[templateKey] || {};
  const savedValues = savedTemplate.componentValues?.[component.id] || {};
  const effectiveMappings = {
    ...suggestedParameterMappings(component, definitions),
    ...(savedTemplate.mappings || {})
  };
  const resolvedValues = Object.fromEntries(componentParameters(
    component,
    definitions,
    effectiveMappings,
    savedValues
  ).map((parameter) => [parameter.name, parameter.value]));
  const dictionaryValues = await dictionaryValuesForTemplate(template, definitions, component);
  const modelMap = await loadModelMap();
  const savedModels = mappingsState.componentModels[component.id];
  const automaticSymbol = component.symbols?.[0]
    ? mappedModel(modelMap, "symbols", component.symbols[0]) : null;
  const automaticFootprints = (component.footprints || [])
    .map((model) => {
      const mapped = mappedModel(modelMap, "footprints", model);
      return mapped ? {
        ...mapped,
        sourceDescription: model.description || "",
        sourceComment: model.comment || ""
      } : null;
    })
    .filter(Boolean);
  const [symbolOptions, allFootprintOptions] = await Promise.all([
    targetModelOptions(modelMap, "symbols", mappedModelNames(modelMap, "symbols", component.symbols)),
    targetModelOptions(modelMap, "footprints", mappedModelNames(modelMap, "footprints", component.footprints))
  ]);
  const footprintOptions = associatedFootprintOptions(folder, allFootprintOptions,
    savedModels?.footprintIds || automaticFootprints.map((model) => model.id));
  const invalidDefaultModels = unresolvedTemplateDefaultModels(
    packageInfo,
    symbolOptions,
    footprintOptions
  );
  const selectedFootprintIds = orderFootprintsWithIpcMediumFirst(
    savedModels?.footprintIds || automaticFootprints.map((model) => model.id),
    footprintOptions,
    automaticFootprints.map((model) => ({ ...model, targetId: model.id }))
  );
  return {
    componentId: component.id,
    template: {
      id: template.id,
      revisionId: template.latestRevision?.id || null,
      name: template.name,
      category: template.latestRevision?.comment || "",
      itemNamingTemplate: folder.effectiveItemNamingSchemeTemplate || packageInfo.itemNamingTemplate
    },
    warnings: invalidDefaultModels.length ? [
      `Template ${template.latestRevision?.name || template.name}: invalid default model links: `
        + invalidDefaultModels.join(", ")
    ] : [],
    sourceParameters: sourceParameters(component),
    targetParameters: definitions.map((definition) => ({
      ...definition,
      dictionaryValues: dictionaryValues[definition.name] || null
    })),
    mappings: effectiveMappings,
    values: savedValues,
    resolvedValues,
    modelOptions: {
      symbols: symbolOptions,
      footprints: footprintOptions
    },
    models: {
      ...(savedModels || {}),
      symbolId: savedModels?.symbolId || automaticSymbol?.id || null,
      footprintIds: selectedFootprintIds,
      defaultFootprintId: selectedFootprintIds.find((id) => (
        isIpcMediumDensity(footprintOptions.find((model) => model.id === id))
      )) || selectedFootprintIds[0] || null
    },
    sourceModels: {
      symbols: (component.symbols || []).map((model) => ({
        id: model.id,
        name: model.name,
        revisionId: model.revisionId || model.revisionInternalId || ""
      })),
      footprints: (component.footprints || []).map((model) => ({
        id: model.id,
        name: model.name,
        revisionId: model.revisionId || model.revisionInternalId || ""
      }))
    },
    recommendations: {
      symbols: rankedModelMatches(component.symbols, symbolOptions, [savedModels?.symbolId || automaticSymbol?.id]),
      footprints: rankedModelMatches(component.footprints, footprintOptions,
        selectedFootprintIds)
    }
  };
}

function sourceComponentCategory(component) {
  return {
    id: component.componentTypeId || component.componentTypeName || "uncategorized",
    name: component.componentTypeName || "Sans categorie",
    path: component.componentType?.path || component.componentTypeName || "Sans categorie"
  };
}

async function componentMigrationCategories() {
  const [components, templates, folders] = await Promise.all([
    listEntities("components", "source"),
    listEntities("componentTemplates", "target", null, true),
    listTargetFolders("components")
  ]);
  const source = new Map();
  for (const component of components) {
    const category = sourceComponentCategory(component);
    const current = source.get(category.id) || { ...category, count: 0 };
    current.count += 1;
    source.set(category.id, current);
  }
  const target = templates.map((template) => {
    const name = template.latestRevision?.comment || template.name;
    const matchingFolders = folders.filter((folder) => targetTemplateFor(folder, [template]));
    return {
      id: template.latestRevision?.id || template.id,
      templateId: template.id,
      name,
      templateName: template.name,
      folderIds: matchingFolders.map((folder) => folder.id)
    };
  }).sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));
  return {
    source: [...source.values()].sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true })),
    target
  };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function prepareSemiAutomaticMigration({ sourceCategoryId, componentIds, targetFolderId, batchSize }) {
  const components = await listEntities("components", "source");
  const completed = await loadCompletedMigrations();
  let selected = components.filter((component) => sourceComponentCategory(component).id === sourceCategoryId)
    .filter((component) => !completed.components[component.id]);
  if (Array.isArray(componentIds) && componentIds.length) {
    const requested = new Set(componentIds);
    selected = selected.filter((component) => requested.has(component.id));
  }
  const limit = batchSize === "all" ? selected.length : Math.max(1, Math.min(200, Number(batchSize) || 20));
  selected = selected.slice(0, limit);
  const folder = await resolveTargetFolder("components", targetFolderId);
  const templates = await listEntities("componentTemplates", "target", null, true);
  const template = targetTemplateFor(folder, templates);
  if (!template) throw httpError(400, "No target template matches the selected destination folder");
  const rows = await mapWithConcurrency(selected, 4, async (base) => {
    const component = await hydrateComponentDetails(base, "source");
    if (component.detailsLoadError) {
      return { id: base.id, name: base.name, status: "failed", error: component.detailsLoadError };
    }
    const preview = await componentMappingPreview(component, folder, templates);
    const sources = new Map(preview.sourceParameters.map((parameter) => [parameter.key, parameter]));
    const unresolvedParameters = preview.targetParameters.filter((parameter) => {
      const sourceKey = preview.mappings[parameter.name];
      const value = Object.hasOwn(preview.values, parameter.name)
        ? preview.values[parameter.name]
        : sources.get(sourceKey)?.value ?? parameter.defaultValue ?? "";
      return !String(value).trim();
    }).map((parameter) => parameter.name);
    return {
      id: component.id,
      name: component.name,
      description: component.description || "",
      status: "ready-for-review",
      selectedModels: preview.models,
      sourceModels: preview.sourceModels,
      recommendations: preview.recommendations,
      unresolvedParameters,
      targetParameterCount: preview.targetParameters.length
    };
  });
  return {
    sourceCategoryId,
    targetFolder: { id: folder.id, path: folder.path || folder.name },
    template: { id: template.id, name: template.name, category: template.latestRevision?.comment || "" },
    available: components.filter((component) => sourceComponentCategory(component).id === sourceCategoryId
      && !completed.components[component.id]).length,
    count: rows.length,
    rows
  };
}

async function enrichComponentWithDesigner(component, preview, parameterName, searchContext = {}) {
  if (!altiumDesignerBridgeUrl) {
    throw httpError(503, "Altium Designer bridge is not configured. Set ALTIUM_DESIGNER_BRIDGE_URL after installing a local Designer connector.");
  }
  const targetParameter = preview.targetParameters.find((parameter) => parameter.name === parameterName);
  if (!targetParameter) throw httpError(400, `Unknown target parameter: ${parameterName}`);
  const catalogUrl = await discoverPartCatalogApiUrl();
  const response = await fetch(`${altiumDesignerBridgeUrl}/enrich`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(altiumDesignerBridgeToken ? { authorization: `Bearer ${altiumDesignerBridgeToken}` } : {})
    },
    body: JSON.stringify({
      component: {
        id: component.id,
        name: component.name,
        description: component.description || "",
        parameters: sourceParameters(component)
      },
      targetTemplate: preview.template,
      targetParameter: {
        name: targetParameter.name,
        dataType: targetParameter.dataType,
        dictionaryValues: targetParameter.dictionaryValues || null
      },
      partCatalogServiceUrl: catalogUrl,
      identityServiceUrls: partCatalogIdentityUrls,
      targetWorkspaceName: targetWorkspace.name,
      targetWorkspaceApiUrl: targetWorkspace.apiUrl,
      searchContext
    })
  });
  const text = await response.text();
  if (!response.ok) {
    if (response.status === 422 && /GetCloudSessionId|ContractFilter mismatch/i.test(text)) {
      const sourceValue = sourceParameters(component).find((parameter) => (
        normalizedCategory(parameter.name) === normalizedCategory(parameterName)
      ))?.value ?? searchContext[parameterName];
      const rawValues = typeof sourceValue === "string" && sourceValue.trim()
        ? { [parameterName]: sourceValue.trim() } : {};
      const validation = rawValues[parameterName]
        ? normalizeDesignerParameterValue(rawValues[parameterName], targetParameter) : null;
      return {
        values: validation ? { [parameterName]: validation.value } : {},
        rawValues,
        validations: validation ? { [parameterName]: validation } : {},
        source: "Source component parameters",
        warnings: ["La session de recherche catalogue du bridge Altium est indisponible ; valeur source proposée si elle existe. La recherche fournisseur n'a pas été exécutée."],
        search: null
      };
    }
    throw new Error(`Altium Designer bridge failed (HTTP ${response.status}): ${text.slice(0, 500)}`);
  }
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("Altium Designer bridge returned invalid JSON"); }
  const rawValues = Object.fromEntries(Object.entries(data.values || {})
    .filter(([name, value]) => preview.targetParameters.some((parameter) => parameter.name === name)
      && typeof value === "string"));
  const validations = Object.fromEntries(Object.entries(rawValues).map(([name, value]) => {
    const parameter = preview.targetParameters.find((candidate) => candidate.name === name);
    return [name, normalizeDesignerParameterValue(value, parameter)];
  }));
  return {
    values: Object.fromEntries(Object.entries(validations).map(([name, validation]) => [name, validation.value])),
    rawValues,
    validations,
    source: data.source || "Altium Designer Manufacturer Part Search",
    warnings: Array.isArray(data.warnings) ? data.warnings : [],
    search: data.search || null
  };
}

async function preserveComponentPartChoices(component, targetComponentId, mutation) {
  const sourceChoices = (component.manufacturerParts || [])
    .filter((choice) => choice.companyName && choice.partNumber)
    .sort((left, right) => (left.priority ?? 0) - (right.priority ?? 0));
  if (!sourceChoices.length || !targetComponentId) {
    return { added: 0, skipped: sourceChoices.length };
  }
  let targetComponent = null;
  try {
    targetComponent = await hydrateComponentDetails({ id: targetComponentId }, "target");
  } catch {
    // A newly released revision can take a moment to become queryable.
  }
  const choiceKey = (choice) => `${choice.companyName}`.trim().toLowerCase()
    + `\u0000${choice.partNumber}`.trim().toLowerCase();
  const existing = new Set((targetComponent?.manufacturerParts || []).map(choiceKey));
  const missing = sourceChoices.filter((choice) => !existing.has(choiceKey(choice)));
  if (!missing.length) {
    return { added: 0, skipped: sourceChoices.length };
  }
  const data = await graphql("target", mutation.query, {
    input: {
      componentId: targetComponentId,
      manufacturerParts: missing.map((choice) => ({
        companyName: choice.companyName,
        partNumber: choice.partNumber
      }))
    }
  }, mutation.operationName);
  const payload = data.desAddComponentPartChoices;
  assertNoPayloadErrors(payload, `Preserve Part Choices for ${component.name}`);
  return {
    added: missing.length,
    skipped: sourceChoices.length - missing.length,
    operationComponentId: payload.componentId || targetComponentId
  };
}

async function designerBridgeRequest(pathname, { method = "GET", body, authenticated = true, timeoutMs = 30_000 } = {}) {
  if (!altiumDesignerBridgeUrl) {
    throw httpError(503, "Altium Designer bridge is not configured. Set ALTIUM_DESIGNER_BRIDGE_URL.");
  }
  const response = await fetch(`${altiumDesignerBridgeUrl}${pathname}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(authenticated && altiumDesignerBridgeToken
        ? { authorization: `Bearer ${altiumDesignerBridgeToken}` } : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeoutMs)
  }).catch((error) => {
    throw httpError(503, `Altium Designer bridge is unavailable: ${error.message}`);
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch {
    throw httpError(502, "Altium Designer bridge returned invalid JSON");
  }
  if (!response.ok) {
    throw httpError(response.status, data.error || `Altium Designer bridge failed (HTTP ${response.status})`);
  }
  return data;
}

async function buildMigrationInput(item, kind, context) {
  const { dryRun, folder, templates, modelMap, parameterMappings } = context;
  if (kind === "symbols" || kind === "footprints") {
    let files = [{ fileId: "<uploaded-file-id>", relativePath: "<release package path>" }];
    if (!dryRun) {
      const downloadedFiles = await downloadSourceModelFiles(item, kind);
      files = await Promise.all(downloadedFiles.map(async (file) => ({
        fileId: await uploadTargetFile(file),
        relativePath: file.relativePath
      })));
    }
    const input = {
      folderId: folder.id || `<${folder.name}>`,
      files
    };
    if (kind === "footprints") {
      input.comment = item.comment || "";
      input.description = item.description || "";
    }
    return input;
  }

  const template = targetTemplateFor(folder, templates);
  if (!template) {
    throw new Error(`No Global Fluidra template matches destination folder ${folder.path || folder.name}`);
  }
  const packageInfo = await targetTemplatePackageInfo(template);
  const definitions = packageInfo.definitions;
  const templateKey = template.latestRevision?.id || template.id;
  const savedTemplate = parameterMappings?.templates?.[templateKey] || {};
  const mappings = savedTemplate.mappings || {};
  const savedValues = savedTemplate.componentValues?.[item.id] || {};
  const parameters = componentParameters(item, definitions, mappings, savedValues);
  const dictionaryValues = await dictionaryValuesForTemplate(template, definitions, item);
  const definitionsByName = new Map(definitions.map((definition) => [definition.name, definition]));
  for (const parameter of parameters) {
    const allowed = dictionaryValues[parameter.name];
    if (!allowed?.length) continue;
    if (!parameter.value && definitionsByName.get(parameter.name)?.required) {
      throw new Error(`Choose a value for required dictionary parameter "${parameter.name}" before migration`);
    }
    if (parameter.value && !allowed.includes(parameter.value)) {
      throw new Error(`The saved value "${parameter.value}" is not allowed for "${parameter.name}". Choose one of: ${allowed.join(", ")}`);
    }
  }
  const savedModels = parameterMappings?.componentModels?.[item.id];
  const automaticSymbol = item.symbols?.[0] ? mappedModel(modelMap, "symbols", item.symbols[0]) : null;
  const automaticFootprints = (item.footprints || [])
    .map((model) => {
      const mapped = mappedModel(modelMap, "footprints", model);
      return mapped ? {
        ...mapped,
        sourceDescription: model.description || "",
        sourceComment: model.comment || ""
      } : null;
    })
    .filter(Boolean);
  const [symbolOptions, allFootprintOptions] = await Promise.all([
    targetModelOptions(modelMap, "symbols", mappedModelNames(modelMap, "symbols", item.symbols)),
    targetModelOptions(modelMap, "footprints", mappedModelNames(modelMap, "footprints", item.footprints))
  ]);
  const footprintOptions = associatedFootprintOptions(folder, allFootprintOptions,
    savedModels?.footprintIds || automaticFootprints.map((model) => model.id));
  validateTemplateDefaultModels(template, packageInfo, symbolOptions, footprintOptions);
  const selectedSymbolId = savedModels?.symbolId || automaticSymbol?.id;
  const selectedFootprintIds = orderFootprintsWithIpcMediumFirst(
    savedModels?.footprintIds || automaticFootprints.map((model) => model.id),
    footprintOptions,
    automaticFootprints.map((model) => ({ ...model, targetId: model.id }))
  );
  const symbol = symbolOptions.find((model) => model.id === selectedSymbolId);
  const footprints = selectedFootprintIds
    .map((id) => footprintOptions.find((model) => model.id === id))
    .filter(Boolean);
  if (!symbol) throw new Error("Choose a migrated symbol in the component mapping before migration");
  if (!footprints.length) throw new Error("Choose at least one migrated footprint in the component mapping before migration");
  if (footprints.length !== selectedFootprintIds.length) {
    throw new Error("At least one selected footprint is no longer available among migrated footprints");
  }
  if (!dryRun) {
    await assertTargetModelRevisionBinding(symbol, "symbols");
    for (const footprint of footprints) {
      await assertTargetModelRevisionBinding(footprint, "footprints");
    }
  }
  const itemNamingTemplate = folder.effectiveItemNamingSchemeTemplate || packageInfo.itemNamingTemplate;
  if (!itemNamingTemplate) {
    throw new Error(
      `No Item Naming Scheme is available for destination folder ${folder.path || folder.name}`
    );
  }
  context.componentItemNamingTemplate = itemNamingTemplate;

  return {
    componentItemName: "",
    componentComment: item.comment || "",
    componentDescription: item.description || "",
    componentParentFolderId: folder.id || `<${folder.name}>`,
    componentTemplateId: template.id,
    parameters,
    ...(symbol ? { symbol: { id: symbol.id } } : {}),
    footprints: footprints.filter(Boolean).map((model) => ({ id: model.id })),
    useExistingComponentReleaseFolder: true
  };
}

function normalizeForTarget(entity, kind, context) {
  const copy = structuredClone(entity);
  delete copy.id;
  delete copy.itemId;
  delete copy.revisionId;
  delete copy.updatedAt;
  delete copy.lifecycleState;

  if (kind === "components") {
    copy.parameters = applyTargetTemplateParameters(copy, context.templates || []);
    copy.models = (copy.models || []).map((model) => {
      const mapped = context.modelMap?.[model.id] || context.modelMap?.[model.revisionId];
      if (!mapped) return { ...model, unresolvedSourceModel: true };
      return mapped;
    });
  }

  return copy;
}

function applyTargetTemplateParameters(component, templates) {
  const existing = new Map((component.parameters || []).map((p) => [p.name, p.value]));
  const template = findTemplate(component, templates);
  if (!template?.parameterDefinitions) return component.parameters || [];

  return template.parameterDefinitions.map((definition) => ({
    name: definition.name,
    value: existing.get(definition.name) ?? definition.defaultValue ?? ""
  }));
}

function findTemplate(component, templates) {
  return templates.find((t) => t.componentType && t.componentType === component.componentType)
    || templates.find((t) => t.name && component.template?.name && t.name === component.template.name)
    || null;
}

function validateNoSourceReferences(entity) {
  const serialized = JSON.stringify(entity);
  const hits = [];
  const sourceNames = sourceWorkspaces
    .filter((workspace) => workspace.id === activeSourceWorkspaceId)
    .flatMap((workspace) => [workspace.id, workspace.name])
    .filter((value) => value && value.length > 2);
  if (sourceNames.some((value) => serialized.toLowerCase().includes(value.toLowerCase()))) {
    hits.push(`Text reference to source workspace ${workspaceLabels.source}`);
  }
  if (/"unresolvedSourceModel":true/.test(serialized)) hits.push("Unresolved model mapping");
  if (entity.detailsLoadError) hits.push(`DesComponentDetails unavailable: ${entity.detailsLoadError}`);
  return hits;
}

async function migrateEntities({ kind, ids, dryRun, targetFolderId }) {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  let selected;
  if (kind === "components") {
    const sourceItems = await listEntities(kind, "source");
    selected = sourceItems.filter((item) => ids.includes(item.id));
    selected = await Promise.all(selected.map((item) => hydrateComponentDetails(item, "source")));
  } else {
    selected = await Promise.all(ids.map((id) => hydrateLibraryModel({ id }, kind, "source")));
  }
  const templates = kind === "components"
    ? await listEntities("componentTemplates", "target", null, true) : [];
  const mutationName = kind === "symbols" ? "createSymbol" : kind === "footprints" ? "createFootprint" : "createComponent";
  const mutation = config.mutations[mutationName];
  const results = [];
  const folder = await resolveTargetFolder(kind, targetFolderId);
  const modelMap = await loadModelMap();
  const parameterMappings = kind === "components" ? await loadParameterMappings() : null;

  for (const item of selected) {
    try {
      if (!dryRun && (kind === "symbols" || kind === "footprints")) {
        const existingMapping = mappedModel(modelMap, kind, item, folder.id);
        if (existingMapping) {
          const result = {
            sourceId: item.id,
            targetId: existingMapping.id,
            targetName: existingMapping.name,
            name: item.name,
            status: "already-migrated",
            targetFolder: existingMapping.folderPath || folder.path || folder.name
          };
          results.push(result);
          await rememberCompletedMigration(kind, item, result, folder);
          continue;
        }
      }
      let existingComponent = kind === "components"
        ? (await findTargetComponentCandidates(item, folder)).at(-1) || null : null;
      const buildContext = {
        dryRun,
        folder,
        templates,
        modelMap,
        parameterMappings
      };
      const input = await buildMigrationInput(item, kind, buildContext);
      const componentItemNamingTemplate = buildContext.componentItemNamingTemplate || "";
      if (existingComponent
        && !itemNameMatchesTemplate(existingComponent.name, componentItemNamingTemplate)) {
        existingComponent = null;
      }
      if (kind === "components" && !existingComponent) {
        existingComponent = await findTargetComponentByComment(
          item,
          folder,
          componentItemNamingTemplate
        );
      }
      if (existingComponent) {
        input.componentItemName = baseItemName(existingComponent.name);
      } else if (kind === "components") {
        input.componentItemName = await nextComponentItemName(componentItemNamingTemplate);
      }
      const validation = validateNoSourceReferences(input);
      if (validation.length) {
        results.push({ sourceId: item.id, name: item.name, status: "blocked", validation, input });
        continue;
      }
      if (dryRun) {
        results.push({
          sourceId: item.id,
          name: item.name,
          status: "dry-run",
          input,
          targetFolder: folder.name,
          ...(kind === "components" ? {
            itemNamingTemplate: componentItemNamingTemplate,
            partChoices: (item.manufacturerParts || []).map((choice) => ({
              companyName: choice.companyName,
              partNumber: choice.partNumber,
              priority: choice.priority
            })),
            operation: existingComponent ? "release-new-revision" : "create-item",
            ...(existingComponent ? {
              existingTargetId: existingComponent.id,
              existingTargetName: existingComponent.name
            } : {})
          } : {})
        });
        continue;
      }
      let data;
      try {
        data = await graphql("target", mutation.query, { input }, mutation.operationName);
      } catch (error) {
        const retryableHridCollision = kind === "components"
          && !existingComponent
          && /invalid item hrid|hrid.*(?:exists|duplicate)|already exists/i.test(error.message);
        if (!retryableHridCollision) throw error;
        input.componentItemName = await nextComponentItemName(componentItemNamingTemplate);
        data = await graphql("target", mutation.query, { input }, mutation.operationName);
      }
      const payloadName = kind === "symbols" ? "desCreateSymbol"
        : kind === "footprints" ? "desCreateFootprint" : "desReleaseComponent";
      const payload = data[payloadName];
      assertNoPayloadErrors(payload, `Migrate ${item.name}`);
      let targetId = kind === "symbols" ? payload.id
        : kind === "footprints" ? payload.footprintId : null;
      let createdComponent = null;
      if (kind === "components") {
        createdComponent = existingComponent
          ? await findCreatedTargetComponent(
            existingComponent.name,
            folder,
            revisionSequence(existingComponent.name)
          )
          : await findCreatedTargetComponent(input.componentItemName, folder);
        targetId = createdComponent?.id || existingComponent?.id || null;
        const partChoices = await preserveComponentPartChoices(
          item,
          targetId,
          config.mutations.addComponentPartChoices
        );
        buildContext.partChoices = partChoices;
      }
      let createdTarget = null;
      if (targetId && (kind === "symbols" || kind === "footprints")) {
        createdTarget = await hydrateLibraryModel({ id: targetId }, kind, "target");
        await rememberModelMapping(modelMap, kind, item, createdTarget, folder);
      }
      const result = {
        sourceId: item.id,
        targetId,
        targetRevisionId: createdTarget?.revisionInternalId || createdComponent?.revisionId
          || String(targetId || "").split("/").at(-1) || "",
        name: item.name,
        ...((createdTarget?.name || createdComponent?.name || (kind === "components" && input.componentItemName))
          ? { targetName: createdTarget?.name || createdComponent?.name || input.componentItemName } : {}),
        status: existingComponent ? "released" : "created",
        ...(existingComponent ? { previousTargetId: existingComponent.id } : {}),
        ...(kind === "components" ? {
          partChoices: buildContext.partChoices,
          previousTargetRevision: existingComponent ? revisionSequence(existingComponent.name) : 0,
          indexingPending: !createdComponent,
          ...(!createdComponent ? {
            warning: "The release was accepted by Altium 365; its new revision is still being indexed."
          } : {})
        } : {}),
        targetFolder: createdTarget?.folder?.path || folder.path || folder.name
      };
      results.push(result);
      await rememberCompletedMigration(kind, item, result, folder);
    } catch (error) {
      results.push({ sourceId: item.id, name: item.name, status: "failed", error: error.message });
    }
  }

  await saveMigrationLog(kind, { dryRun, results });
  return { kind, dryRun, count: results.length, results };
}

async function saveMigrationLog(kind, payload) {
  await mkdir(migrationLogsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await writeFile(path.join(migrationLogsDir, `${stamp}-${kind}.json`), JSON.stringify(payload, null, 2));
}

async function handleApi(req, res, url) {
  try {
    if (url.pathname === "/api/config") {
      sendJson(res, 200, publicConfig());
      return;
    }
    if (url.pathname === "/api/settings" && req.method === "GET") {
      sendJson(res, 200, editableSettings());
      return;
    }
    if (url.pathname === "/api/settings" && req.method === "POST") {
      const body = await readJsonBody(req);
      const settings = await saveEditableSettings(body);
      sendJson(res, 200, { ok: true, settings, ...publicConfig() });
      return;
    }
    if (url.pathname === "/api/source-workspace" && req.method === "POST") {
      const body = await readJsonBody(req);
      if (!sourceWorkspaces.some((workspace) => workspace.id === body.id)) {
        throw httpError(400, "Unknown source workspace");
      }
      const settings = editableSettings();
      settings.activeSourceWorkspaceId = body.id;
      await saveEditableSettings(settings);
      sendJson(res, 200, { ok: true, ...publicConfig() });
      return;
    }
    if (url.pathname === "/api/restart" && req.method === "POST") {
      reloadRuntimeConfig();
      sendJson(res, 200, { ok: true, reloadedAt: new Date().toISOString(), ...publicConfig() });
      return;
    }
    if (url.pathname === "/api/designer/status" && req.method === "GET") {
      sendJson(res, 200, await designerBridgeRequest("/health", { authenticated: false }));
      return;
    }
    if (url.pathname === "/api/designer/context" && req.method === "GET") {
      sendJson(res, 200, await designerBridgeRequest("/v1/context"));
      return;
    }
    if (url.pathname === "/api/designer/processes" && req.method === "GET") {
      sendJson(res, 200, await designerBridgeRequest("/v1/processes"));
      return;
    }
    if (url.pathname === "/api/designer/execute" && req.method === "POST") {
      const body = await readJsonBody(req);
      if (!body.process || typeof body.process !== "string") {
        throw httpError(400, "DXP process is required in Server:Command format");
      }
      sendJson(res, 200, await designerBridgeRequest("/v1/processes/execute", {
        method: "POST",
        body: { process: body.process, parameters: String(body.parameters || "") }
      }));
      return;
    }
    if (url.pathname === "/api/designer/compile" && req.method === "POST") {
      sendJson(res, 200, await designerBridgeRequest("/v1/projects/compile", {
        method: "POST",
        body: {}
      }));
      return;
    }
    if (url.pathname === "/api/test") {
      const workspace = url.searchParams.get("workspace") || "source";
      const data = await graphql(workspace, "query Ping { __typename }", {}, "Ping");
      sendJson(res, 200, { ok: true, workspace, data });
      return;
    }
    if (url.pathname === "/api/introspect") {
      const workspace = url.searchParams.get("workspace") || "source";
      const data = await graphql(workspace, introspectionQuery, {}, "IntrospectionQuery");
      await mkdir(path.join(__dirname, "schema_cache"), { recursive: true });
      await writeFile(
        path.join(__dirname, "schema_cache", `${workspace}.schema.json`),
        JSON.stringify(data, null, 2)
      );
      sendJson(res, 200, summarizeSchema(data));
      return;
    }
    if (url.pathname === "/api/list") {
      const kind = url.searchParams.get("kind");
      const workspace = url.searchParams.get("workspace") || "source";
      const parsedLimit = Number(url.searchParams.get("limit"));
      const limit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : null;
      const forceRefresh = url.searchParams.get("refresh") === "true";
      const workspaceCacheKey = workspace === "source" ? `source-${activeSourceWorkspaceId}` : workspace;
      const cacheKey = `${workspaceCacheKey}:${kind}`;
      const rows = await listEntities(kind, workspace, limit, forceRefresh);
      const cacheSource = entityCacheSources.get(cacheKey) || "network";
      sendJson(res, 200, {
        rows,
        cache: {
          hit: cacheSource !== "network",
          source: cacheSource,
          cachedAt: entityCaches.get(cacheKey)?.cachedAt || null
        }
      });
      return;
    }
    if (url.pathname === "/api/folders") {
      const kind = url.searchParams.get("kind");
      const rows = await listTargetFolders(kind);
      sendJson(res, 200, { rows });
      return;
    }
    if (url.pathname === "/api/projects-migration/projects" && req.method === "GET") {
      const forceRefresh = url.searchParams.get("refresh") === "true";
      sendJson(res, 200, { rows: await listProjectsForMigration(forceRefresh) });
      return;
    }
    if (url.pathname === "/api/projects-migration/target-projects" && req.method === "GET") {
      sendJson(res, 200, await listTargetProjectsInFolder(url.searchParams.get("folderId")));
      return;
    }
    if (url.pathname === "/api/projects-migration/preflight" && req.method === "POST") {
      const body = await readJsonBody(req);
      sendJson(res, 200, await projectMigrationPreflight(body.projectId, body.targetFolderId, body.refresh === true, body.reuseEmptyTarget === true));
      return;
    }
    if (url.pathname === "/api/projects-migration/migrate" && req.method === "POST") {
      const body = await readJsonBody(req);
      if (body.dryRun === true) {
        sendJson(res, 200, await projectMigrationPreflight(body.projectId, body.targetFolderId, false, body.reuseEmptyTarget === true));
        return;
      }
      const transferKey = `${activeSourceWorkspaceId}|${body.projectId}|${endpoints.target}`;
      if (activeProjectTransfers.has(transferKey)) throw httpError(409, "A migration of this project is already running");
      activeProjectTransfers.add(transferKey);
      try {
        sendJson(res, 200, await migrateProjectWithHistory(body.projectId, body.targetFolderId, body.reuseEmptyTarget === true));
      } finally {
        activeProjectTransfers.delete(transferKey);
      }
      return;
    }
    if (url.pathname === "/api/model-thumbnail" && req.method === "GET") {
      const kind = url.searchParams.get("kind");
      const id = url.searchParams.get("id");
      const workspace = url.searchParams.get("workspace") || "source";
      if (!new Set(["symbols", "footprints"]).has(kind) || !id) {
        throw httpError(400, "kind and id are required");
      }
      if (!new Set(["source", "target"]).has(workspace)) {
        throw httpError(400, "workspace must be source or target");
      }
      const thumbnail = await downloadModelThumbnail(kind, id, workspace);
      sendBinary(res, 200, thumbnail.bytes, thumbnail.contentType);
      return;
    }
    if (url.pathname === "/api/library-render" && req.method === "GET") {
      const kind = url.searchParams.get("kind");
      const id = url.searchParams.get("id");
      const workspace = url.searchParams.get("workspace") || "source";
      const view = url.searchParams.get("view") || "2d";
      const layerParam = url.searchParams.get("layers");
      const layers = layerParam === null ? null
        : [...new Set(layerParam.split(",").filter(Boolean).map(Number))].sort((a, b) => a - b);
      if (!new Set(["symbols", "footprints"]).has(kind) || !id) {
        throw httpError(400, "kind and id are required");
      }
      if (!new Set(["source", "target"]).has(workspace)) {
        throw httpError(400, "workspace must be source or target");
      }
      if (!new Set(["2d", "3d"]).has(view) || (view === "3d" && kind !== "footprints")) {
        throw httpError(400, "The requested library view is not supported");
      }
      if (layers?.some((layer) => !Number.isInteger(layer) || layer < 0 || layer > 255) || (layers?.length || 0) > 128) {
        throw httpError(400, "Invalid footprint layer selection");
      }
      const renderPath = await ensureLibraryRender(kind, id, workspace, view, layers);
      const bytes = await readFile(renderPath);
      sendBinary(res, 200, bytes, view === "3d" ? "application/json; charset=utf-8" : "image/svg+xml; charset=utf-8");
      return;
    }
    if (url.pathname === "/api/migration-state" && req.method === "GET") {
      sendJson(res, 200, await completedMigrationState());
      return;
    }
    if (url.pathname === "/api/migration-state/footprint-bindings" && req.method === "GET") {
      sendJson(res, 200, await completedFootprintBindingDiagnostics());
      return;
    }
    if (url.pathname === "/api/migration-state/footprint-revisions" && req.method === "GET") {
      sendJson(res, 200, await modelRevisionChoices("footprints", url.searchParams.get("sourceId") || ""));
      return;
    }
    if (url.pathname === "/api/migration-state/footprint-revisions" && req.method === "POST") {
      const body = await readJsonBody(req);
      sendJson(res, 200, await selectMigratedModelRevision("footprints", body.sourceId, body.targetId));
      return;
    }
    if (url.pathname === "/api/migration-state/model-revisions" && req.method === "GET") {
      sendJson(res, 200, await modelRevisionChoices(
        url.searchParams.get("kind"), url.searchParams.get("sourceId") || ""
      ));
      return;
    }
    if (url.pathname === "/api/migration-state/model-revisions" && req.method === "POST") {
      const body = await readJsonBody(req);
      sendJson(res, 200, await selectMigratedModelRevision(body.kind, body.sourceId, body.targetId));
      return;
    }
    if (url.pathname === "/api/migration-state/unmark" && req.method === "POST") {
      const body = await readJsonBody(req);
      if (!body.sourceId) throw httpError(400, "Component source id is required");
      const removed = await forgetCompletedMigration(body.kind || "components", body.sourceId);
      sendJson(res, 200, { ok: true, removed, sourceId: body.sourceId });
      return;
    }
    if (url.pathname === "/api/component-migration-categories" && req.method === "GET") {
      sendJson(res, 200, await componentMigrationCategories());
      return;
    }
    if (url.pathname === "/api/semi-auto/prepare" && req.method === "POST") {
      const body = await readJsonBody(req);
      if (!body.sourceCategoryId) throw httpError(400, "Source component category is required");
      if (!body.targetFolderId) throw httpError(400, "Target component folder is required");
      sendJson(res, 200, await prepareSemiAutomaticMigration(body));
      return;
    }
    if (url.pathname === "/api/model-files") {
      const kind = url.searchParams.get("kind");
      const id = url.searchParams.get("id");
      if (!new Set(["symbols", "footprints"]).has(kind) || !id) {
        throw httpError(400, "kind and id are required");
      }
      const item = await hydrateLibraryModel({ id }, kind, "source");
      const files = await downloadSourceModelFiles(item, kind);
      sendJson(res, 200, {
        id: item.id,
        name: item.name,
        files: files.map((file) => ({
          filename: file.filename,
          relativePath: file.relativePath,
          size: file.bytes.length
        }))
      });
      return;
    }
    if (url.pathname === "/api/component-details") {
      const id = url.searchParams.get("id");
      const workspace = url.searchParams.get("workspace") || "source";
      if (!id) throw new Error("Component id is required");
      const component = await hydrateComponentDetails({ id }, workspace);
      sendJson(res, component.detailsLoadError ? 422 : 200, { component });
      return;
    }
    if (url.pathname === "/api/component-mapping-preview" && req.method === "POST") {
      const body = await readJsonBody(req);
      if (!body.componentId) throw httpError(400, "Component id is required");
      const sourceItems = await listEntities("components", "source");
      const base = sourceItems.find((item) => item.id === body.componentId);
      if (!base) throw httpError(404, "Source component not found");
      const component = await hydrateComponentDetails(base, "source");
      if (component.detailsLoadError) throw new Error(component.detailsLoadError);
      const folder = await resolveTargetFolder("components", body.targetFolderId);
      const templates = await listEntities("componentTemplates", "target", null, true);
      sendJson(res, 200, await componentMappingPreview(component, folder, templates));
      return;
    }
    if (url.pathname === "/api/dictionary-values/refresh" && req.method === "POST") {
      const body = await readJsonBody(req);
      if (!body.componentId) throw httpError(400, "Component id is required");
      const sourceItems = await listEntities("components", "source");
      const base = sourceItems.find((item) => item.id === body.componentId);
      if (!base) throw httpError(404, "Source component not found");
      const component = await hydrateComponentDetails(base, "source");
      if (component.detailsLoadError) throw new Error(component.detailsLoadError);
      const folder = await resolveTargetFolder("components", body.targetFolderId);
      const templates = await listEntities("componentTemplates", "target", null, true);
      await loadDictionaryValuesCache(true);
      const preview = await componentMappingPreview(component, folder, templates);
      sendJson(res, 200, { ...preview, dictionariesRefreshedAt: new Date().toISOString() });
      return;
    }
    if (url.pathname === "/api/component-enrichment" && req.method === "POST") {
      const body = await readJsonBody(req);
      if (!body.componentId) throw httpError(400, "Component id is required");
      const sourceItems = await listEntities("components", "source");
      const base = sourceItems.find((item) => item.id === body.componentId);
      if (!base) throw httpError(404, "Source component not found");
      const component = await hydrateComponentDetails(base, "source");
      const folder = await resolveTargetFolder("components", body.targetFolderId);
      const templates = await listEntities("componentTemplates", "target", null, true);
      const preview = await componentMappingPreview(component, folder, templates);
      if (!body.parameterName) throw httpError(400, "Target parameter name is required");
      sendJson(res, 200, await enrichComponentWithDesigner(
        component,
        preview,
        body.parameterName,
        body.searchContext && typeof body.searchContext === "object" ? body.searchContext : {}
      ));
      return;
    }
    if (url.pathname === "/api/parameter-mappings" && req.method === "POST") {
      const body = await readJsonBody(req);
      const templates = await listEntities("componentTemplates", "target", null, true);
      const template = templates.find((candidate) => candidate.id === body.templateId
        || candidate.latestRevision?.id === body.templateRevisionId);
      if (!template) throw httpError(404, "Target component template not found");
      const definitions = await targetTemplateDefinitions(template);
      const targetNames = new Set(definitions.map((definition) => definition.name));
      const mappings = Object.fromEntries(Object.entries(body.mappings || {})
        .filter(([targetName, sourceName]) => targetNames.has(targetName)
          && (sourceName === null || typeof sourceName === "string")));
      let component = null;
      if (body.componentId) {
        const sourceItems = await listEntities("components", "source");
        const base = sourceItems.find((item) => item.id === body.componentId);
        if (base) component = await hydrateComponentDetails(base, "source");
      }
      const dictionaryValues = await dictionaryValuesForTemplate(template, definitions, component);
      const values = Object.fromEntries(Object.entries(body.values || {})
        .filter(([targetName, value]) => targetNames.has(targetName) && typeof value === "string"));
      const definitionsByName = new Map(definitions.map((definition) => [definition.name, definition]));
      for (const [targetName, allowed] of Object.entries(dictionaryValues)) {
        const value = values[targetName];
        if (value === "" && !definitionsByName.get(targetName)?.required) continue;
        if (allowed.length && Object.hasOwn(values, targetName) && !allowed.includes(value)) {
          throw httpError(400, `Invalid dictionary value for ${targetName}`);
        }
      }
      const state = await loadParameterMappings();
      const modelMap = await loadModelMap();
      const [symbolOptions, allFootprintOptions] = await Promise.all([
        targetModelOptions(modelMap, "symbols"),
        targetModelOptions(modelMap, "footprints")
      ]);
      const requestedFootprintIds = Array.isArray(body.models?.footprintIds)
        ? body.models.footprintIds.filter((id) => typeof id === "string" && id) : [];
      const preferredFootprintIds = [
        ...(state.componentModels[body.componentId]?.footprintIds || []),
        ...(component?.footprints || [])
          .map((model) => mappedModel(modelMap, "footprints", model)?.id)
          .filter(Boolean)
      ];
      const mappingFolder = body.targetFolderId
        ? await resolveTargetFolder("components", body.targetFolderId) : null;
      const footprintOptions = mappingFolder
        ? associatedFootprintOptions(mappingFolder, allFootprintOptions, preferredFootprintIds)
        : allFootprintOptions;
      const availableSymbols = new Set(symbolOptions.map((model) => model.id));
      const availableFootprints = new Set(footprintOptions.map((model) => model.id));
      const symbolId = typeof body.models?.symbolId === "string" ? body.models.symbolId : "";
      const footprintIds = orderFootprintsWithIpcMediumFirst(
        requestedFootprintIds,
        footprintOptions
      );
      if (!availableSymbols.has(symbolId)) {
        throw httpError(400, "Choose a migrated symbol for the component");
      }
      if (!footprintIds.length) {
        throw httpError(400, "Choose at least one target footprint for the component");
      }
      if (footprintIds.some((id) => !availableFootprints.has(id))) {
        throw httpError(400, "A selected target footprint revision is no longer available; reload the component mapping");
      }
      const templateKey = template.latestRevision?.id || template.id;
      const existing = state.templates[templateKey] || {};
      state.templates[templateKey] = {
        templateId: template.id,
        templateName: template.name,
        category: template.latestRevision?.comment || "",
        mappings,
        componentValues: {
          ...(existing.componentValues || {}),
          ...(body.componentId ? { [body.componentId]: values } : {})
        },
        updatedAt: new Date().toISOString()
      };
      if (body.componentId) {
        state.componentModels[body.componentId] = {
          symbolId,
          footprintIds,
          updatedAt: new Date().toISOString()
        };
      }
      await writeJsonFile(parameterMappingsPath, state);
      sendJson(res, 200, {
        ok: true,
        templateKey,
        mappings,
        values,
        models: { symbolId, footprintIds }
      });
      return;
    }
    if (url.pathname === "/api/find-target-model") {
      const kind = url.searchParams.get("kind");
      const name = url.searchParams.get("name");
      const workspace = url.searchParams.get("workspace") || "target";
      if (!new Set(["symbols", "footprints"]).has(kind) || !name) {
        throw new Error("kind and name are required");
      }
      if (!new Set(["source", "target"]).has(workspace)) throw httpError(400, "Invalid workspace");
      const config = JSON.parse(await readFile(configPath, "utf8"));
      const operation = config.queries[kind === "symbols" ? "findTargetSymbol" : "findTargetFootprint"];
      const data = await graphql(workspace, operation.query, { name }, operation.operationName);
      sendJson(res, 200, { rows: getByPath(data, operation.resultPath) || [] });
      return;
    }
    if (url.pathname === "/api/find-target-component") {
      const name = url.searchParams.get("name");
      if (!name) throw httpError(400, "name is required");
      const config = JSON.parse(await readFile(configPath, "utf8"));
      const operation = config.queries.findTargetComponent;
      const data = await graphql("target", operation.query, { name }, operation.operationName);
      sendJson(res, 200, { rows: getByPath(data, operation.resultPath) || [] });
      return;
    }
    if (url.pathname === "/api/migrate" && req.method === "POST") {
      const body = await readJsonBody(req);
      const result = await migrateEntities(body);
      sendJson(res, 200, result);
      return;
    }
    sendJson(res, 404, { error: "Unknown API route" });
  } catch (error) {
    const status = error.status || 500;
    sendJson(res, status, {
      error: error.message,
      ...(status >= 500 ? { stack: error.stack } : {})
    });
  }
}

function summarizeSchema(data) {
  const schema = data.__schema;
  const queryType = schema.types.find((type) => type.name === schema.queryType?.name);
  const mutationType = schema.types.find((type) => type.name === schema.mutationType?.name);
  const libraryTypes = schema.types
    .filter((type) => /^lib/i.test(type.name || "") || /(component|symbol|footprint|template)/i.test(type.name || ""))
    .map((type) => ({
      name: type.name,
      kind: type.kind,
      fields: (type.fields || []).map((field) => field.name).slice(0, 30),
      inputFields: (type.inputFields || []).map((field) => field.name).slice(0, 30)
    }))
    .slice(0, 200);

  return {
    queryFields: (queryType?.fields || []).map((field) => field.name).filter((name) => /lib|component|symbol|footprint|template/i.test(name)),
    mutationFields: (mutationType?.fields || []).map((field) => field.name).filter((name) => /lib|component|symbol|footprint|template/i.test(name)),
    libraryTypes
  };
}

async function serveStatic(res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(publicDir, requested));
  if (!filePath.startsWith(publicDir)) {
    sendText(res, 403, "Forbidden");
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const type = ext === ".html" ? "text/html; charset=utf-8"
    : ext === ".css" ? "text/css; charset=utf-8"
    : ext === ".js" ? "text/javascript; charset=utf-8"
    : "application/octet-stream";
  try {
    sendText(res, 200, await readFile(filePath, "utf8"), type);
  } catch {
    sendText(res, 404, "Not found");
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    await handleApi(req, res, url);
    return;
  }
  await serveStatic(res, url.pathname);
}).listen(PORT, () => {
  console.log(`Altium migration assistant: http://localhost:${PORT}`);
});

