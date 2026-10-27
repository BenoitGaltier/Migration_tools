// Full HTTP workflow with real local Git repositories. Never contacts Altium.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createProjectArchive } from "../../lib/project-archive.mjs";
import { readProjectArchive } from "../../lib/project-archive.mjs";
import { createHash } from "node:crypto";
const run = promisify(execFile), [scenario, root] = process.argv.slice(2);
const git = async (args) => (await run("git", args, { windowsHide: true, timeout: 30000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } })).stdout.trim();
const sourceWorkspace = "11111111-1111-4111-8111-111111111111", targetWorkspace = "22222222-2222-4222-8222-222222222222";
const sourceGuid = "33333333-3333-4333-8333-333333333333", folderGuid = "55555555-5555-4555-8555-555555555555";
const folder = { id: "opaque-folder-id", folderId: folderGuid, name: "White Space", path: "Projects/France Team/White Space", folderType: "PROJECT_CATALOG", parent: null };
const kind = scenario.startsWith("harness") ? { type: "HARNESS_DESIGN", extension: "PrjHar", documents: ["Câblage µ.WirDoc", "Layout rev A.LdrDoc"] }
  : scenario.startsWith("system") ? { type: "SYSTEM_DESIGN", extension: "PrjMbd", documents: ["Overview.MbsDoc", "Assembly.MbaDoc"] }
    : { type: "PCB_PROJECT", extension: "PrjPcb", documents: ["Power µ v2.SchDoc", "Board rev A.PcbDoc"] };
