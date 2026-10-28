import path from "node:path";
import { projectDesignDocuments } from "./project-cloud.mjs";
import { projectTypeForFile } from "./project-types.mjs";

export function gitTreeEntries(output) {
  return String(output).split("\0").filter(Boolean).map((entry) => {
    const match = entry.match(/^(\d+) (\w+) ([0-9a-f]+)\t([\s\S]+)$/);
    if (!match) throw new Error("Invalid Git file manifest.");
    return { mode: match[1], type: match[2], oid: match[3], path: match[4] };
  });
}

export function assertProjectDocuments(projectFilename, bytes, entries) {
  const paths = new Map();
  for (const entry of entries) {
    const key = entry.path.toLowerCase();
    if (paths.has(key)) throw new Error(`Files collide on Windows: ${entry.path}`);
    if (entry.mode === "120000" || entry.type !== "blob") throw new Error(`Linked file or submodule requires inspection before publication: ${entry.path}`);
    paths.set(key, entry);
  }
  const required = projectDesignDocuments(bytes, projectTypeForFile(projectFilename));
  for (const document of required) {
    const value = document.replaceAll("\\", "/");
    const filename = path.posix.normalize(path.posix.join(path.posix.dirname(projectFilename), value));
    if (path.win32.isAbsolute(value) || path.posix.isAbsolute(value) || filename.startsWith("../") || !paths.has(filename.toLowerCase())) {
      throw new Error(`Missing or external project document: ${document}. No project was published.`);
    }
  }
  return required;
}

export function assertSourceFilesPreserved(source, target, { sourceProjectFilename = null, transformations = [] } = {}) {
  const destination = new Map(target.map((entry) => [entry.path.toLowerCase(), entry]));
  const files = source.filter((entry) => sourceProjectFilename ? ![sourceProjectFilename.toLowerCase(), (sourceProjectFilename + "Structure").toLowerCase()].includes(entry.path.toLowerCase())
    : !/\.Prj(?:Pcb|Har|Mbd)(?:Structure)?$/i.test(entry.path));
  const allowed = new Map(transformations.map((change) => [change.path.toLowerCase(), change])); let transformed = 0;
  for (const entry of files) {
    const match = destination.get(entry.path.toLowerCase());
    const change = allowed.get(entry.path.toLowerCase());
    if (change && match && /\.MbsDoc$/i.test(entry.path) && change.purpose === "verified-global-child-links" && change.sourceOid === entry.oid && change.targetOid === match.oid && entry.mode === match.mode) { transformed++; continue; }
    if (!match || match.oid !== entry.oid || match.mode !== entry.mode) throw new Error(`Original project file missing or modified at destination: ${entry.path}. Inspect the existing target.`);
  }
  if (transformed !== transformations.length) throw new Error("A planned multiboard transformation was not verified against the published Git blobs.");
  return { verified: true, files: files.length - transformed, transformedFiles: transformed, method: transformed ? "git-blobs-and-verified-multiboard-links" : "git-blob-and-mode-identity" };
}
