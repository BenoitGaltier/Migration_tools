import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { selectMigrationProjectFile, selectPublishedProjectFile, validateMigrationProjectPath, childMigrationWorkspace } from "../lib/project-paths.mjs";
import { detachManagedProject, managedProjectGuid } from "../lib/project-designer.mjs";
const run = promisify(execFile);
const nested = "iQ Bridge ZB/Carte_Pool_Bridge.PrjPcb";

test("child migration workspaces cannot overlap another repository or reserved transfer data", () => {
  const root = path.resolve(os.tmpdir(), "altium-child-layout"), working = path.join(root, "working-copy");
  const first = childMigrationWorkspace(working, root, "../child-a");
  assert.equal(first, path.join(root, "child-a"));
  assert.equal(childMigrationWorkspace(working, root, "../child-b", [first]), path.join(root, "child-b"));
  for (const relative of ["../child-a", "../child-a/nested", "..", "inside-parent", "../../outside", "../source.git", "../child-origins/a", "../destination-audit-x"]) {
    assert.throws(() => childMigrationWorkspace(working, root, relative, [first]), /overlap|dedicated migration/);
  }
  assert.throws(() => childMigrationWorkspace(working, root, "../child-a", [path.join(root, "child-a", "nested")]), /overlap/);
});

test("finds the native relocated project by its destination GUID and rejects ambiguous or wrong bindings", async () => {
  const guid = "5169F031-0FC6-40AF-B42F-F11DCF7D6B88";
  const bytes = (id) => Buffer.from(`\uFEFF[Design]\r\nManagedProjectGUID=${id}\r\n`);
  const files = new Map([["Carte_Pool_Bridge.PrjPcb", bytes(guid)], ["Other.PrjPcb", bytes("29D68ABC-2D29-4108-8BC0-50BFDD49FCD1")]]);
  assert.equal(await selectPublishedProjectFile([...files.keys()], guid, async (file) => files.get(file)), "Carte_Pool_Bridge.PrjPcb");
  await assert.rejects(selectPublishedProjectFile(["Other.PrjPcb"], guid, async (file) => files.get(file)), /found 0/);
  await assert.rejects(selectPublishedProjectFile(["a.PrjPcb", "b.PrjPcb"], guid, async () => bytes(guid)), /found 2/);
  await assert.rejects(selectPublishedProjectFile(["../Board.PrjPcb"], guid, async () => bytes(guid)), /Invalid PCB project path/);
});