const nested = scenario === "nested" || scenario.includes("-nested"), withChild = scenario.startsWith("system") && scenario.endsWith("-child"), name = "Prototype Board", baseFilename = `Device.${kind.extension}`, filename = nested ? "nested with spaces/" + baseFilename : baseFilename;
const childSourceGuid = "77777777-7777-4777-8777-777777777777", childTargetGuid = "88888888-8888-4888-8888-888888888888";
const childReference = (nested ? "../../" : "../") + "Child/Child.PrjPcb";
const documentNames = scenario.endsWith("wiring-only") ? kind.documents.slice(0, 1) : kind.documents;
const lostResponse = scenario === "lost-publication-response" || scenario.endsWith("lost-response");
const seed = path.join(root, "seed"), sourceRepo = path.join(root, "source.git"), targetRepo = path.join(root, "target.git"), stateRoot = path.join(root, "state");
await mkdir(path.join(root, "temp"), { recursive: true }); await mkdir(seed); await mkdir(stateRoot);
process.env.TMPDIR = process.env.TMP = process.env.TEMP = path.join(root, "temp");
await git(["init", "-b", "master", seed]);
const parent = path.dirname(path.join(seed, filename)); await mkdir(parent, { recursive: true });
const projectBytes = Buffer.from(`\uFEFF[Design]\r\nManagedProjectGUID=${sourceGuid}\r\n${documentNames.map((file, i) => `[Document${i + 1}]\r\nDocumentPath=${file}\r\n`).join("")}${withChild ? `[Document3]\r\nDocumentPath=${childReference}\r\nManagedProjectGUID=${childSourceGuid}\r\n` : ""}`);
await writeFile(path.join(seed, filename), projectBytes);
for (const [index, document] of documentNames.entries()) {
  if (scenario.endsWith("missing-document") && index === 1) continue;
  const modules = withChild ? [{ id: 1, designator: "Child", source: { sourceType: 1, projectGuid: childSourceGuid, sourceProject: childReference, projectName: "Original child", revisionGuid: "", boardFileName: childReference.replace("Child.PrjPcb", "Child.PcbDoc") }, entries: [] }] : [];
  const data = /\.MbsDoc$/i.test(document) ? createProjectArchive(new Map([["logical.json", Buffer.from(JSON.stringify({ modules, connections: [{ id: 12 }] }))]])) : Buffer.from(`fixture CAD bytes ${index}`);
  await writeFile(path.join(parent, document), data);
}
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
const source = { id: `grid:workspace:${sourceWorkspace}:design:project/${sourceGuid}`, projectId: sourceGuid, name, description: "Description\nwith spaces | and Unicode µ", projectType: kind.type, repositoryType: "INTERNAL", repositoryUrl: pathToFileURL(sourceRepo).href, url: "https://source.example.365.altium.com/designs/" + sourceGuid, latestRevision: { revisionId: sourceHead }, revisions: { totalCount: 2 }, design: { releases: { totalCount: 3 } } };
let childSource = null, childTarget = null, childInitialTargetHead = null, childTargetRepo;
if (withChild) {
  const childSeed = path.join(root, "child-seed"), childSourceRepo = path.join(root, "child-source.git"); childTargetRepo = path.join(root, "child-target.git");
  await mkdir(childSeed); await git(["init", "-b", "master", childSeed]);
  await writeFile(path.join(childSeed, "Child.PrjPcb"), `\uFEFF[Design]\nManagedProjectGUID=${childSourceGuid}\n[Document1]\nDocumentPath=Child.PcbDoc\n`);
  await writeFile(path.join(childSeed, "Child.PcbDoc"), "original child PCB"); await git(["-C", childSeed, "add", "."]);
  await git(["-C", childSeed, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "Original child history"]);
  const childSourceHead = await git(["-C", childSeed, "rev-parse", "HEAD"]); await git(["clone", "--bare", childSeed, childSourceRepo]);
  childSource = { ...source, id: `grid:workspace:${sourceWorkspace}:design:project/${childSourceGuid}`, projectId: childSourceGuid, name: "Original child", projectType: "PCB_PROJECT", repositoryUrl: pathToFileURL(childSourceRepo).href, latestRevision: { revisionId: childSourceHead } };
  if (!scenario.includes("missing-child")) {
    await git(["-C", childSeed, "mv", "Child.PrjPcb", "New.PrjPcb"]); await writeFile(path.join(childSeed, "New.PrjPcb"), `\uFEFF[Design]\nManagedProjectGUID=${childTargetGuid}\n[Document1]\nDocumentPath=Child.PcbDoc\n`);
    await git(["-C", childSeed, "add", "."]); await git(["-C", childSeed, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "Verified child destination binding"]);
    await git(["clone", "--bare", childSeed, childTargetRepo]); childInitialTargetHead = await git([`--git-dir=${childTargetRepo}`, "rev-parse", "HEAD"]);
    childTarget = { ...childSource, id: `grid:workspace:${targetWorkspace}:design:project/${childTargetGuid}`, projectId: childTargetGuid, name: "Verified global child", repositoryUrl: pathToFileURL(childTargetRepo).href, latestRevision: { revisionId: childInitialTargetHead }, design: { variants: [{ schematics: [], pcb: { documentName: "Child.PcbDoc" } }], releases: { totalCount: 0 } } };
    const recordKey = createHash("sha256").update(`https://source.example.365.altium.com/api/graphql|https://target.example.365.altium.com/api/graphql|${childSource.id}`).digest("hex");
    await mkdir(path.join(stateRoot, "migration_state", "project-transfers"), { recursive: true });
    await writeFile(path.join(stateRoot, "migration_state", "project-transfers", recordKey + ".json"), JSON.stringify({ sourceProjectId: scenario.includes("foreign-child") ? "foreign-source" : childSource.id, sourceHead: childSourceHead,
      phase: "completed", targetEndpoint: "https://target.example.365.altium.com/api/graphql", targetFolderId: folder.id, targetProjectId: childTarget.id, targetProjectGuid: childTargetGuid,
      sourceProjectFilename: "Child.PrjPcb", projectFilename: "New.PrjPcb", historyVerification: { verified: true } }));
    if (scenario.includes("stale-child")) {
      const newSource = path.join(root, "child-updated-source"); await git(["clone", childSourceRepo, newSource]); await writeFile(path.join(newSource, "new.txt"), "new source revision"); await git(["-C", newSource, "add", "."]);
      await git(["-C", newSource, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "Source advanced after child migration"]); await git(["-C", newSource, "push", "origin", "HEAD"]);
    }
  }
}
const state = { target: null, publishCalls: 0, nativeCalls: 0, bridgeReads: 0, bridgeStopped: false, networkMutations: 0, releaseDownloads: 0, workingCopy: null, fullPath: null, pending: scenario.endsWith("cloud-pending") || scenario === "legacy-status", holdNative: scenario === "concurrent", nativeWaiting: false, released: false };
const nativeWorkspace = { publishSupported: true, nestedProjectPathsSupported: true, projectFolderBindingSupported: true, supportedProjectTypes: scenario.endsWith("unsupported-bridge") ? ["PCB_PROJECT"] : ["PCB_PROJECT", "HARNESS_DESIGN", "SYSTEM_DESIGN"], workspaceGuid: targetWorkspace, workspaceName: "Target fixture", workspaceUrl: "https://target.example.365.altium.com/" };
const variants = () => [{ name: "[No Variations]", schematics: [{ documentName: "Power µ v2.SchDoc" }], pcb: { documentName: "Board rev A.PcbDoc" } }];
const allFolders = () => [folder, ...(childTarget ? [{ id: "child-project-folder", folderId: childTargetGuid, name: childTarget.name, path: folder.path + "/" + childTarget.name, folderType: "PROJECT", parent: folder }] : []), ...(scenario === "catalog-collision" ? [{ ...folder, id: "collision-catalog-id", folderId: "66666666-6666-4666-8666-666666666666", name, path: folder.path + "/" + name, parent: folder }] : []), ...(state.target ? [{ id: "opaque-project-folder", folderId: state.target.projectId, name, path: folder.path + "/" + name, folderType: "PROJECT", parent: folder }] : [])];
const childEntity = () => ({ type: "Project", id: childTargetGuid, name: childTarget.name, path: folder.path + "/" + childTarget.name, parentFolder: { id: folderGuid, path: folder.path }, linkList: [{ rel: "GetEntityDetails", verb: "GET", href: `https://region.365.altium.com/multicad/api/v1/projects/${childTargetGuid}` }] });
const entity = () => ({ type: "Project", id: state.target.projectId, name, path: folder.path + "/" + name, parentFolder: { id: folderGuid, path: folder.path }, linkList: [{ rel: "GetEntityDetails", verb: "GET", href: `https://region.365.altium.com/multicad/api/v1/projects/${state.target.projectId}` }] });
async function targetProject() {
  if (!state.target) return null;
  if (state.target.repositoryType === "INTERNAL") state.target.latestRevision = { revisionId: await git([`--git-dir=${targetRepo}`, "rev-parse", "HEAD"]), files: [{ kind: "MODIFIED", path: baseFilename }] };
  return { ...state.target, design: { releases: { totalCount: 0 }, variants: kind.type !== "PCB_PROJECT" || state.pending && scenario !== "legacy-status" ? [] : variants() } };
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
    // Nexar cannot resolve Git revisions while Designer's temporary origin is
    // a local file URL. Identity/type must be read before VCS conversion.
    if (!isSource && variables?.id === state.target?.id && state.target?.repositoryType === "EXTERNAL" && /\blatestRevision\b/.test(query)) {
      return Response.json({errors:[{message:"Cannot get VCS revision for project: unsupported URL protocol"}]});
    }
    let data;
    if (/desLibrary/.test(query)) data = { desLibrary: { folders: allFolders() } };
    else if (/FindTargetProject/.test(operationName || query)) data = { desProjects: { nodes: lostResponse ? [] : state.target ? [await targetProject()] : [] } };
    else if (/desProjectIdFromAfsId/.test(query)) data = { desProjectIdFromAfsId: { projectId: state.target?.id } };
    else if (/desProjectById/.test(query)) data = { desProjectById: isSource ? variables.id === childSource?.id ? childSource : source : variables.id === childTarget?.id ? childTarget : await targetProject() };
    else if (/desProjects/.test(query)) data = { desProjects: { nodes: isSource ? [source, ...(childSource ? [childSource] : [])] : state.target ? [await targetProject()] : [], pageInfo: { hasNextPage: false, endCursor: null } } };
    else throw new Error("Unhandled fixture GraphQL operation " + operationName);
    return Response.json({ data });
  }
  if (url.pathname === "/api/configuration") return Response.json({ services: [{ name: "platform-api", apiUrl: "https://region.365.altium.com/napi/graphql" }, { name: "files-service-api", apiUrl: "https://region.365.altium.com/files/" }] });
  if (url.pathname === "/svc/explorer/api/v1/entities") { const entities = [...(childTarget ? [childEntity()] : []), ...(state.target ? [entity()] : [])]; return Response.json({ entities, totalEntities: entities.length }); }
  if (url.pathname.startsWith("/svc/explorer/api/v1/entities/")) return url.pathname.endsWith(childTargetGuid) && childTarget ? Response.json(childEntity()) : state.target ? Response.json(entity()) : Response.json({ error: "Not found" }, { status: 404 });
  if (/\/multicad\/api\/v1\/projects\//.test(url.pathname)) { const p = url.pathname.endsWith(childTargetGuid) && childTarget ? childTarget : state.target; return Response.json({ Guid: p.projectId, Name: p.name, FolderPath: folder.path + "/" + p.name, ParentFolderGuid: folderGuid, ParentFolderPath: folder.path }); }
  if (/\/multicad\/api\/v1.0\/projects\/.+\/details/.test(url.pathname)) { const p = url.pathname.includes(childTargetGuid) && childTarget ? childTarget : await targetProject(), head = p.latestRevision.revisionId, pending = p === childTarget ? false : state.pending; return Response.json({ Guid: p.projectId, WorkInProgressInfo: { GenerationStatus: pending ? 0 : 1, Sources: pending ? [] : [{ Source: "Metadata", VcsRevision: head }, { Source: "Preview", VcsRevision: head }] } }); }
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
      assert.equal(body.projectType, kind.type);
      state.target = { id: `grid:workspace:${targetWorkspace}:design:project/${guid}`, projectId: guid, name, projectType: scenario.endsWith("wrong-target-type") ? "PCB_PROJECT" : kind.type, repositoryType: "EXTERNAL", repositoryUrl: pathToFileURL(path.join(path.dirname(state.workingCopy), "temporary-origin.git")).href, url: "https://target.example.365.altium.com/designs/" + guid, revisions: { totalCount: 0 } };
      if (lostResponse && state.publishCalls === 1) return req.socket.destroy();
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
        await git(["-C", state.workingCopy, "mv", filename, baseFilename]);
        state.fullPath = path.join(state.workingCopy, baseFilename); await writeFile(state.fullPath, text);
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
    if (lostResponse) second = await call("migrate");
    if (scenario.endsWith("cloud-pending")) { state.pending = false; state.bridgeStopped = true; second = await call("validate"); }
  }
  const currentSourceHead = await git([`--git-dir=${sourceRepo}`, "rev-parse", "HEAD"]);
  let integrity = null;
  if (state.target?.repositoryType === "INTERNAL") {
    const targetHead = await git([`--git-dir=${targetRepo}`, "rev-parse", "HEAD"]);
    await git([`--git-dir=${targetRepo}`, "merge-base", "--is-ancestor", sourceHead, targetHead]);
    const docs = documentNames.filter((file, index) => !(scenario.endsWith("missing-document") && index === 1)).map((file) => nested ? "nested with spaces/" + file : file);
    for (const file of docs) {
      if (withChild && /\.MbsDoc$/i.test(file)) {
        const body = await run("git", [`--git-dir=${targetRepo}`, "show", targetHead + ":" + file], { encoding: "buffer" });
        assert.equal(JSON.parse(readProjectArchive(body.stdout).get("logical.json")).modules[0].source.projectGuid, childTargetGuid);
      } else assert.equal(await git([`--git-dir=${sourceRepo}`, "rev-parse", sourceHead + ":" + file]), await git([`--git-dir=${targetRepo}`, "rev-parse", targetHead + ":" + file]));
    }
    integrity = { sourceHistoryPreserved: true, cadBlobsPreserved: true, targetGuid: state.target.projectId, childLinksVerified: withChild,
      childUnchanged: !childTarget || childInitialTargetHead === await git([`--git-dir=${childTargetRepo}`, "rev-parse", "HEAD"]) };
  }
  const transfers = await readdir(path.join(stateRoot, "migration_state", "project-transfers")).catch(() => []);
  const records = await Promise.all(transfers.filter((file) => file.endsWith(".json")).map(async (file) => JSON.parse(await readFile(path.join(stateRoot, "migration_state", "project-transfers", file), "utf8"))));
  console.log(JSON.stringify({ scenario, preflight, first, second, publishCalls: state.publishCalls, nativeCalls: state.nativeCalls, sourceUnchanged: currentSourceHead === sourceHead, integrity, phases: records.map((record) => record.phase) }));
} finally { state.released = true; await new Promise((resolve) => app.close(resolve)); await new Promise((resolve) => bridge.close(resolve)); }
