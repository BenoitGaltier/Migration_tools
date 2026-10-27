import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test, { describe } from "node:test";
const run = promisify(execFile);
async function scenario(t, name) {
  const root = await mkdtemp(path.join(os.tmpdir(), "altium workflow spaces-"));
  t.after(async () => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith("altium workflow spaces-")); await rm(root, { recursive: true, force: true }); });
  const result = await run(process.execPath, [fileURLToPath(new URL("fixtures/project-api-worker.mjs", import.meta.url)), name, root], { windowsHide: true, timeout: 90000, maxBuffer: 1024 * 1024 });
  const data = JSON.parse(result.stdout.trim()); assert.equal(data.sourceUnchanged, true); return data;
}
describe("isolated HTTP/Git project workflow", { concurrency: 3 }, () => {
for (const name of ["root", "nested", "log-unavailable", "concurrent"]) test(`HTTP project migration preserves real Git history, Unicode CAD files and target identity: ${name}`, async (t) => {
  const result = await scenario(t, name);
  assert.equal(result.preflight.body.executable, true);
  assert.equal(result.first.status, 200, result.first.body.error);
  assert.equal(result.first.body.status, "migrated");
  assert.equal(result.publishCalls, 1); assert.equal(result.nativeCalls, 1);
  assert.equal(result.integrity.sourceHistoryPreserved, true); assert.equal(result.integrity.cadBlobsPreserved, true);
  if (name === "log-unavailable") assert.match(result.first.body.logWarning, /log/i);
  if (name === "concurrent") assert.equal(result.second.status, 409);
});
test("a cloud delay is reported as pending; read-only validation completes the same target without another native command", async (t) => {
  const result = await scenario(t, "cloud-pending");
  assert.equal(result.first.status, 200, result.first.body.error);
  assert.equal(result.first.body.status, "awaiting-cloud");
  assert.equal(result.second.status, 200, result.second.body.error);
  assert.equal(result.second.body.status, "migrated");
  assert.equal(result.publishCalls, 1); assert.equal(result.nativeCalls, 1);
});
test("working White Space-style data with an unavailable legacy generation marker is not reported as a failed transfer", async (t) => {
  const result = await scenario(t, "legacy-status");
  assert.equal(result.first.status, 200, result.first.body.error);
  assert.equal(result.first.body.status, "awaiting-cloud");
  assert.equal(result.first.body.cloudVerification.available, true);
  assert.equal(result.first.body.historyVerification.verified, true);
});
test("a lost publication response with a delayed project listing cannot create a second target", async (t) => {
  const result = await scenario(t, "lost-publication-response");
  assert.notEqual(result.first.status, 200);
  assert.equal(result.publishCalls, 1, "Do not republish when the first response was lost");
  assert.equal(result.second.status, 200, result.second.body.error);
  assert.equal(result.second.body.status, "migrated");
});
test("a same-named catalog collision is detected before any project publication", async (t) => {
  const result = await scenario(t, "catalog-collision");
  assert.equal(result.preflight.body.executable, false);
  assert.match(result.preflight.body.blockers.join(" "), /catalog|folder/i);
  assert.equal(result.publishCalls, 0);
});
test("a missing linked CAD document is rejected before the native publication command", async (t) => {
  const result = await scenario(t, "missing-document");
  assert.equal(result.publishCalls, 0);
  assert.notEqual(result.first.status, 200);
  assert.match(result.first.body.error, /document|missing|file/i);
});
});
