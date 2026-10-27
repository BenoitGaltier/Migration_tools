import assert from "node:assert/strict";
import test from "node:test";
import { assertMirroredProjectRefs, checkProjectApiAccess, initializeProjectWithApi } from "../lib/project-api.mjs";

const services = {
  graphqlUrl: "https://eur.365.altium.com/napi/gateway/graphql/",
  filesUploadUrl: "https://eur.365.altium.com/napi/files/File/Upload",
  workspaceUrl: "https://destination.365.altium.com/"
};
const argumentsForUpload = {
  services, token: "destination-token", project: { name: "USB_TO_LIN", description: "Project" },
  folder: { id: "opaque-destination-folder", folderId: "folder-guid" }, archiveBytes: Buffer.from("zip")
};

test("initializes through advertised APIs using only the target token and folder", async () => {
  const calls = [];
  const projectId = await initializeProjectWithApi({ ...argumentsForUpload, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.headers.authorization, "Bearer destination-token");
    if (calls.length === 1) {
      assert.equal(url, services.filesUploadUrl);
      assert.equal(await options.body.get("file").text(), "zip");
      return new Response('"uploaded-file"');
    }
    assert.equal(url, services.graphqlUrl);
    assert.deepEqual(JSON.parse(options.body).variables.input, {
      name: "USB_TO_LIN", description: "Project", fileId: "uploaded-file",
      parentFolderId: "opaque-destination-folder", workspaceUrl: services.workspaceUrl
    });
    return Response.json({ data: { desUploadProject: { projectId: "target-project", errors: [] } } });
  } });
  assert.equal(projectId, "target-project");
  assert.equal(calls.length, 2);
});

test("stops on archive authentication failure before attempting project creation", async () => {
  let calls = 0;
  await assert.rejects(initializeProjectWithApi({ ...argumentsForUpload, fetchImpl: async () => {
    calls += 1;
    return new Response("Unauthorized", { status: 401 });
  } }), /archive upload failed \(HTTP 401\)/);
  assert.equal(calls, 1);
});

test("does not retry creation on an internal signin error or a lost response", async () => {
  for (const lostResponse of [false, true]) {
    let calls = 0;
    await assert.rejects(initializeProjectWithApi({ ...argumentsForUpload, fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return new Response("file-id");
      if (lostResponse) throw new Error("Connection closed after sending mutation");
      return Response.json({ errors: [{ message: "Unexpected Execution Error", extensions: { message: "Unexpected signin result." } }] });
    } }), lostResponse ? /Connection closed/ : /Unexpected signin result/);
    assert.equal(calls, 2);
  }
});

test("preflight only reads the destination Project API", async () => {
  const result = await checkProjectApiAccess({ services, token: "target", fetchImpl: async (url, options) => {
    assert.equal(url, services.graphqlUrl);
    const { query } = JSON.parse(options.body);
    assert.match(query, /^query /);
    assert.equal(options.headers.authorization, "Bearer target");
    return Response.json({ data: { desProjects: { nodes: [] } } });
  } });
  assert.equal(result.authenticated, true);
});

test("detects lost branches or changed tags after mirroring the project history", () => {
  const source = "abc refs/heads/master\ndef refs/tags/v1\n";
  assert.deepEqual(assertMirroredProjectRefs(source, "abc\trefs/heads/master\ndef\trefs/tags/v1\n123\trefs/tags/v1^{}\n"),
    { verified: true, references: 2 });
  assert.throws(() => assertMirroredProjectRefs(source, "abc refs/heads/master"), /refs\/tags\/v1/);
  assert.throws(() => assertMirroredProjectRefs(source, "changed refs/heads/master\ndef refs/tags/v1"), /refs\/heads\/master/);
  assert.throws(() => assertMirroredProjectRefs("", "abc refs/heads/master"), /no branch or tag/);
});
