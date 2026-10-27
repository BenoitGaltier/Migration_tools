const normalizeId = (id) => String(id || "").replace(/[{}]/g, "").toLowerCase();
const normalizePath = (value) => String(value || "").replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
function placementError(message) {
  return Object.assign(new Error(message), { code: "PROJECT_FOLDER_INVALID" });
}

// VaultFolder is the project's own folder, not the catalog selected by the user.
export function projectPublicationPath(folder, projectName) {
  const catalog = normalizePath(folder?.path);
  const name = String(projectName || "").trim();
  if (!catalog || !name || /[\\/|\x00-\x1f]/.test(name) || /^(\.|\.\.)$/.test(name)
      || catalog.split("/").some((part) => !part || part === "." || part === ".." || /[|\x00-\x1f]/.test(part))) {
    throw new Error("Invalid destination project folder or project name; no project was published.");
  }
  return `${catalog}/${name}`.replaceAll("/", "\\");
}

// Explorer's direct entity path can be synthesized from the folder tree. Read
// the project's own Multicad metadata through its advertised, read-only link.
export function projectPlacementDetailsUrl(entity, workspaceUrl, projectGuid) {
  const link = entity?.linkList?.find((candidate) => candidate.rel === "GetEntityDetails" && candidate.verb === "GET");
  let endpoint;
  try { endpoint = new URL(link?.href, workspaceUrl); } catch { /* Report an unverifiable placement below. */ }
  if (entity?.type !== "Project" || normalizeId(entity.id) !== normalizeId(projectGuid)
      || !link?.href || !endpoint || endpoint.protocol !== "https:"
      || !endpoint.hostname.endsWith(".365.altium.com") || endpoint.username || endpoint.password
      || endpoint.port || endpoint.search || endpoint.hash
      || endpoint.pathname.toLowerCase() !== `/multicad/api/v1/projects/${normalizeId(projectGuid)}`) {
    throw placementError("The destination project does not advertise a valid project-details endpoint. Its native folder binding cannot be verified.");
  }
  return endpoint.href;
}

export function assertProjectFolderPlacement({ projectGuid, projectName, folder, projectFolders, listedProjects, projectMetadata }) {
  const projectFolder = projectFolders.find((candidate) => normalizeId(candidate.folderId) === normalizeId(projectGuid));
  const expectedPath = normalizePath(projectPublicationPath(folder, projectName));
  if (!projectFolder || projectFolder.folderType !== "PROJECT") {
    throw placementError(`Destination project ${projectName} has no dedicated PROJECT folder. Its workspace structure must be repaired; no new project will be created.`);
  }
  if (normalizeId(projectFolder.parent?.folderId) !== normalizeId(folder.folderId)
      || normalizePath(projectFolder.path).toLowerCase() !== expectedPath.toLowerCase()) {
    throw placementError(`Destination project ${projectName} is not in its own PROJECT folder under ${folder.path}. Inspect its workspace structure before retrying.`);
  }
  if (!listedProjects.some((entity) => normalizeId(entity.id) === normalizeId(projectGuid) && projectFolderRow(entity, folder))) {
    throw placementError(`Destination project ${projectName} is missing from the Altium 365 listing of ${folder.path}. Migration is not verified.`);
  }
  // A PROJECT folder and a catalog entry can both exist while the native item
  // still belongs to the catalog. This was USB_TO_LIN's partially repaired state.
  if (!projectMetadata || normalizeId(projectMetadata.Guid) !== normalizeId(projectGuid)) {
    throw placementError(`Destination project ${projectName} returned no matching project metadata. Its native folder binding cannot be verified.`);
  }
  if (normalizePath(projectMetadata.FolderPath).toLowerCase() !== expectedPath.toLowerCase()
      || normalizePath(projectMetadata.ParentFolderPath).toLowerCase() !== normalizePath(folder.path).toLowerCase()
      || normalizeId(projectMetadata.ParentFolderGuid) !== normalizeId(folder.folderId)) {
    throw placementError(`Destination project ${projectName} has an inconsistent native item-to-folder binding (FolderPath: ${projectMetadata.FolderPath || "missing"}). Expected ${expectedPath} under ${folder.path}. Its workspace structure must be repaired; no new project will be created.`);
  }
  return { verified: true, projectFolderId: projectFolder.folderId, path: projectFolder.path, parentFolderId: folder.folderId,
    nativeItemBinding: { verified: true, projectGuid: projectMetadata.Guid, folderPath: projectMetadata.FolderPath,
      parentFolderId: projectMetadata.ParentFolderGuid, parentFolderPath: projectMetadata.ParentFolderPath } };
}

export function projectFolderRow(entity, folder) {
  const normalize = (id) => String(id || "").replace(/[{}]/g, "").toLowerCase();
  if (entity?.type !== "Project" || !normalize(entity.parentFolder?.id)
      || normalize(entity.parentFolder.id) !== normalize(folder.folderId)) return null;
  return {
    id: entity.id, projectId: entity.id, name: entity.name,
    description: entity.description || "", type: entity.type,
    path: entity.path || `${folder.path}/${entity.name}`,
    owner: entity.owner?.displayName || entity.owner?.name || "",
    modifiedBy: entity.modifiedBy?.displayName || entity.modifiedBy?.name || "",
    modifiedAt: entity.modifiedBy?.date || null
  };
}
