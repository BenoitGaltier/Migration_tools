import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { projectNativeRequest } from "../lib/project-native-request.mjs";

test("native project requests remain local and do not transmit credentials to a remote bridge", async () => {
  await assert.rejects(projectNativeRequest("http://remote.example:4174", "secret", "/command", {}), /local Designer/);
  await assert.rejects(projectNativeRequest("https://localhost:4174", "secret", "/command", {}), /local Designer/);
});

test("native project command is authenticated and never retried after a failure", async () => {
  let calls = 0;
  const server = createServer((req, res) => {
    calls++;
    assert.equal(req.headers.authorization, "Bearer destination-bridge-token");
    res.writeHead(422, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Original native failure" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await assert.rejects(projectNativeRequest(`http://127.0.0.1:${server.address().port}`, "destination-bridge-token", "/command", {}), /Original native failure/);
    assert.equal(calls, 1);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
