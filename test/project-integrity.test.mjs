import assert from "node:assert/strict";
import test from "node:test";
import { assertProjectDocuments, assertSourceFilesPreserved, gitTreeEntries } from "../lib/project-integrity.mjs";
import { projectDesignDocuments } from "../lib/project-cloud.mjs";
const entry = (path, oid = "a".repeat(40), mode = "100644") => ({ path, oid, mode, type: "blob" });
test("checks linked CAD documents with spaces, Latin-1, BOM and repeated CR line endings", () => {
  const text = "[Design]\r\n[Document1]\r\nDocumentPath=Power µ.SchDoc\r\r\n[Document2]\r\nDocumentPath=../Board.PcbDoc\r\n";
  const files = [entry("nested/Power µ.SchDoc"), entry("Board.PcbDoc")];
  for (const [prefix, encoding] of [["", "latin1"], ["\uFEFF", "utf8"], ["\uFEFF", "utf16le"]]) {
    assert.equal(assertProjectDocuments("nested/Device.PrjPcb", Buffer.from(prefix + text, encoding), files).length, 2);
  }
  assert.throws(() => assertProjectDocuments("nested/Device.PrjPcb", Buffer.from(text, "latin1"), files.slice(0, 1)), /Missing.*document/);
  for (const document of ["C:\\outside.SchDoc", "../../outside.PcbDoc", "\\\\host\\share\\outside.PcbDoc"]) {
    assert.throws(() => assertProjectDocuments("Device.PrjPcb", Buffer.from(`[Document1]\nDocumentPath=${document}`), files), /Missing|external/);
  }
  assert.deepEqual(projectDesignDocuments(Buffer.from("[OutputConfiguration]\nDocumentPath=ignored.SchDoc")), []);
});
test("keeps every original non-binding file, its binary object and mode", () => {
  const source = [entry("Device.PrjPcb"), entry("Board.PcbDoc"), entry("Variants.xml"), entry("Release.zip"), entry("manual.pdf")];
  const target = source.map((file) => ({ ...file })); target[0].path = "moved/Device.PrjPcb"; target[0].oid = "b".repeat(40);
  assert.equal(assertSourceFilesPreserved(source, target).files, 4);
  target[2].oid = "b".repeat(40); assert.throws(() => assertSourceFilesPreserved(source, target), /Variants.xml/);
  assert.throws(() => assertSourceFilesPreserved(source, target.slice(0, 1)), /Board.PcbDoc/);
  assert.throws(() => assertProjectDocuments("Device.PrjPcb", Buffer.from(""), [entry("A"), entry("a")]), /collide/);
  assert.throws(() => assertProjectDocuments("Device.PrjPcb", Buffer.from(""), [entry("link", "a".repeat(40), "120000")]), /Linked/);
});
test("reads Git's unquoted NUL-delimited manifest without changing Unicode paths", () => {
  assert.deepEqual(gitTreeEntries(`100644 blob ${"a".repeat(40)}\tµ board.PcbDoc\0`), [entry("µ board.PcbDoc")]);
  assert.throws(() => gitTreeEntries("not a Git manifest\0"), /Invalid/);
});
