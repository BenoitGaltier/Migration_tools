import path from "node:path";
import { lstat } from "node:fs/promises";
import { managedProjectGuid } from "./project-designer.mjs";

function relativeProjectPath(filename) {
  const value = String(filename || "").replaceAll("\\", "/");
  if (!value || path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || /[:|\x00-\x1f]/.test(value)
      || value.split("/").some((segment) => !segment || segment === "." || segment === ".." || segment.toLowerCase() === ".git")
      || !/\.PrjPcb$/i.test(value)) {
    throw new Error("Invalid PCB project path inside the migration working copy. No project was published.");
  }
  return value;
}

export function selectMigrationProjectFile(files, projectName, savedFilename = null) {
  const candidates = [...new Set(files.filter((filename) => /\.PrjPcb$/i.test(filename)).map(relativeProjectPath))];
  if (savedFilename) {
    const saved = relativeProjectPath(savedFilename);
    if (!candidates.includes(saved)) throw new Error("The saved PCB project file is missing from the migration copy. Inspect the interrupted transfer before resuming.");
    return saved;
  }
  const matchingName = candidates.filter((filename) => path.posix.basename(filename, path.posix.extname(filename)).toLowerCase() === String(projectName).toLowerCase());
  if (matchingName.length === 1) return matchingName[0];
  if (candidates.length === 1) return candidates[0];
  throw new Error(candidates.length
    ? `Cannot uniquely identify the PCB project file. Candidates: ${candidates.join(", ")}. No project was published.`
    : "The migration repository contains no PCB project file (.PrjPcb). No project was published.");
}

// Native VCS migration may move a nested .PrjPcb to the repository root.
// Identify its final path by the destination binding, never by its name alone.
export async function selectPublishedProjectFile(files, projectGuid, readProject) {
  const guid = String(projectGuid || "").replace(/[{}]/g, "").toLowerCase();
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(guid)) throw new Error("Invalid destination project GUID.");
  const matches = [];
  for (const filename of [...new Set(files.filter((file) => /\.PrjPcb$/i.test(file)).map(relativeProjectPath))]) {
    if (managedProjectGuid(await readProject(filename)).toLowerCase() === guid) matches.push(filename);
  }
  if (matches.length !== 1) throw new Error(`Expected exactly one PCB project bound to destination ${projectGuid}; found ${matches.length}. Inspect the existing transfer before resuming.`);
  return matches[0];
}

export async function validateMigrationProjectPath(workingCopy, filename) {
  const projectRelativePath = relativeProjectPath(filename);
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
