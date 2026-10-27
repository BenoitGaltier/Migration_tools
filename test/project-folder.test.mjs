import assert from "node:assert/strict";
import test from "node:test";
import { projectFolderRow, projectPublicationPath, projectPlacementDetailsUrl, assertProjectFolderPlacement } from "../lib/project-folder.mjs";
test("uses direct project parent metadata, including a newly registered project", () => {
  const entity = { id: "project-guid", name: "USB_TO_LIN", type: "Project", parentFolder: { id: "FOLDER-GUID" }, path: "Projects/France Team/Legacy/USB_TO_LIN" };
  const folder = { folderId: "folder-guid", path: "Projects/France Team/Legacy" };
  assert.equal(projectFolderRow(entity, folder).projectId, "project-guid");
  assert.equal(projectFolderRow(entity, folder).path, entity.path);
  assert.equal(projectFolderRow({ ...entity, parentFolder: { id: "another-folder" } }, folder), null);
  assert.equal(projectFolderRow({ ...entity, type: "Folder" }, folder), null);
  assert.equal(projectFolderRow({ ...entity, parentFolder: null }, folder), null);
});

test("publication places the project in its own folder rather than in the catalog", () => {
  assert.equal(projectPublicationPath({ path: "Projects/France Team/Legacy" }, "USB_TO_LIN"), "Projects\\France Team\\Legacy\\USB_TO_LIN");
  assert.equal(projectPublicationPath({ path: "Projects\\France Team\\Legacy\\" }, "USB_TO_LIN"), "Projects\\France Team\\Legacy\\USB_TO_LIN");
  for (const name of ["../Legacy", "a\\b", "x|Silent=True", "..", ""]) {
    assert.throws(() => projectPublicationPath({ path: "Projects/Legacy" }, name), /Invalid destination/);
  }
});

const placement = () => ({
  projectGuid: "project-guid", projectName: "USB_TO_LIN",
  folder: { folderId: "legacy-guid", path: "Projects/France Team/Legacy" },
  projectFolders: [{ folderId: "PROJECT-GUID", folderType: "PROJECT", path: "Projects/France Team/Legacy/USB_TO_LIN", parent: { folderId: "LEGACY-GUID" } }],
  listedProjects: [{ id: "project-guid", name: "USB_TO_LIN", type: "Project", parentFolder: { id: "legacy-guid" } }],
  projectMetadata: { Guid: "PROJECT-GUID", FolderPath: "Projects/France Team/Legacy/USB_TO_LIN",
    ParentFolderGuid: "LEGACY-GUID", ParentFolderPath: "Projects/France Team/Legacy" }
});
test("a complete project structure also requires the native item's own folder binding", () => {
  const result = assertProjectFolderPlacement(placement());
  assert.equal(result.verified, true);
  assert.equal(result.nativeItemBinding.verified, true);
});
test("rejects USB_TO_LIN's incomplete registration even if direct entity metadata looks correct", () => {
  const input = placement();
  input.projectFolders = [{ folderId: "legacy-guid", folderType: "PROJECT_CATALOG", path: input.folder.path }];
  assert.throws(() => assertProjectFolderPlacement(input), /no dedicated PROJECT folder/);
  input.projectFolders[0].folderId = "project-guid";
  assert.throws(() => assertProjectFolderPlacement(input), /no dedicated PROJECT folder/);
});
test("rejects the wrong parent and missing web catalog entry", () => {
  const input = placement();
  input.projectFolders[0].parent.folderId = "france-team-guid";
  assert.throws(() => assertProjectFolderPlacement(input), /not in its own PROJECT folder/);
  input.projectFolders[0].parent.folderId = "legacy-guid";
  input.listedProjects = [];
  assert.throws(() => assertProjectFolderPlacement(input), /missing from the Altium 365 listing/);
});

test("rejects USB_TO_LIN's partially repaired state: a folder and catalog entry hide a misplaced native item", () => {
  const input = placement();
  // Actual Multicad values before the native MoveObjects repair. The Explorer
  // catalog and dedicated PROJECT folder already looked correct at this point.
  input.projectMetadata = { Guid: input.projectGuid, FolderPath: input.folder.path,
    ParentFolderPath: "Projects/France Team", ParentFolderGuid: "france-team-guid" };
  assert.throws(() => assertProjectFolderPlacement(input), { code: "PROJECT_FOLDER_INVALID", message: /native item-to-folder binding/ });
});

test("rejects missing, unrelated or inconsistent project metadata even with a valid folder tree", () => {
  for (const values of [null, { Guid: "different-project" },
    { ParentFolderGuid: "different-catalog" }, { ParentFolderPath: "Projects/Other" },
    { FolderPath: "Projects/France Team/Legacy/Another_Project" }, { FolderPath: "" }]) {
    const input = placement();
    input.projectMetadata = values === null ? null : { ...input.projectMetadata, ...values };
    assert.throws(() => assertProjectFolderPlacement(input), { code: "PROJECT_FOLDER_INVALID" });
  }
  const input = placement();
  input.projectMetadata = {};
  assert.throws(() => assertProjectFolderPlacement(input), /no matching project metadata/);
});

test("accepts equivalent Altium GUID casing, braces and Windows path separators", () => {
  const input = placement();
  input.projectMetadata = { Guid: "{PROJECT-GUID}", FolderPath: "Projects\\France Team\\Legacy\\USB_TO_LIN\\",
    ParentFolderGuid: "{LEGACY-GUID}", ParentFolderPath: "Projects\\France Team\\Legacy\\" };
  assert.equal(assertProjectFolderPlacement(input).nativeItemBinding.verified, true);
});

const detailsEntity = (href = "https://eur.365.altium.com/multicad/api/v1/projects/project-guid") => ({
  id: "project-guid", type: "Project", linkList: [{ rel: "GetEntityDetails", verb: "GET", href }]
});
test("uses the advertised project-details API without hardcoding the workspace region", () => {
  for (const region of ["eur", "us", "apac"]) {
    const url = `https://${region}.365.altium.com/multicad/api/v1/projects/project-guid`;
    assert.equal(projectPlacementDetailsUrl(detailsEntity(url), "https://workspace.365.altium.com/api/graphql", "project-guid"), url);
  }
});
test("refuses missing or unrelated detail links before sending the destination token", () => {
  const workspace = "https://workspace.365.altium.com/api/graphql";
  for (const url of ["", "http://eur.365.altium.com/multicad/api/v1/projects/project-guid",
    "https://example.com/multicad/api/v1/projects/project-guid",
    "https://eur.365.altium.com.example.com/multicad/api/v1/projects/project-guid",
    "https://eur.365.altium.com/multicad/api/v1/projects/another-project",
    "https://eur.365.altium.com/multicad/api/v1/projects/project-guid?redirect=elsewhere",
    "https://user:password@eur.365.altium.com/multicad/api/v1/projects/project-guid"]) {
    assert.throws(() => projectPlacementDetailsUrl(detailsEntity(url), workspace, "project-guid"), { code: "PROJECT_FOLDER_INVALID" });
  }
  assert.throws(() => projectPlacementDetailsUrl({ id: "project-guid", type: "Project" }, workspace, "project-guid"), /cannot be verified/);
  assert.throws(() => projectPlacementDetailsUrl(detailsEntity(), workspace, "another-project"), /cannot be verified/);
});
