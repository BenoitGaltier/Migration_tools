// Project-only helpers. Library/component migration does not import this module.
// Designer commands separate parameters with '|'. Project descriptions often
// contain line breaks; send a single safe line without changing the source file.
export function nativeProjectDescription(description) {
  return String(description || "").replace(/[|\r\n\0]/g, " ").replace(/[ \t]+/g, " ").trim();
}

export async function trySaveProjectMigrationLog(saveLog, payload) {
  try { await saveLog("projects", payload); return null; }
  catch (error) { return `Project log could not be saved: ${error.message}`; }
}

export function nativeVcsMigrationScript({ projectFullPath, projectGuid, evidencePath }) {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(projectGuid || "")) throw new Error("Invalid destination project GUID.");
  const literal = (value) => {
    if (/[\r\n\0]/.test(value)) throw new Error("Invalid native script path.");
    return `'${value.replaceAll("'", "''")}'`;
  };
  return `procedure CompleteProjectVcsMigration;
var W : IWorkspace; P, Previous : IProject; L : TStringList;
begin
 W := GetWorkspace;
 Previous := W.DM_FocusedProject;
 P := W.DM_OpenProject(${literal(projectFullPath)}, False);
 if P = Nil then Exit;
 if UpperCase(P.DM_ProjectFullPath) <> UpperCase(${literal(projectFullPath)}) then Exit;
 if UpperCase(P.DM_ManagedProjectGUID) <> UpperCase('${projectGuid}') then Exit;
 L := TStringList.Create;
 try
  L.Add('started'); L.SaveToFile(${literal(evidencePath)});
  P.DM_SetAsCurrentProject;
  ResetParameters;
  AddStringParameter('ObjectKind', 'FocusedProject');
  AddStringParameter('Silent', 'True');
  RunProcess('WorkspaceManager:MigrateToInternalVCS');
  L.Add('projectFullPath=' + P.DM_ProjectFullPath);
  L.Add('projectGuid=' + P.DM_ManagedProjectGUID);
  L.Add('returned'); L.SaveToFile(${literal(evidencePath)});
 finally
  if (Previous <> Nil) and (Previous <> P) then Previous.DM_SetAsCurrentProject;
  L.Free;
 end;
end;
`;
}

export function assertDesignerDestination(status, workspaceUrl) {
  if (!status?.publishSupported) throw new Error("Install and load Designer bridge 1.1.35 or later for native project migration.");
  const actual = new URL(status.workspaceUrl).hostname.toLowerCase();
  const expected = new URL(workspaceUrl).hostname.toLowerCase();
  if (actual !== expected) throw new Error(`Designer is connected to ${status.workspaceName || actual}, not the destination workspace. Connect it to the destination before migrating.`);
  const workspaceGuid = String(status.workspaceGuid || "").replace(/[{}]/g, "");
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(workspaceGuid)) throw new Error("Designer returned an invalid workspace identifier.");
  return { ...status, workspaceGuid };
}

export function detachManagedProject(bytes) {
  const buffer = Buffer.from(bytes);
  if (buffer[0] === 0xfe && buffer[1] === 0xff) throw new Error("Big-endian project encoding is not supported; no file was modified.");
  const encoding = buffer[0] === 0xff && buffer[1] === 0xfe ? "utf16le"
    : buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf ? "utf8" : "latin1";
  const text = buffer.toString(encoding);
  let section = "";
  let found = false;
  const detached = text.replace(/[^\r\n]+/g, (line) => {
    const header = line.replace(/^\uFEFF/, "").match(/^\s*\[([^\]]+)\]\s*$/);
    if (header) section = header[1].toLowerCase();
    if (section === "design" && /^\s*ManagedProjectGUID\s*=/i.test(line)) {
      if (found) throw new Error("Ambiguous duplicate ManagedProjectGUID in project.");
      found = true;
      return line.replace(/(=).*$/, "$1");
    }
    return line;
  });
  if (!found) throw new Error("The project does not contain a Design/ManagedProjectGUID field.");
  return Buffer.from(detached, encoding);
}

export function managedProjectGuid(bytes) {
  const buffer = Buffer.from(bytes);
  const text = buffer.toString(buffer[0] === 0xff && buffer[1] === 0xfe ? "utf16le" : "utf8");
  const design = text.replace(/^\uFEFF/, "").match(/(?:^|\r?\n)\[Design\]\s*\r?\n([\s\S]*?)(?=\r?\n\[|$)/i)?.[1];
  return design?.match(/^ManagedProjectGUID[ \t]*=[ \t]*([^\r\n]*)/im)?.[1]?.trim().replace(/[{}]/g, "") || "";
}

export function projectRefs(output) {
  return new Map(String(output).trim().split(/\r?\n/).filter(Boolean)
    .map((line) => line.trim().split(/\s+/))
    .filter(([, ref]) => /^refs\/(heads|tags)\//.test(ref || "") && !ref.endsWith("^{}"))
    .map(([sha, ref]) => [ref, sha]));
}

export async function verifyNativeProjectHistory({ sourceOutput, targetOutput, isAncestor }) {
  const source = projectRefs(sourceOutput);
  const target = projectRefs(targetOutput);
  if (!source.size) throw new Error("No source Git history to verify.");
  for (const [ref, sha] of source) {
    const targetSha = target.get(ref);
    if (!targetSha) throw new Error(`Destination Git reference missing: ${ref}`);
    if (targetSha === sha) continue;
    if (ref.startsWith("refs/tags/") || !await isAncestor(sha, targetSha)) {
      throw new Error(`Original Git history was not preserved for ${ref}. Inspect the destination before retrying.`);
    }
  }
  return { verified: true, references: source.size, strategy: "original-commits-with-native-binding-commit" };
}
