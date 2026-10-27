import path from "node:path";
import { projectChildProjects } from "./project-types.mjs";
import { multiboardModules, reconnectMultiboard, reconnectChildBindings } from "./project-dependencies.mjs";
import { projectDesignDocuments } from "./project-cloud.mjs";
const id = (value) => String(value || "").replace(/[{}]/g, "").toLowerCase();
const relative = (value) => String(value).replaceAll("\\", "/");

// IO adapters must verify current target history, native placement and cloud
// receipts. Names are display data and are never used to establish a mapping.
export async function analyzeMultiboardDependencies({ project, snapshot, listSources, readTransfer, getTarget, loadTarget, verifyTarget }) {
  const children = projectChildProjects(snapshot.bytes), declared = new Map();
  for (const child of children) {
    if (id(child.projectGuid) === id(project.projectId)) throw new Error("Cyclic multiboard child reference to the parent project.");
    const previous = declared.get(id(child.projectGuid));
    if (previous && relative(previous.path) !== relative(child.path)) throw new Error("One child GUID has ambiguous local project paths.");
    declared.set(id(child.projectGuid), child);
  }
  const schematics = [];
  for (const filename of projectDesignDocuments(snapshot.bytes, "SYSTEM_DESIGN").filter((name) => /\.MbsDoc$/i.test(name))) {
    const file = path.posix.normalize(path.posix.join(path.posix.dirname(snapshot.filename), relative(filename))), bytes = await snapshot.readFile(file);
    for (const module of multiboardModules(bytes)) {
      if (!module.source?.sourceProject && !module.source?.projectGuid) continue;
      const child = declared.get(id(module.source.projectGuid));
      if (!child || module.source.sourceType !== 1) throw new Error(`Module ${module.designator || module.id} has no declared managed child project.`);
      const modulePath = path.posix.normalize(path.posix.join(path.posix.dirname(file), relative(module.source.sourceProject)));
      const projectPath = path.posix.normalize(path.posix.join(path.posix.dirname(snapshot.filename), relative(child.path)));
      if (modulePath.toLowerCase() !== projectPath.toLowerCase()) throw new Error("Multiboard module path differs from its declared child project path.");
      if (module.source.revisionGuid) throw new Error("A pinned child revision cannot be silently reconnected to another workspace revision.");
    }
    schematics.push({ file, bytes });
  }
  const sources = declared.size ? await listSources() : [], rows = [], mappings = [];
  for (const child of declared.values()) {
    const source = sources.find((candidate) => id(candidate.projectId) === id(child.projectGuid));
    const row = { name: source?.name || path.posix.basename(relative(child.path)), sourceGuid: child.projectGuid, targetGuid: null, status: "pending-migration", message: "Migrate and verify this child project in the destination workspace first." };
    rows.push(row);
    try {
      if (!source || source.projectType !== child.projectType) throw new Error("The source child project identity/type could not be verified.");
      const record = await readTransfer(source.id);
      if (!record) continue;
      if (record.sourceProjectId !== source.id || record.phase !== "completed" || !record.historyVerification?.verified || !record.sourceHead || !record.targetProjectGuid || !record.targetProjectId) throw new Error("The child has no completed, verified transfer provenance.");
      const target = await getTarget(record.targetProjectId);
      if (id(target.projectId) !== id(record.targetProjectGuid) || target.projectType !== source.projectType) throw new Error("Destination child identity/type differs from its migration record.");
      const current = await loadTarget(target);
      if (!await verifyTarget({ source, target, snapshot: current, record })) throw new Error("Current child history, placement or generated design could not be verified.");
      const mapping = { verified: true, sourceGuid: source.projectId, targetGuid: target.projectId, projectType: source.projectType,
        targetName: target.name, sourceProjectFilename: record.sourceProjectFilename || record.projectFilename,
        targetProjectFilename: current.filename, targetHead: current.head, targetId: target.id, repositoryUrl: target.repositoryUrl,
        mirrorPath: current.mirrorPath, files: current.entries.map((entry) => entry.path), sourceReference: child.path };
      row.targetGuid = target.projectId; row.targetName = target.name; row.status = "ready"; row.message = "Current destination child verified by GUID and Git history.";
      mappings.push(mapping);
    } catch (error) { row.status = "blocked"; row.message = error.message; }
  }
  const ready = rows.every((row) => row.status === "ready"), changes = [];
  if (ready) {
    for (const schematic of schematics) {
      const bytes = reconnectMultiboard(schematic.bytes, snapshot.bytes, mappings);
      if (!bytes.equals(schematic.bytes)) changes.push({ path: schematic.file, bytes });
    }
  }
  return { ready, children: rows, mappings, changes, projectBytes: ready ? reconnectChildBindings(snapshot.bytes, mappings) : null,
    sourceHead: snapshot.head, sourceFilename: snapshot.filename };
}
