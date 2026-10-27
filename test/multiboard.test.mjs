import assert from "node:assert/strict";
import test from "node:test";
import { readProjectArchive, createProjectArchive, rewriteProjectArchive } from "../lib/project-archive.mjs";
import { multiboardModules, reconnectMultiboard, reconnectChildBindings } from "../lib/project-dependencies.mjs";
import { analyzeMultiboardDependencies } from "../lib/project-dependency-plan.mjs";
const source="22222222-2222-4222-8222-222222222222",target="33333333-3333-4333-8333-333333333333";
const parent=Buffer.from(`[Design]\nManagedProjectGUID=11111111-1111-4111-8111-111111111111\n[Document1]\nDocumentPath=Overview.MbsDoc\n[Document2]\nDocumentPath=../Child/Child.PrjPcb\nManagedProjectGUID=${source}\n`);
const logical=()=>({uniqueId:"keep-parent-document-id",modules:[{id:9,designator:"Child",source:{sourceType:1,sourceProject:"../Child/Child.PrjPcb",projectGuid:source,projectName:"Child source",revisionGuid:"",boardFileName:"../Child/Board.PcbDoc"},entries:[{id:11,logicalConnection:6}]}],connections:[{id:6,keep:true}]});
const archive=(data=logical())=>createProjectArchive(new Map([["logical.json",Buffer.from(JSON.stringify(data))],["Pages/page_1.json",Buffer.from('{"module":9}')],["untouched.bin",Buffer.from("keep embedded "+source)]]));
const mapping=()=>({sourceGuid:source,targetGuid:target,projectType:"PCB_PROJECT",verified:true,sourceProjectFilename:"Child.PrjPcb",targetProjectFilename:"New.PrjPcb",targetName:"Child global",files:["New.PrjPcb","Board.PcbDoc"]});
test("project ZIP rewriting preserves every unrelated stream and checks its CRC",()=>{
  const original=archive(),entries=readProjectArchive(original);assert.equal(entries.size,3);
  const updated=rewriteProjectArchive(original,new Map([["logical.json",Buffer.from('{"modules":[]}')]]));
  const read=readProjectArchive(updated);assert.deepEqual(read.get("untouched.bin"),entries.get("untouched.bin"));assert.deepEqual(read.get("Pages/page_1.json"),entries.get("Pages/page_1.json"));
  assert.equal(read.get("logical.json").toString(),'{"modules":[]}');
  assert.throws(()=>rewriteProjectArchive(original,new Map([["missing",Buffer.from("new")]])),/Unknown archive/);
  const corrupted=Buffer.from(original);corrupted[40]^=127;assert.throws(()=>readProjectArchive(corrupted),/ZIP|CRC|archive|inflate|invalid/i);
  assert.throws(()=>readProjectArchive(Buffer.from("not an archive")),/ZIP|archive/);
});
test("reconnects only child source fields by verified GUID, preserving modules, connections, pages and parent identity",()=>{
  const original=archive(),map=[mapping()],updated=reconnectMultiboard(original,parent,map);
  const result=JSON.parse(readProjectArchive(updated).get("logical.json"));
  assert.equal(result.modules[0].source.projectGuid,target);assert.equal(result.modules[0].source.sourceProject,"../Child/New.PrjPcb");assert.equal(result.modules[0].source.projectName,"Child global");
  const expected=logical();expected.modules[0].source={...expected.modules[0].source,projectGuid:target,sourceProject:"../Child/New.PrjPcb",projectName:"Child global"};assert.deepEqual(result,expected);
  assert.deepEqual(readProjectArchive(updated).get("untouched.bin"),readProjectArchive(original).get("untouched.bin"));
  const project=reconnectChildBindings(parent,map).toString();assert.match(project,/ManagedProjectGUID=11111111/);assert.ok(project.includes("ManagedProjectGUID="+target));assert.ok(project.includes("DocumentPath=../Child/New.PrjPcb"));
  assert.equal(multiboardModules(updated)[0].source.projectGuid,target);
});
test("refuses absent, unverified, ambiguous or incomplete target provenance instead of mapping by name",()=>{
  for(const mappings of [[],[{...mapping(),verified:false}],[mapping(),mapping()],[{...mapping(),targetGuid:source}],[{...mapping(),targetGuid:"invalid"}],[{...mapping(),files:["New.PrjPcb"]}]])assert.throws(()=>reconnectMultiboard(archive(),parent,mappings),/verified|mapping|GUID|board|duplicate|source/i);
  const pinned=logical();pinned.modules[0].source.revisionGuid="pinned-release";assert.throws(()=>reconnectMultiboard(archive(pinned),parent,[mapping()]),/pinned|revision/i);
  const foreign=logical();foreign.modules[0].source.projectGuid=target;assert.throws(()=>reconnectMultiboard(archive(foreign),parent,[mapping()]),/declared|source|mapping/i);
});
function adapters() {
  return { project:{projectId:"11111111-1111-4111-8111-111111111111"}, snapshot:{bytes:parent,filename:"System.PrjMbd",head:"parent-head",readFile:async()=>archive()},
    listSources:async()=>[{id:"source-id",projectId:source,projectType:"PCB_PROJECT",name:"Child source"}],
    readTransfer:async()=>({sourceProjectId:"source-id",phase:"completed",sourceHead:"child-head",targetProjectGuid:target,targetProjectId:"target-id",sourceProjectFilename:"Child.PrjPcb",historyVerification:{verified:true}}),
    getTarget:async()=>({id:"target-id",projectId:target,projectType:"PCB_PROJECT",name:"Child global",repositoryUrl:"file:///local.git"}),
    loadTarget:async()=>({head:"target-head",filename:"New.PrjPcb",entries:[{path:"New.PrjPcb"},{path:"Board.PcbDoc"}]}),verifyTarget:async()=>true };
}
test("a multiboard plan requires exact migration provenance and current child verification before producing edits",async()=>{
  const plan=await analyzeMultiboardDependencies(adapters());assert.equal(plan.ready,true);assert.equal(plan.children[0].sourceGuid,source);assert.equal(plan.children[0].targetGuid,target);assert.equal(plan.changes.length,1);assert.equal(plan.mappings.length,1);
  assert.equal(JSON.parse(readProjectArchive(plan.changes[0].bytes).get("logical.json")).modules[0].source.projectGuid,target);
});
test("missing, foreign, wrong-type and unverified children block the plan without creating or changing projects",async()=>{
  const absent=adapters();absent.readTransfer=async()=>null;absent.getTarget=async()=>{throw Error("Must not guess target by name")};
  const pending=await analyzeMultiboardDependencies(absent);assert.equal(pending.ready,false);assert.equal(pending.children[0].status,"pending-migration");assert.deepEqual(pending.changes,[]);
  for (const override of [{readTransfer:async()=>({sourceProjectId:"foreign"})},{getTarget:async()=>({projectId:target,projectType:"HARNESS_DESIGN"})},{verifyTarget:async()=>false}]) {
    const result=await analyzeMultiboardDependencies({...adapters(),...override});assert.equal(result.ready,false);assert.deepEqual(result.changes,[]);assert.equal(result.projectBytes,null);
  }
});
test("cycles and inconsistent multiboard module references are rejected before mapping lookups",async()=>{
  const cycle=adapters();cycle.project.projectId=source;await assert.rejects(analyzeMultiboardDependencies(cycle),/Cyclic/);
  const wrong=adapters();wrong.snapshot.readFile=async()=>{const data=logical();data.modules[0].source.sourceProject="../Unrelated/Child.PrjPcb";return archive(data)};
  await assert.rejects(analyzeMultiboardDependencies(wrong),/path differs/);
});
test("unexpected semantic child links are blocked while ordinary notes and indented INI keys remain intact",()=>{
  const linked=logical();linked.connections.push({harnessProjectGuid:source});assert.throws(()=>reconnectMultiboard(archive(linked),parent,[mapping()]),/unsupported child project reference/);
  const noted=logical();noted.notes=[{text:"Original reference "+source}];const transformed=reconnectMultiboard(archive(noted),parent,[mapping()]);assert.deepEqual(JSON.parse(readProjectArchive(transformed).get("logical.json")).notes,noted.notes);
  const indented=Buffer.from(parent.toString().replace("DocumentPath=../Child", "  DocumentPath=../Child").replace("ManagedProjectGUID="+source,"  ManagedProjectGUID="+source));
  assert.ok(reconnectChildBindings(indented,[mapping()]).toString().includes("  ManagedProjectGUID="+target));
});
