import assert from "node:assert/strict";
import test from "node:test";
import { projectKind, projectTypeForFile, projectDocumentEntries, projectChildProjects } from "../lib/project-types.mjs";
import { selectMigrationProjectFile, selectPublishedProjectFile, validateMigrationProjectPath } from "../lib/project-paths.mjs";
import { projectDesignDocuments, projectCloudState } from "../lib/project-cloud.mjs";
import { detachManagedProject, managedProjectGuid } from "../lib/project-designer.mjs";
import { assertProjectDocuments, assertSourceFilesPreserved } from "../lib/project-integrity.mjs";
const guid = "11111111-1111-4111-8111-111111111111", child = "22222222-2222-4222-8222-222222222222";
const bytes = (documents) => Buffer.from(`\uFEFF[Design]\r\nManagedProjectGUID=${guid}\r\n${documents.map((path,i)=>`[Document${i+1}]\r\nDocumentPath=${path}\r\n`).join("")}`);
const entry = (path, oid="a".repeat(40)) => ({path, oid, mode:"100644", type:"blob"});
for (const [type,extension,documents] of [["PCB_PROJECT","PrjPcb",["Sheet.SchDoc","Board.PcbDoc"]], ["HARNESS_DESIGN","PrjHar",["Wiring.WirDoc","Layout.LdrDoc"]], ["SYSTEM_DESIGN","PrjMbd",["Overview.MbsDoc","Assembly.MbaDoc"]]]) {
  test(`selects and verifies ${type} independently of neighboring project kinds`, async () => {
    assert.equal(projectTypeForFile(`nested/Design.${extension}`), type);
    assert.equal(projectKind(type).extension, "."+extension);
    const filename=`nested/Design.${extension}`, other=type==="PCB_PROJECT"?"child.PrjHar":"child.PrjPcb";
    assert.equal(selectMigrationProjectFile([filename,other],"Design",null,type),filename);
    assert.equal(await selectPublishedProjectFile([filename,other],guid,async file=>file===filename?bytes(documents):bytes([]),type),filename);
    assert.deepEqual(projectDesignDocuments(bytes(documents),type),documents);
    assert.equal(assertProjectDocuments(filename,bytes(documents),documents.map(d=>entry("nested/"+d))).length,2);
    assert.throws(()=>assertProjectDocuments(filename,bytes(documents),[entry("nested/"+documents[0])]),/Missing.*document/);
    const source=[entry(filename),entry(documents[0])],target=[entry(filename,"b".repeat(40)),entry(documents[0])];
    assert.equal(assertSourceFilesPreserved(source,target,{projectType:type}).verified,true);
    target[1].oid="b".repeat(40); assert.throws(()=>assertSourceFilesPreserved(source,target,{projectType:type}),/missing or modified/);
  });
}
test("rejects unknown project kinds and documents masquerading as project files",()=>{
  for (const type of ["NONE","SCRIPT_PROJECT","HARNESS"]) assert.throws(()=>projectKind(type),/Unsupported project type/);
  for (const file of ["x.PrjScr","x.PrjHar.exe","x.SchDoc"]) assert.throws(()=>projectTypeForFile(file),/Unsupported project file/);
});
test("keeps multiboard child GUIDs when detaching only its parent binding",()=>{
  const text=`\uFEFF[Design]\r\nManagedProjectGUID=${guid}\r\n[Document1]\r\nDocumentPath=Overview.MbsDoc\r\n[Document2]\r\nDocumentPath=..\\Child\\Child.PrjPcb\r\nManagedProjectGUID=${child}\r\n`;
  for (const encoding of ["utf8","utf16le"]) {
    const original=Buffer.from(text,encoding),detached=detachManagedProject(original);
    assert.equal(managedProjectGuid(detached),"");assert.ok(detached.toString(encoding).includes(`ManagedProjectGUID=${child}`));
    assert.deepEqual(projectChildProjects(original),[{section:"Document2",path:"..\\Child\\Child.PrjPcb",projectGuid:child,projectType:"PCB_PROJECT"}]);
  }
});
test("does not confuse parameters, duplicate paths or unbound external files with managed child projects",()=>{
  assert.deepEqual(projectDocumentEntries(Buffer.from("[Parameter1]\nDocumentPath=ignored.WirDoc")),[]);
  assert.throws(()=>projectDocumentEntries(Buffer.from("[Document1]\nDocumentPath=a.WirDoc\nDocumentPath=b.WirDoc")),/Duplicate/);
  assert.throws(()=>projectDocumentEntries(Buffer.from("[Document1]\nDocumentPath=\nDocumentPath=b.WirDoc")),/Duplicate/);
  assert.throws(()=>projectChildProjects(Buffer.from("[Document1]\nDocumentPath=..\\Child.PrjPcb")),/GUID/);
});
for (const [type,documents] of [["HARNESS_DESIGN",["Harness.WirDoc","Harness.LdrDoc"]],["SYSTEM_DESIGN",["System.MbsDoc","Assembly.MbaDoc"]]]) test(`${type} uses current Metadata and Preview when GraphQL variants are empty`,()=>{
  const state={projectType:type,projectGuid:guid,targetHead:"commit",details:{Guid:guid,WorkInProgressInfo:{GenerationStatus:1,Sources:[{Source:"Metadata",VcsRevision:"commit"},{Source:"Preview",VcsRevision:"commit"}]}},variants:[],expectedDocuments:documents};
  const valid=projectCloudState(state);assert.equal(valid.verified,true);assert.equal(valid.currentPreview,true);assert.equal(valid.expectedDocumentCount,2);
  const old=structuredClone(state);old.details.WorkInProgressInfo.Sources[1].VcsRevision="old";assert.equal(projectCloudState(old).verified,false);
  const missing=structuredClone(state);missing.details.WorkInProgressInfo.Sources.pop();assert.equal(projectCloudState(missing).verified,false);
  assert.equal(projectCloudState({...state,expectedDocuments:[]}).verified,false);
  assert.equal(projectCloudState({...state,projectType:"PCB_PROJECT"}).verified,false);
});
