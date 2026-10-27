// Full HTTP workflow with real local Git repositories. Never contacts Altium.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
const run = promisify(execFile), [scenario, root] = process.argv.slice(2);
const git = async (args) => (await run("git", args, { windowsHide: true, timeout: 30000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } })).stdout.trim();
const sourceWorkspace = "11111111-1111-4111-8111-111111111111", targetWorkspace = "22222222-2222-4222-8222-222222222222";
const sourceGuid = "33333333-3333-4333-8333-333333333333", folderGuid = "55555555-5555-4555-8555-555555555555";
const folder = { id: "opaque-folder-id", folderId: folderGuid, name: "White Space", path: "Projects/France Team/White Space", folderType: "PROJECT_CATALOG", parent: null };
const nested = scenario === "nested", name = "Prototype Board", filename = nested ? "nested with spaces/Device.PrjPcb" : "Device.PrjPcb";
const seed = path.join(root, "seed"), sourceRepo = path.join(root, "source.git"), targetRepo = path.join(root, "target.git"), stateRoot = path.join(root, "state");
await mkdir(path.join(root, "temp"), { recursive: true }); await mkdir(seed); await mkdir(stateRoot);
process.env.TMPDIR = process.env.TMP = process.env.TEMP = path.join(root, "temp");
await git(["init", "-b", "master", seed]);
const parent = path.dirname(path.join(seed, filename)); await mkdir(parent, { recursive: true });
const projectBytes = Buffer.from(`\uFEFF[Design]\r\nManagedProjectGUID=${sourceGuid}\r\n[Document1]\r\nDocumentPath=Power µ v2.SchDoc\r\n[Document2]\r\nDocumentPath=Board rev A.PcbDoc\r\n`);
await writeFile(path.join(seed, filename), projectBytes);
await writeFile(path.join(parent, "Power µ v2.SchDoc"), Buffer.from("fixture schematic bytes"));
if (scenario !== "missing-document") await writeFile(path.join(parent, "Board rev A.PcbDoc"), Buffer.from("fixture pcb bytes"));
await writeFile(path.join(seed, "notes.txt"), "Original documentation\n");
await git(["-C", seed, "add", "."]);
await git(["-C", seed, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "Original design"]);
await git(["-C", seed, "tag", "v1"]); await git(["-C", seed, "branch", "support"]);
await writeFile(path.join(seed, "notes.txt"), "Original documentation, second commit\n");
await git(["-C", seed, "add", "notes.txt"]);
await git(["-C", seed, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "Keep original history"]);
await git(["clone", "--bare", seed, sourceRepo]);
const sourceHead = await git([`--git-dir=${sourceRepo}`, "rev-parse", "HEAD"]);
if (scenario === "log-unavailable") await writeFile(path.join(stateRoot, "migration_logs"), "A file occupies the log directory.");
const source = { id: `grid:workspace:${sourceWorkspace}:design:project/${sourceGuid}`, projectId: sourceGuid, name, description: "Description\nwith spaces | and Unicode µ", projectType: "PCB_PROJECT", repositoryType: "INTERNAL", repositoryUrl: pathToFileURL(sourceRepo).href, url: "https://source.example.365.altium.com/designs/" + sourceGuid, latestRevision: { revisionId: sourceHead }, revisions: { totalCount: 2 }, design: { releases: { totalCount: 3 } } };
const state = { target: null, publishCalls: 0, nativeCalls: 0, bridgeReads: 0, bridgeStopped: false, networkMutations: 0, releaseDownloads: 0, workingCopy: null, fullPath: null, pending: ["cloud-pending", "legacy-status"].includes(scenario), holdNative: scenario === "concurrent", nativeWaiting: false, released: false };
const nativeWorkspace = { publishSupported: true, nestedProjectPathsSupported: true, projectFolderBindingSupported: true, workspaceGuid: targetWorkspace, workspaceName: "Target fixture", workspaceUrl: "https://target.example.365.altium.com/" };
const variants = () => [{ name: "[No Variations]", schematics: [{ documentName: "Power µ v2.SchDoc" }], pcb: { documentName: "Board rev A.PcbDoc" } }];
const allFolders = () => [folder, ...(scenario === "catalog-collision" ? [{ ...folder, id: "collision-catalog-id", folderId: "66666666-6666-4666-8666-666666666666", name, path: folder.path + "/" + name, parent: folder }] : []), ...(state.target ? [{ id: "opaque-project-folder", folderId: state.target.projectId, name, path: folder.path + "/" + name, folderType: "PROJECT", parent: folder }] : [])];
const entity = () => ({ type: "Project", id: state.target.projectId, name, path: folder.path + "/" + name, parentFolder: { id: folderGuid, path: folder.path }, linkList: [{ rel: "GetEntityDetails", verb: "GET", href: `https://region.365.altium.com/multicad/api/v1/projects/${state.target.projectId}` }] });
async function targetProject() {
  if (!state.target) return null;
  if (state.target.repositoryType === "INTERNAL") state.target.latestRevision = { revisionId: await git([`--git-dir=${targetRepo}`, "rev-parse", "HEAD"]), files: [{ kind: "MODIFIED", path: "Device.PrjPcb" }] };
  return { ...state.target, design: { releases: { totalCount: 0 }, variants: state.pending && scenario !== "legacy-status" ? [] : variants() } };
}
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input);
  if (["127.0.0.1", "localhost"].includes(url.hostname)) return realFetch(input, options);
  assert.ok(url.hostname.endsWith(".example.365.altium.com") || url.hostname === "region.365.altium.com", "Tests must not contact a real workspace");
  const isSource = url.hostname.startsWith("source.");
  assert.equal(options.headers.authorization, "Bearer " + (isSource ? "fake-source-token" : "fake-target-token"));
  if (options.method === "POST") {
    const { query, variables, operationName } = JSON.parse(options.body);
    assert.match(query, /^\s*query\b/, "Project migration must not upload a snapshot or modify source releases");
    let data;
    if (/desLibrary/.test(query)) data = { desLibrary: { folders: allFolders() } };
    else if (/FindTargetProject/.test(operationName || query)) data = { desProjects: { nodes: scenario === "lost-publication-response" ? [] : state.target ? [await targetProject()] : [] } };
    else if (/desProjectIdFromAfsId/.test(query)) data = { desProjectIdFromAfsId: { projectId: state.target?.id } };
    else if (/desProjectById/.test(query)) data = { desProjectById: isSource ? source : await targetProject() };
    else if (/desProjects/.test(query)) data = { desProjects: { nodes: isSource ? [source] : state.target ? [await targetProject()] : [], pageInfo: { hasNextPage: false, endCursor: null } } };
    else throw new Error("Unhandled fixture GraphQL operation " + operationName);
    return Response.json({ data });
  }
  if (url.pathname === "/api/configuration") return Response.json({ services: [{ name: "platform-api", apiUrl: "https://region.365.altium.com/napi/graphql" }, { name: "files-service-api", apiUrl: "https://region.365.altium.com/files/" }] });
  if (url.pathname === "/svc/explorer/api/v1/entities") return Response.json({ entities: state.target ? [entity()] : [], totalEntities: state.target ? 1 : 0 });
  if (url.pathname.startsWith("/svc/explorer/api/v1/entities/")) return state.target ? Response.json(entity()) : Response.json({ error: "Not found" }, { status: 404 });
  if (/\/multicad\/api\/v1\/projects\//.test(url.pathname)) return Response.json({ Guid: state.target.projectId, Name: name, FolderPath: folder.path + "/" + name, ParentFolderGuid: folderGuid, ParentFolderPath: folder.path });
  if (/\/multicad\/api\/v1.0\/projects\/.+\/details/.test(url.pathname)) return Response.json({ Guid: state.target.projectId, WorkInProgressInfo: { GenerationStatus: state.pending ? 0 : 1, Sources: state.pending ? [] : [{ Source: "Metadata", VcsRevision: (await targetProject()).latestRevision.revisionId }] } });
  throw new Error("Unhandled fixture read " + url.pathname);
};
const bridge = createServer(async (req, res) => {
  try {
    assert.equal(state.bridgeStopped, false, "Cloud validation must work with Designer closed");
    const send = (value, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(value)); };
    if (req.url === "/health") return send({ capabilities: ["project-migration"] });
    assert.equal(req.headers.authorization, "Bearer fake-bridge-token");
    if (req.method === "GET") { state.bridgeReads++; return send(nativeWorkspace); }
    let raw = ""; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    if (req.url === "/v1/projects/ensure-migration-folder") {
      assert.equal(body.projectGuid, state.target.projectId); assert.equal(body.catalogGuid, folderGuid);
      return send({ verified: true });
    }
    if (req.url === "/v1/projects/publish-migration") {
      state.publishCalls++; state.workingCopy = body.workingCopyPath; state.fullPath = body.projectFullPath;
      assert.doesNotMatch(body.description, /[|\r\n\0]/);
      const guid = "44444444-4444-4444-8444-" + String(state.publishCalls).padStart(12, "0");
      const text = (await readFile(state.fullPath, "utf8")).replace(/^ManagedProjectGUID=.*$/m, "ManagedProjectGUID=" + guid + "\r");
      await writeFile(state.fullPath, text);
      state.target = { id: `grid:workspace:${targetWorkspace}:design:project/${guid}`, projectId: guid, name, repositoryType: "EXTERNAL", repositoryUrl: pathToFileURL(path.join(path.dirname(state.workingCopy), "temporary-origin.git")).href, url: "https://target.example.365.altium.com/designs/" + guid, revisions: { totalCount: 0 } };
      if (scenario === "lost-publication-response" && state.publishCalls === 1) return req.socket.destroy();
      return send({ projectGuid: guid, workspace: nativeWorkspace, projectFullPath: state.fullPath });
    }
    if (req.url === "/v1/processes/execute") {
      state.nativeCalls++; state.nativeWaiting = true;
      while (state.holdNative && !state.released) await new Promise((resolve) => setTimeout(resolve, 10));
      const scriptPath = body.parameters.match(/^FileName=(.+)\|ProcName=/)[1];
      const script = await readFile(scriptPath, "utf8");
      assert.ok(script.includes(state.target.projectId)); assert.ok(script.includes("WorkspaceManager:MigrateToInternalVCS"));
      const evidence = script.match(/L\.SaveToFile\('((?:[^']|'')*)'\)/)[1].replaceAll("''", "'");
      if (nested) {
        const text = (await readFile(state.fullPath, "utf8")).replace(/^DocumentPath=(.+)$/gm, (_, document) => "DocumentPath=nested with spaces\\" + document.trim() + "\r");
        await git(["-C", state.workingCopy, "mv", filename, "Device.PrjPcb"]);
        state.fullPath = path.join(state.workingCopy, "Device.PrjPcb"); await writeFile(state.fullPath, text);
      }
      await git(["-C", state.workingCopy, "add", "."]);
      await git(["-C", state.workingCopy, "-c", "user.name=Fixture Designer", "-c", "user.email=fixture@example.invalid", "commit", "-m", "Native target binding"]);
      await git(["clone", "--bare", state.workingCopy, targetRepo]);
      await git(["-C", state.workingCopy, "remote", "set-url", "origin", pathToFileURL(targetRepo).href]);
      state.target.repositoryType = "INTERNAL"; state.target.repositoryUrl = pathToFileURL(targetRepo).href;
      await writeFile(evidence, "started\nprojectFullPath=" + state.fullPath + "\nprojectGuid=" + state.target.projectId + "\nreturned\n");
      return send({ ok: true });
    }
    throw new Error("Unexpected native fixture command");
  } catch (error) { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ error: error.message })); }
});
await new Promise((resolve) => bridge.listen(0, "127.0.0.1", resolve));
Object.assign(process.env, { ALTIUM_DATA_ROOT: stateRoot, ALTIUM_SOURCE_WORKSPACES_JSON: JSON.stringify([{ id: "SOURCE_TEST", name: "Source fixture", apiUrl: "https://source.example.365.altium.com/api/graphql", accessToken: "fake-source-token" }]), ACTIVE_SOURCE_WORKSPACE: "SOURCE_TEST", ALTIUM_TARGET_WORKSPACE_JSON: JSON.stringify({ id: "TARGET_TEST", name: "Target fixture", apiUrl: "https://target.example.365.altium.com/api/graphql", accessToken: "fake-target-token" }), ALTIUM_USE_SYSTEM_CA: "false", ALTIUM_DESIGNER_BRIDGE_URL: `http://127.0.0.1:${bridge.address().port}`, ALTIUM_DESIGNER_BRIDGE_TOKEN: "fake-bridge-token" });
const { createApplicationServer } = await import("../../server.mjs");
const app = createApplicationServer({ projectCloudWait: { attempts: 1, delayMs: 0 } });
await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${app.address().port}`;
async function call(route) { const response = await realFetch(base + "/api/projects-migration/" + route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: source.id, targetFolderId: folder.id, refresh: true, dryRun: false }) }); return { status: response.status, body: await response.json() }; }
try {
  const preflight = await call("preflight");
  let first = null, second = null;
  if (scenario !== "catalog-collision") {
    if (scenario === "concurrent") {
      const pending = call("migrate");
      for (let i = 0; i < 3000 && !state.nativeWaiting; i++) await new Promise((resolve) => setTimeout(resolve, 10));
      assert.ok(state.nativeWaiting, "Native fixture must have started");
      for (const route of ["settings", "source-workspace"]) {
        const response = await realFetch(base + "/api/" + route, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
        assert.equal(response.status, 409, "Workspace configuration must stay fixed during a transfer");
      }
      second = await call("migrate"); state.released = true; first = await pending;
    } else first = await call("migrate");
    if (scenario === "lost-publication-response") second = await call("migrate");
    if (scenario === "cloud-pending") { state.pending = false; state.bridgeStopped = true; second = await call("validate"); }
  }
  const currentSourceHead = await git([`--git-dir=${sourceRepo}`, "rev-parse", "HEAD"]);
  let integrity = null;
  if (state.target?.repositoryType === "INTERNAL") {
    const targetHead = await git([`--git-dir=${targetRepo}`, "rev-parse", "HEAD"]);
    await git([`--git-dir=${targetRepo}`, "merge-base", "--is-ancestor", sourceHead, targetHead]);
    const docs = ["Power µ v2.SchDoc", ...(scenario === "missing-document" ? [] : ["Board rev A.PcbDoc"])].map((file) => nested ? "nested with spaces/" + file : file);
    for (const file of docs) assert.equal(await git([`--git-dir=${sourceRepo}`, "rev-parse", sourceHead + ":" + file]), await git([`--git-dir=${targetRepo}`, "rev-parse", targetHead + ":" + file]));
    integrity = { sourceHistoryPreserved: true, cadBlobsPreserved: true, targetGuid: state.target.projectId };
  }
  const transfers = await readdir(path.join(stateRoot, "migration_state", "project-transfers")).catch(() => []);
  const records = await Promise.all(transfers.filter((file) => file.endsWith(".json")).map(async (file) => JSON.parse(await readFile(path.join(stateRoot, "migration_state", "project-transfers", file), "utf8"))));
  console.log(JSON.stringify({ scenario, preflight, first, second, publishCalls: state.publishCalls, nativeCalls: state.nativeCalls, sourceUnchanged: currentSourceHead === sourceHead, integrity, phases: records.map((record) => record.phase) }));
} finally { state.released = true; await new Promise((resolve) => app.close(resolve)); await new Promise((resolve) => bridge.close(resolve)); }
