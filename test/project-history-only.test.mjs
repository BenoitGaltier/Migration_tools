import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("project metadata keeps the release count without requesting any release downloads", async () => {
  const config = JSON.parse(await readFile(new URL("../config/operations.json", import.meta.url), "utf8"));
  assert.match(config.queries.projectDetails.query, /releases\(first: 1\) \{ totalCount \}/);
  assert.doesNotMatch(config.queries.projectDetails.query, /downloadUrl|manufacturePackages|pcbAssembly|pcbFabrication/);
});

test("project migration preserves source releases without downloading or creating an archive branch", async () => {
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const transfer = server.slice(server.indexOf("async function migrateProjectWithHistory("), server.indexOf("function selectLatestAllowedRevisions("));
  assert.doesNotMatch(transfer, /downloadProjectReleaseFiles|altium-migrated-releases|release-worktree/);
  assert.match(transfer, /releaseStrategy: "source-workspace"/);
  assert.match(transfer, /verifyDesignerProjectHistory\(/);
  assert.match(transfer, /verifyTargetProjectPlacement\(/);
});
