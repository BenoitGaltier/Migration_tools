import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { assertDesignerDestination, detachManagedProject, managedProjectGuid, verifyNativeProjectHistory, trySaveProjectMigrationLog, nativeVcsMigrationScript, nativeProjectDescription } from "../lib/project-designer.mjs";

test("native publication accepts a multiline project description without injecting Designer parameters", () => {
  const description = "Vortrax Keyboard project with :\r\n- ESP WROVER\n- ESP WROOM | Silent=False\0";
  assert.equal(nativeProjectDescription(description), "Vortrax Keyboard project with : - ESP WROVER - ESP WROOM Silent=False");
  assert.equal(nativeProjectDescription("Description µC"), "Description µC");
  assert.equal(nativeProjectDescription(null), "");
  assert.ok(description.includes("\n"), "The original source description is not modified.");
});

test("project flow never calls the undefined logMigration function", async () => {
  const source = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\blogMigration\s*\(/);
  assert.match(source, /trySaveProjectMigrationLog\(saveMigrationLog,/);
});

test("native VCS migration targets the already registered project, never creates a replacement", () => {
  const script = nativeVcsMigrationScript({ projectGuid: "22715855-62e1-46da-93bf-cdbec7c3cf6c", projectFullPath: "C:\\Bob's copy\\USB_TO_LIN.PrjPcb", evidencePath: "C:\\result.txt" });
  assert.match(script, /DM_ManagedProjectGUID/);
  assert.match(script, /DM_ProjectFullPath/);
  assert.match(script, /Bob''s copy/);
  assert.match(script, /WorkspaceManager:MigrateToInternalVCS/);
  assert.doesNotMatch(script, /ConvertToManagedObject|DisableOnlineSynchronization/);
  assert.ok(script.indexOf("DM_ManagedProjectGUID") < script.indexOf("RunProcess("));
  assert.throws(() => nativeVcsMigrationScript({ projectGuid: "invalid", projectFullPath: "x", evidencePath: "y" }), /GUID/);
});

test("logging uses the existing logger and never masks a migration failure", async () => {
  const original = { result: { status: "failed", error: "original publication failure" } };
  assert.equal(await trySaveProjectMigrationLog(async (kind, payload) => {
    assert.equal(kind, "projects"); assert.equal(payload, original);
  }, original), null);
  assert.match(await trySaveProjectMigrationLog(async () => { throw new Error("disk full"); }, original), /disk full/);
  assert.equal(original.result.error, "original publication failure");
});

const workspaceGuid = "b2f05cda-ce7f-41fa-bddc-5556ab20bfcc";
const status = { publishSupported: true, workspaceGuid, workspaceUrl: "https://destination.365.altium.com/vault", workspaceName: "Destination" };
test("native publication requires the exact destination and capability", () => {
  assert.equal(assertDesignerDestination(status, "https://destination.365.altium.com/api/graphql").workspaceGuid, workspaceGuid);
  assert.throws(() => assertDesignerDestination(status, "https://source.365.altium.com"), /not the destination/);
  assert.throws(() => assertDesignerDestination({}, status.workspaceUrl), /1.1.35/);
  assert.throws(() => assertDesignerDestination({ ...status, workspaceGuid: "-".repeat(36) }, status.workspaceUrl), /identifier/);
});

for (const encoding of ["latin1", "utf8", "utf16le"]) {
  test(`detach only the current project identity; preserve ${encoding} and other bindings`, () => {
    const bom = encoding === "latin1" ? "" : "\uFEFF";
    const original = `${bom}[Design]\r\nManagedProjectGUID=old-guid\r\nVaultGUID=source-vault\r\nDescription=é\r\n[ManagedOutputJobs1]\r\nManagedProjectGUID=keep-this\r\n`;
    const result = detachManagedProject(Buffer.from(original, encoding));
    assert.deepEqual(result, Buffer.from(original.replace("ManagedProjectGUID=old-guid", "ManagedProjectGUID="), encoding));
    assert.equal(managedProjectGuid(result), "");
    assert.equal(managedProjectGuid(Buffer.from(original.replace("old-guid", `{${workspaceGuid}}`), encoding)), workspaceGuid);
  });
}
test("ambiguous or unsupported project data is rejected", () => {
  assert.throws(() => detachManagedProject(Buffer.from("[Design]\nVaultGUID=x")), /does not contain/);
  assert.throws(() => detachManagedProject(Buffer.from("[Design]\nManagedProjectGUID=x\nManagedProjectGUID=y")), /duplicate/);
  assert.throws(() => detachManagedProject(Buffer.from([0xfe, 0xff, 0, 65])), /Big-endian/);
});

test("accept a native binding commit only when it descends from original commits", async () => {
  const input = { sourceOutput: "old refs/heads/master\ntag refs/tags/v1", targetOutput: "new refs/heads/master\ntag refs/tags/v1" };
  let checked = false;
  assert.equal((await verifyNativeProjectHistory({ ...input, isAncestor: async (source, target) => {
    assert.equal(source, "old"); assert.equal(target, "new"); checked = true; return true;
  } })).verified, true);
  assert.equal(checked, true);
  await assert.rejects(verifyNativeProjectHistory({ ...input, isAncestor: async () => false }), /not preserved/);
  await assert.rejects(verifyNativeProjectHistory({ ...input, targetOutput: "new refs/heads/master\nother refs/tags/v1", isAncestor: async () => true }), /not preserved/);
  await assert.rejects(verifyNativeProjectHistory({ ...input, targetOutput: "old refs/heads/master", isAncestor: async () => true }), /missing/);
});
