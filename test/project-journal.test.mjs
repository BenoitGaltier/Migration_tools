import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { saveProjectJournal } from "../lib/project-journal.mjs";
test("atomic provenance survives a transient Windows lock without repeating the operation", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "altium-journal-")); t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "record.json"); await writeFile(file, JSON.stringify({ phase: "prepared" }));
  let attempts = 0, waits = 0;
  await saveProjectJournal(file, { phase: "publication-in-flight" }, { replace: async (...args) => { if (++attempts < 3) throw Object.assign(new Error("locked"), { code: "EPERM" }); await rename(...args); }, wait: async () => waits++ });
  assert.equal(attempts, 3); assert.equal(waits, 2); assert.equal(JSON.parse(await readFile(file)).phase, "publication-in-flight");
  await assert.rejects(saveProjectJournal(file, { phase: "unsafe" }, { replace: async () => { throw Object.assign(new Error("disk error"), { code: "EIO" }); } }), /disk error/);
  assert.equal(JSON.parse(await readFile(file)).phase, "publication-in-flight"); assert.deepEqual(await readdir(root), ["record.json"]);
});
