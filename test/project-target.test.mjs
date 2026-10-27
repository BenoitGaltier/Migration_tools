import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assertEmptyProjectTarget, assertProjectTargetUnchanged, emptyTargetDefaultBranchAlias, guardedProjectMirrorArgs } from "../lib/project-target.mjs";
import { assertMirroredProjectRefs } from "../lib/project-api.mjs";

test("accepts a new empty repository or its single blank project stub", () => {
  assert.equal(assertEmptyProjectTarget({ refsOutput: "", commitCount: 0, files: [] }).empty, true);
  assert.equal(assertEmptyProjectTarget({ refsOutput: "abc HEAD\nabc refs/heads/main", commitCount: 1,
    files: [{ path: "empty.PrjPcb", bytes: Buffer.from("[Design]\r\nVersion=1.0\r\n") }] }).empty, true);
});

test("refuses real documents, project document links, tags, extra refs and existing history", () => {
  const baseline = { refsOutput: "abc refs/heads/main", commitCount: 1, files: [] };
  for (const override of [
    { commitCount: 2 }, { commitCount: NaN },
    { refsOutput: "abc refs/heads/main\nabc refs/tags/v1" },
    { refsOutput: "abc refs/heads/main\nabc refs/notes/review" },
    { files: [{ path: "board.SchDoc", bytes: Buffer.from("data") }] },
    { files: [{ path: "board.PrjPcb", bytes: Buffer.from("[Design]\nVersion=1.0\n[Document1]\nDocumentPath=board.SchDoc") }] }
  ]) assert.throws(() => assertEmptyProjectTarget({ ...baseline, ...override }));
  assert.throws(() => assertProjectTargetUnchanged("abc refs/heads/main", "changed refs/heads/main"), /changed/);
});

test("keeps the blank target's default branch usable when the source uses a different branch name", () => {
  assert.deepEqual(emptyTargetDefaultBranchAlias("source refs/heads/master", "stub refs/heads/main", "source\n"),
    { name: "refs/heads/main", sha: "source" });
  assert.equal(emptyTargetDefaultBranchAlias("source refs/heads/master", "stub refs/heads/master", "source"), null);
});

test("mirror preserves history and tags, and a lease refuses a concurrently changed destination", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "fluidra-project-mirror-test-"));
  const source = path.join(root, "source");
  const target = path.join(root, "target.git");
  const exec = promisify(execFile);
  const git = (args) => exec("git", args, { windowsHide: true });
  try {
    await git(["init", "-b", "master", source]);
    await git(["init", "--bare", target]);
    await writeFile(path.join(source, "board.SchDoc"), "revision1");
    await git(["-C", source, "add", "."]);
    const commit = (message) => git(["-C", source, "-c", "user.name=Migration Test", "-c", "user.email=test@example.invalid", "commit", "-am", message]);
    await commit("First revision");
    const first = (await git(["-C", source, "rev-parse", "HEAD"])).stdout.trim();
    await git(["-C", source, "tag", "v1"]);
    await writeFile(path.join(source, "board.SchDoc"), "revision2");
    await commit("Second revision");
    const sourceRefs = (await git(["-C", source, "for-each-ref", "--format=%(objectname) %(refname)"])).stdout;
    await git(["-C", source, ...guardedProjectMirrorArgs(target, sourceRefs, "")]);
    const targetRefs = (await git(["ls-remote", target])).stdout;
    assert.equal(assertMirroredProjectRefs(sourceRefs, targetRefs).verified, true);
    await git([`--git-dir=${target}`, "update-ref", "refs/heads/master", first]);
    await assert.rejects(git(["-C", source, ...guardedProjectMirrorArgs(target, sourceRefs, targetRefs)]));
    assert.equal((await git([`--git-dir=${target}`, "rev-parse", "refs/heads/master"])).stdout.trim(), first);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reuses a blank main-branch project while preserving the source master branch and default HEAD", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "fluidra-project-stub-test-"));
  const source = path.join(root, "source");
  const stub = path.join(root, "stub");
  const target = path.join(root, "target.git");
  const exec = promisify(execFile);
  const git = (args) => exec("git", args, { windowsHide: true });
  const commit = (repo, message) => git(["-C", repo, "-c", "user.name=Migration Test", "-c", "user.email=test@example.invalid", "commit", "-am", message]);
  try {
    await git(["init", "-b", "master", source]);
    await writeFile(path.join(source, "board.SchDoc"), "source CAD");
    await git(["-C", source, "add", "."]);
    await commit(source, "Source design");
    await git(["init", "--bare", "-b", "main", target]);
    await git(["init", "-b", "main", stub]);
    await writeFile(path.join(stub, "empty.PrjPcb"), "[Design]\nVersion=1.0\n");
    await git(["-C", stub, "add", "."]);
    await commit(stub, "Blank project");
    await git(["-C", stub, "push", target, "main"]);
    const expected = (await git(["ls-remote", target])).stdout;
    const head = (await git(["-C", source, "rev-parse", "HEAD"])).stdout.trim();
    let sourceRefs = (await git(["-C", source, "for-each-ref", "--format=%(objectname) %(refname)"])).stdout;
    const alias = emptyTargetDefaultBranchAlias(sourceRefs, expected, head);
    await git(["-C", source, "update-ref", alias.name, alias.sha]);
    sourceRefs = (await git(["-C", source, "for-each-ref", "--format=%(objectname) %(refname)"])).stdout;
    await git(["-C", source, ...guardedProjectMirrorArgs(target, sourceRefs, expected)]);
    assert.equal((await git([`--git-dir=${target}`, "rev-parse", "HEAD"])).stdout.trim(), head);
    assert.equal((await git([`--git-dir=${target}`, "rev-parse", "refs/heads/master"])).stdout.trim(), head);
    assert.equal(assertMirroredProjectRefs(sourceRefs, (await git(["ls-remote", target])).stdout).verified, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
