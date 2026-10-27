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
  const result = await run(process.execPath, [fileURLToPath(new URL("fixtures/project-api-worker.mjs", import.meta.url)), name, root], { windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 });
  const data = JSON.parse(result.stdout.trim()); assert.equal(data.sourceUnchanged, true); return data;
}
describe("isolated HTTP/Git project workflow", { concurrency: 3 }, () => {
for (const name of ["root", "nested", "log-unavailable", "concurrent", "harness", "harness-nested", "harness-wiring-only", "system", "system-nested", "system-verified-child", "system-nested-verified-child"]) test(`HTTP project migration preserves real Git history, Unicode CAD files and target identity: ${name}`, async (t) => {
  const result = await scenario(t, name);
  assert.equal(result.preflight.body.executable, true);
  assert.equal(result.first.status, 200, result.first.body.error);
  assert.equal(result.first.body.status, "migrated");
  assert.equal(result.publishCalls, 1); assert.equal(result.nativeCalls, 1);
  assert.equal(result.integrity.sourceHistoryPreserved, true); assert.equal(result.integrity.cadBlobsPreserved, true);
  if (name === "log-unavailable") assert.match(result.first.body.logWarning, /log/i);
  if (name === "concurrent") assert.equal(result.second.status, 409);
  if (name.endsWith("verified-child")) { assert.equal(result.integrity.childLinksVerified,true); assert.equal(result.integrity.childUnchanged,true); }
});
for (const name of ["system-missing-child", "system-foreign-child", "system-stale-child"]) test(`multiboard publication is blocked before any native command: ${name}`,async(t)=>{
  const result=await scenario(t,name);assert.equal(result.preflight.body.executable,false);assert.equal(result.publishCalls,0);assert.equal(result.nativeCalls,0);assert.equal(result.first.status,409);
  assert.equal(result.preflight.body.dependencies.children.length,1);assert.notEqual(result.preflight.body.dependencies.children[0].status,"ready");
});
for (const name of ["cloud-pending", "harness-cloud-pending"]) test(`a cloud delay is pending and read-only validation completes the same target: ${name}`, async (t) => {
  const result = await scenario(t, name);
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
for (const name of ["lost-publication-response", "harness-lost-response"]) test(`a lost publication response with delayed listing cannot create a second target: ${name}`, async (t) => {
  const result = await scenario(t, name);
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
for (const name of ["missing-document", "harness-missing-document"]) test(`a missing linked CAD document is rejected before publication: ${name}`, async (t) => {
  const result = await scenario(t, name);
  assert.equal(result.publishCalls, 0);
  assert.notEqual(result.first.status, 200);
  assert.match(result.first.body.error, /document|missing|file/i);
});
test("an old bridge is rejected before native harness publication",async(t)=>{
  const result=await scenario(t,"harness-unsupported-bridge");assert.equal(result.preflight.body.executable,false);assert.equal(result.publishCalls,0);assert.match(result.preflight.body.blockers.join(" "),/bridge 1.1.38/);
});
test("a published project with the wrong native kind is retained for inspection and never reported migrated",async(t)=>{
  const result=await scenario(t,"harness-wrong-target-type");assert.equal(result.publishCalls,1);assert.equal(result.nativeCalls,0);assert.notEqual(result.first.status,200);assert.match(result.first.body.error,/project type differs/);
});
});
