// Project initialization uses only the destination workspace's API token.
// Keep this independent from Designer and the library/component migration APIs.
async function apiJson(fetchImpl, url, token, query, variables, operationName) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query, variables, operationName }),
    signal: AbortSignal.timeout(180_000)
  });
  let payload;
  try { payload = await response.json(); }
  catch { throw new Error(`Project API returned an invalid response (HTTP ${response.status})`); }
  if (!response.ok || payload.errors?.length) {
    const details = (payload.errors || []).map((error) => [...new Set([
      error.message, error.extensions?.message
    ].filter(Boolean))].join(" | ")).join("; ");
    const error = new Error(`Project API ${operationName} failed (HTTP ${response.status})${details ? `: ${details}` : ""}`);
    error.operationName = operationName;
    error.httpStatus = response.status;
    error.requestId = payload.extensions?.requestId || null;
    throw error;
  }
  return payload.data;
}

export async function checkProjectApiAccess({ services, token, fetchImpl = fetch }) {
  const data = await apiJson(fetchImpl, services.graphqlUrl, token,
    "query ProjectMigrationTargetAccess { desProjects(first: 1) { nodes { id } } }",
    {}, "ProjectMigrationTargetAccess");
  if (!data?.desProjects) throw new Error("The destination Project API did not return its projects");
  return { authenticated: true, graphqlUrl: services.graphqlUrl };
}

export async function initializeProjectWithApi({
  services, token, project, folder, archiveBytes, fetchImpl = fetch
}) {
  if (!folder?.id) throw new Error("The destination project folder identifier is missing");
  if (!archiveBytes?.length) throw new Error("The source project archive is empty");
  const form = new FormData();
  form.append("file", new Blob([archiveBytes], { type: "application/zip" }), "project.zip");
  const upload = await fetchImpl(services.filesUploadUrl, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
    signal: AbortSignal.timeout(300_000)
  });
  const uploadText = (await upload.text()).trim();
  if (!upload.ok) throw new Error(`Project archive upload failed (HTTP ${upload.status})`);
  const fileId = uploadText.replace(/^"|"$/g, "");
  if (!fileId || !/^[A-Za-z0-9_:/.-]+$/.test(fileId)) {
    throw new Error("The project upload service did not return a valid file identifier");
  }
  // Never retry this mutation automatically: an interrupted response can hide a
  // successful creation. The caller must reconcile the destination first.
  let data;
  try {
    data = await apiJson(fetchImpl, services.graphqlUrl, token,
    `mutation InitializeMigratedProject($input: DesUploadProjectInput!) {
      desUploadProject(input: $input) { projectId errors { message } }
    }`, {
      input: {
        name: project.name,
        description: project.description || "",
        fileId,
        parentFolderId: folder.id,
        workspaceUrl: services.workspaceUrl
      }
    }, "InitializeMigratedProject");
  } catch (error) {
    error.uploadedFileId = fileId;
    throw error;
  }
  const result = data?.desUploadProject;
  if (result?.errors?.length) {
    throw new Error(`Project initialization failed: ${result.errors.map((error) => error.message).join("; ")}`);
  }
  if (!result?.projectId) throw new Error("The Project API did not return the created project identifier");
  return result.projectId;
}

export function assertMirroredProjectRefs(sourceOutput, targetOutput) {
  const parse = (value) => new Map(String(value).trim().split(/\r?\n/).filter(Boolean)
    .map((line) => line.trim().split(/\s+/))
    .filter(([, ref]) => /^refs\//.test(ref || "") && !ref.endsWith("^{}"))
    .map(([sha, ref]) => [ref, sha]));
  const source = parse(sourceOutput);
  const target = parse(targetOutput);
  if (!source.size) throw new Error("The source project contains no branch or tag to verify");
  for (const [ref, sha] of source) {
    if (target.get(ref) !== sha) throw new Error(`Project history verification failed for ${ref}`);
  }
  return { verified: true, references: source.size };
}