test("selects iQ Bridge Zigbee's only PCB project inside a subfolder without renaming it", () => {
  assert.equal(selectMigrationProjectFile([".gitignore", nested, "iQ Bridge ZB/Carte_Pool_Bridge.PcbDoc"], "iQ Bridge Zigbee"), nested);
  assert.equal(selectMigrationProjectFile(["USB_TO_LIN.PrjPcb"], "USB_TO_LIN"), "USB_TO_LIN.PrjPcb");
  assert.equal(selectMigrationProjectFile(["folder/Board.PRJPCB"], "workspace label"), "folder/Board.PRJPCB");
});
test("uses an unambiguous name or saved path and refuses genuinely ambiguous projects", () => {
  assert.equal(selectMigrationProjectFile(["a/Board.PrjPcb", "b/Other.PrjPcb"], "Board"), "a/Board.PrjPcb");
  assert.equal(selectMigrationProjectFile(["a/Board.PrjPcb", "b/Board.PrjPcb"], "Board", "b/Board.PrjPcb"), "b/Board.PrjPcb");
  assert.throws(() => selectMigrationProjectFile(["a/Board.PrjPcb", "b/Board.PrjPcb"], "Board"), /Candidates: a\/Board.PrjPcb, b\/Board.PrjPcb/);
  assert.throws(() => selectMigrationProjectFile(["readme.txt"], "Board"), /contains no PCB project/);
  assert.throws(() => selectMigrationProjectFile([nested], "Board", "missing.PrjPcb"), /saved PCB project file is missing/);
});
test("rejects project paths that escape the repository or target Git metadata", () => {
  for (const filename of ["../Board.PrjPcb", "/Board.PrjPcb", "C:\\Board.PrjPcb", "C:Board.PrjPcb", "a/../Board.PrjPcb", ".git/Board.PrjPcb", "x|Silent=False.PrjPcb"]) {
    assert.throws(() => selectMigrationProjectFile([filename], "Board"), /Invalid PCB project path/);
  }
});
async function directory(t, prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith(prefix));
    await rm(root, { recursive: true, force: true });
  });
  return root;
}
test("validates a nested file against the clone root rather than its immediate parent", async (t) => {
  const root = await directory(t, "altium-project-layout-");
  await mkdir(path.join(root, ".git"));
  await mkdir(path.join(root, "iQ Bridge ZB"));
  const bytes = Buffer.from("[Design]\r\nManagedProjectGUID=\r\n[Document1]\r\nDocumentPath=Carte_Pool_Bridge.PcbDoc\r\n");
  await writeFile(path.join(root, nested), bytes);
  const result = await validateMigrationProjectPath(root, nested);
  assert.equal(result.workingCopyPath, root);
  assert.equal(result.projectFullPath, path.join(root, nested));
  assert.equal(result.projectRelativePath, nested);
  assert.equal(result.nestedProject, true);
  assert.deepEqual(await readFile(result.projectFullPath), bytes);
});
test("refuses linked project folders instead of writing outside the migration copy", async (t) => {
  const root = await directory(t, "altium-project-linked-");
  const copy = path.join(root, "copy"), external = path.join(root, "external");
  await mkdir(path.join(copy, ".git"), { recursive: true });
  await mkdir(external);
  await writeFile(path.join(external, "Board.PrjPcb"), "unchanged");
  await symlink(external, path.join(copy, "linked"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(validateMigrationProjectPath(copy, "linked/Board.PrjPcb"), /linked files or directories/);
  assert.equal(await readFile(path.join(external, "Board.PrjPcb"), "utf8"), "unchanged");
});
test("nested project preparation preserves repository history, document paths and all original files", async (t) => {
  const root = await directory(t, "altium-project-nested-git-");
  const original = path.join(root, "original"), mirror = path.join(root, "source.git"), origin = path.join(root, "temporary-origin.git"), copy = path.join(root, "working-copy");
  const git = async (args) => (await run("git", args, { windowsHide: true })).stdout.trim();
  await mkdir(path.join(original, "iQ Bridge ZB"), { recursive: true });
  const project = Buffer.from("[Design]\r\nManagedProjectGUID=source-guid\r\n[Document1]\r\nDocumentPath=Carte_Pool_Bridge.PcbDoc\r\n");
  const cad = Buffer.from([0, 1, 255, 128, 4, 0]);
  await writeFile(path.join(original, nested), project);
  await writeFile(path.join(original, "iQ Bridge ZB/Carte_Pool_Bridge.PcbDoc"), cad);
  await writeFile(path.join(original, "root-document.txt"), "Keep repository-root files too.");
  await git(["init", "--initial-branch=master", original]);
  await git(["-C", original, "add", "."]);
  const identity = ["-c", "user.name=Migration test", "-c", "user.email=test@localhost"];
  await git(["-C", original, ...identity, "commit", "-m", "Original history"]);
  const sourceHead = await git(["-C", original, "rev-parse", "HEAD"]);
  await git(["clone", "--mirror", original, mirror]);
  await git(["clone", "--bare", mirror, origin]);
  await git(["clone", origin, copy]);
  const files = (await git(["-C", copy, "ls-files", "-z"])).split("\0").filter(Boolean);
  const filename = selectMigrationProjectFile(files, "iQ Bridge Zigbee");
  const layout = await validateMigrationProjectPath(copy, filename);
  await writeFile(layout.projectFullPath, detachManagedProject(await readFile(layout.projectFullPath)));
  await git(["-C", copy, "add", "--", filename]);
  await git(["-C", copy, ...identity, "commit", "-m", "Detach migration copy"]);
  await git(["-C", copy, "push", "origin", "HEAD"]);
  await git(["-C", copy, "merge-base", "--is-ancestor", sourceHead, "HEAD"]);
  assert.equal(await git(["-C", original, "rev-parse", "HEAD"]), sourceHead);
  assert.deepEqual(await readFile(path.join(copy, "iQ Bridge ZB/Carte_Pool_Bridge.PcbDoc")), cad);
  assert.deepEqual(await readFile(path.join(original, nested)), project);
  assert.equal(managedProjectGuid(await readFile(layout.projectFullPath)), "");
  assert.deepEqual((await git(["-C", copy, "ls-files", "-z"])).split("\0").filter(Boolean), files);
});
test("the native bridge validates nested paths and repository boundaries using the same C# helper", { skip: process.platform !== "win32" }, async (t) => {
  const root = await directory(t, "altium-project-native-paths-");
  const source = fileURLToPath(new URL("../altium-extension/Fluidra.DxpBridge/Source Code/ProjectMigrationPaths.cs", import.meta.url));
  const harness = fileURLToPath(new URL("fixtures/ProjectMigrationPathsTests.cs", import.meta.url));
  const executable = path.join(root, "paths.exe");
  await run("C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe", ["/nologo", `/out:${executable}`, source, harness], { windowsHide: true });
  const result = JSON.parse((await run(executable, [root], { windowsHide: true })).stdout);
  assert.equal(result.checks, 7);
});
