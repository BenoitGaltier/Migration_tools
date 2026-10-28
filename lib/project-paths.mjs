import path from "node:path";
import { lstat } from "node:fs/promises";
import { managedProjectGuid } from "./project-designer.mjs";
import { projectKind, projectTypeForFile } from "./project-types.mjs";

function relativeProjectPath(filename, projectType = "PCB_PROJECT") {
  const kind = projectKind(projectType);
  const value = String(filename || "").replaceAll("\\", "/");
  if (!value || path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || /[:|\x00-\x1f]/.test(value)
      || value.split("/").some((segment) => !segment || segment === "." || segment === ".." || segment.toLowerCase() === ".git")
      || !value.toLowerCase().endsWith(kind.extension.toLowerCase())) {
    throw new Error(`Invalid ${kind.label} project path inside the migration working copy. No project was published.`);
  }
  return value;
}

export function selectMigrationProjectFile(files, projectName, savedFilename = null, projectType = "PCB_PROJECT") {
  const kind = projectKind(projectType);
  const candidates = [...new Set(files.filter((filename) => filename.toLowerCase().endsWith(kind.extension.toLowerCase())).map((file) => relativeProjectPath(file, projectType)))];
  if (savedFilename) {
    const saved = relativeProjectPath(savedFilename, projectType);
    if (!candidates.includes(saved)) throw new Error("The saved PCB project file is missing from the migration copy. Inspect the interrupted transfer before resuming.");
    return saved;
  }
  const matchingName = candidates.filter((filename) => path.posix.basename(filename, path.posix.extname(filename)).toLowerCase() === String(projectName).toLowerCase());
  if (matchingName.length === 1) return matchingName[0];
  if (candidates.length === 1) return candidates[0];
  throw new Error(candidates.length
    ? `Cannot uniquely identify the PCB project file. Candidates: ${candidates.join(", ")}. No project was published.`
    : `The migration repository contains no ${kind.label} project file (${kind.extension}). No project was published.`);
}

// Native VCS migration may move a nested .PrjPcb to the repository root.
// Identify its final path by the destination binding, never by its name alone.
export async function selectPublishedProjectFile(files, projectGuid, readProject, projectType = "PCB_PROJECT") {
  const kind = projectKind(projectType);
  const guid = String(projectGuid || "").replace(/[{}]/g, "").toLowerCase();
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(guid)) throw new Error("Invalid destination project GUID.");
  const matches = [];
  for (const filename of [...new Set(files.filter((file) => file.toLowerCase().endsWith(kind.extension.toLowerCase())).map((file) => relativeProjectPath(file, projectType)))]) {
    if (managedProjectGuid(await readProject(filename)).toLowerCase() === guid) matches.push(filename);
  }
  if (matches.length !== 1) throw new Error(`Expected exactly one ${kind.label} project bound to destination ${projectGuid}; found ${matches.length}. Inspect the existing transfer before resuming.`);
  return matches[0];
}

export async function validateMigrationProjectPath(workingCopy, filename) {
  const projectRelativePath = relativeProjectPath(filename, projectTypeForFile(filename));
  const workingCopyPath = path.resolve(workingCopy);
  const root = await lstat(workingCopyPath);
  const gitDirectory = await lstat(path.join(workingCopyPath, ".git"));
  if (!root.isDirectory() || root.isSymbolicLink() || !gitDirectory.isDirectory() || gitDirectory.isSymbolicLink()) {
    throw new Error("Expected a dedicated Git migration working copy without linked directories.");
  }
  let current = workingCopyPath;
  const segments = projectRelativePath.split("/");
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    const entry = await lstat(current);
    if (entry.isSymbolicLink() || (index < segments.length - 1 ? !entry.isDirectory() : !entry.isFile())) {
      throw new Error("The PCB project must stay inside the migration copy without linked files or directories.");
    }
  }
  return { workingCopyPath, projectFullPath: current, projectRelativePath, nestedProject: segments.length > 1 };
}

export function childMigrationWorkspace(workingCopy, tempRoot, relativeRoot, existingRoots = []) {
  const root = path.resolve(tempRoot), working = path.resolve(workingCopy);
  const child = path.resolve(working, relativeRoot);
  const within = (parent, candidate) => candidate.toLowerCase().startsWith(parent.toLowerCase() + path.sep);
  const first = path.relative(root, child).split(path.sep)[0].toLowerCase();
  const overlaps = [...existingRoots, working].some((other) => {
    const resolved = path.resolve(other);
    return child.toLowerCase() === resolved.toLowerCase() || within(resolved, child) || within(child, resolved);
  });
  if (!within(root, child) || overlaps
    || ["source.git", "temporary-origin.git", "working-copy", "child-origins"].includes(first)
    || first.startsWith("destination-audit-")) {
    throw new Error("Child workspace paths overlap or leave the dedicated migration directory. No project was published.");
  }
  return child;
}
