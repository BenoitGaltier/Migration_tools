import path from "node:path";
import { projectChildProjects, projectText, projectTypeForFile } from "./project-types.mjs";
import { readProjectArchive, rewriteProjectArchive } from "./project-archive.mjs";
const normalize = (guid) => String(guid || "").replace(/[{}]/g, "").toLowerCase();
const slashes = (filename) => String(filename).replaceAll("\\", "/");
function checkedMappings(mappings) {
  const result = new Map(), targetIds = new Set();
  for (const mapping of mappings) {
    const source = normalize(mapping.sourceGuid), target = normalize(mapping.targetGuid);
    if (!mapping.verified || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(source) || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(target) || source === target) throw new Error("A verified source/target child GUID mapping is required.");
    if (result.has(source)) throw new Error("Duplicate child mapping.");
    if (targetIds.has(target)) throw new Error("Two source children cannot share one target mapping.");
    if (!mapping.sourceProjectFilename || !mapping.targetProjectFilename || !mapping.files?.includes(mapping.targetProjectFilename)) throw new Error("Incomplete verified child project file mapping.");
    if (!mapping.targetName || projectTypeForFile(mapping.sourceProjectFilename) !== mapping.projectType || projectTypeForFile(mapping.targetProjectFilename) !== mapping.projectType) throw new Error("Child mapping has an inconsistent project type or name.");
    targetIds.add(target);
    result.set(source, mapping);
  }
  return result;
}
function mappedPath(sourcePath, mapping) {
  const sourceDirectory = path.posix.dirname(slashes(mapping.sourceProjectFilename));
  const root = path.posix.join(path.posix.dirname(slashes(sourcePath)), path.posix.relative(sourceDirectory, "."));
  return path.posix.join(root, slashes(mapping.targetProjectFilename));
}
export function multiboardModules(bytes) {
  const logical = readProjectArchive(bytes).get("logical.json");
  if (!logical) throw new Error("Multiboard schematic has no supported logical.json stream.");
  const data = JSON.parse(logical.toString("utf8"));
  if (!Array.isArray(data.modules)) throw new Error("Multiboard schematic has no module list.");
  return data.modules;
}
export function reconnectMultiboard(bytes, projectBytes, mappings) {
  const targets = checkedMappings(mappings), declared = new Set(projectChildProjects(projectBytes).map((child) => normalize(child.projectGuid)));
  const streams = readProjectArchive(bytes), logical = JSON.parse(streams.get("logical.json")?.toString("utf8") || "null");
  if (!Array.isArray(logical?.modules)) throw new Error("Multiboard schematic has no supported module list.");
  let changed = false;
  for (const module of logical.modules) {
    const source = module.source; if (!source?.sourceProject && !source?.projectGuid) continue;
    const guid = normalize(source.projectGuid), target = targets.get(guid);
    if (!declared.has(guid) || !target || source.sourceType !== 1) throw new Error(`Multiboard module ${module.designator || module.id} has no declared, verified source mapping.`);
    if (source.revisionGuid) throw new Error("A pinned child revision cannot be silently replaced with another workspace revision.");
    const sourceProject = slashes(source.sourceProject), board = slashes(source.boardFileName || "");
    if (board) {
      const relative = path.posix.normalize(path.posix.join(path.posix.dirname(slashes(target.sourceProjectFilename)), path.posix.relative(path.posix.dirname(sourceProject), board)));
      if (relative.startsWith("../") || !target.files.some((file) => slashes(file).toLowerCase() === relative.toLowerCase())) throw new Error(`Verified target child is missing board ${board}.`);
    }
    source.projectGuid = target.targetGuid;
    source.sourceProject = mappedPath(sourceProject, target);
    source.projectName = target.targetName;
    changed = true;
  }
  function verifyReferences(value) {
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (/project.*(?:guid|id|uri|url)/i.test(key) && typeof item === "string" && [...declared].some((guid) => item.toLowerCase().includes(guid))) throw new Error("An unsupported child project reference remains in the multiboard schematic. No project was published.");
      verifyReferences(item);
    }
  }
  verifyReferences(logical);
  return changed ? rewriteProjectArchive(bytes, new Map([["logical.json", Buffer.from(JSON.stringify(logical, null, 2))]])) : Buffer.from(bytes);
}
export function reconnectChildBindings(bytes, mappings) {
  const targets = checkedMappings(mappings), children = new Map(projectChildProjects(bytes).map((child) => [child.section.toLowerCase(), child]));
  const decoded = projectText(bytes); let section = "";
  const text = decoded.text.replace(/[^\r\n]+/g, (line) => {
    const header = line.trim().match(/^\[([^\]]+)\]$/); if (header) { section = header[1].toLowerCase(); return line; }
    const child = children.get(section); if (!child) return line;
    const target = targets.get(normalize(child.projectGuid)); if (!target) throw new Error("Missing verified child mapping.");
    if (/^\s*DocumentPath\s*=/i.test(line)) return line.replace(/=.*/, "=" + mappedPath(child.path, target));
    if (/^\s*ManagedProjectGUID\s*=/i.test(line)) return line.replace(/=.*/, "=" + target.targetGuid);
    return line;
  });
  return Buffer.from(text, decoded.encoding);
}
