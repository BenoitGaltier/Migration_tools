// Read-only full-history and binary-file comparison of the selected reference projects.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gitTreeEntries, assertProjectDocuments, assertSourceFilesPreserved } from "../lib/project-integrity.mjs";
import { selectPublishedProjectFile } from "../lib/project-paths.mjs";
const run = promisify(execFile), root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (!process.argv.includes("--env-file")) throw new Error("Pass the existing local --env-file.");
const envFile = process.argv[process.argv.indexOf("--env-file") + 1];
const env = Object.fromEntries((await readFile(envFile, "utf8")).split(/\r?\n/).filter((line) => line.includes("=") && !line.startsWith("#")).map((line) => { const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1).trim().replace(/^['"]|['"]$/g, "")]; }));
const source = JSON.parse(env.ALTIUM_SOURCE_WORKSPACES_JSON).find((w) => /^ZPCE$/i.test(w.id || w.name));
const target = JSON.parse(env.ALTIUM_TARGET_WORKSPACE_JSON);
const inventory = JSON.parse(await readFile(path.join(root, ".diagnostics/project-stability-audit.json"), "utf8"));
const output = path.join(root, ".diagnostics/git-audit"); await mkdir(output, { recursive: true });
const rows = [];
async function git(args, token, binary = false) {
  return (await run("git", args, { windowsHide: true, timeout: 15 * 60000, maxBuffer: 32 * 1024 * 1024, encoding: binary ? "buffer" : "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.extraHeader", GIT_CONFIG_VALUE_0: "Authorization: Basic " + Buffer.from("token:" + token).toString("base64") } })).stdout;
}
async function clone(project, workspace, label) {
  const repo = path.join(output, project.projectId + "-" + label + ".git");
  try { await readFile(path.join(repo, "HEAD")); } catch { await git(["clone", "--mirror", project.repositoryUrl, repo], workspace.accessToken); }
  await git([`--git-dir=${repo}`, "fetch", "origin"], workspace.accessToken);
  const head = (await git([`--git-dir=${repo}`, "rev-parse", "HEAD"], workspace.accessToken)).trim();
  const entries = gitTreeEntries(await git([`--git-dir=${repo}`, "ls-tree", "-r", "-z", head], workspace.accessToken));
  const filename = await selectPublishedProjectFile(entries.map((e) => e.path), project.projectId, async (file) => git([`--git-dir=${repo}`, "show", head + ":" + file], workspace.accessToken, true));
  const bytes = await git([`--git-dir=${repo}`, "show", head + ":" + filename], workspace.accessToken, true);
  const documents = assertProjectDocuments(filename, bytes, entries);
  return { repo, head, entries, filename, documents, commits: Number((await git([`--git-dir=${repo}`, "rev-list", "--count", head], workspace.accessToken)).trim()) };
}
for (const reference of [...inventory.whitespace, { name: "IMU_TEST" }]) {
  const original = inventory.sourceProjects.find((p) => p.name.toLowerCase() === reference.name.toLowerCase());
  if (!original) { rows.push({ name: reference.name, error: "No exact source name found" }); continue; }
  try {
    console.log("Read-only Git audit: " + reference.name);
    const before = (await git(["ls-remote", original.repositoryUrl, "HEAD"], source.accessToken)).trim();
    const first = await clone(original, source, "source");
    const row = { name: reference.name, sourceGuid: original.projectId, sourceHead: first.head, sourceCommits: first.commits, projectFilename: first.filename, designDocuments: first.documents, sourceFiles: first.entries.length };
    if (reference.targetGuid) {
      const destination = inventory.targetProjects.find((p) => p.projectId.toLowerCase() === reference.targetGuid.toLowerCase());
      const second = await clone(destination, target, "target");
      await git([`--git-dir=${second.repo}`, "fetch", "--no-tags", first.repo, "+refs/heads/*:refs/audit-source/*"], target.accessToken);
      await git([`--git-dir=${second.repo}`, "merge-base", "--is-ancestor", first.head, second.head], target.accessToken);
      row.targetGuid = destination.projectId; row.targetHead = second.head; row.targetCommits = second.commits; row.historyPreserved = true;
      try { row.files = assertSourceFilesPreserved(first.entries, second.entries); } catch (error) { row.fileDifference = error.message; }
    }
    row.sourceUnchanged = before === (await git(["ls-remote", original.repositoryUrl, "HEAD"], source.accessToken)).trim();
    rows.push(row); console.log(JSON.stringify(row));
  } catch (error) { const message = String(error.stderr || error.message).replaceAll(source.accessToken, "[redacted]").replaceAll(target.accessToken, "[redacted]"); rows.push({ name: reference.name, error: message }); console.log(reference.name + ": audit requires inspection (see ignored report)"); }
  await writeFile(path.join(output, "report.json"), JSON.stringify({ checkedAt: new Date().toISOString(), readOnly: true, rows }, null, 2));
}
