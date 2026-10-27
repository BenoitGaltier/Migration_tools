import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
const run = promisify(execFile);

test("the real API can be tested on an isolated state directory without starting the user-facing port or exposing tokens", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "altium-api-isolation-"));
  t.after(async () => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); await rm(root, { recursive: true, force: true }); });
  const source = { id: "SOURCE_TEST", name: "Source test", apiUrl: "https://source.example.altium.com/api/graphql", accessToken: "fake-source-credential-for-isolated-test" };
  const target = { id: "TARGET_TEST", name: "Target test", apiUrl: "https://target.example.altium.com/api/graphql", accessToken: "fake-target-credential-for-isolated-test" };
  const script = `
    import assert from 'node:assert/strict';
    import {readFile} from 'node:fs/promises';
    import path from 'node:path';
    const {createApplicationServer}=await import(process.env.TEST_SERVER_MODULE);
    const app=createApplicationServer();
    await new Promise(r=>app.listen(0,'127.0.0.1',r));
    const base='http://127.0.0.1:'+app.address().port;
    try {
      const response=await fetch(base+'/api/config');
      const text=await response.text();
      assert.equal(response.status,200);
      assert.equal(response.headers.get('cache-control'),'no-store');
      assert.ok(!text.includes('fake-source-credential'));
      assert.ok(!text.includes('fake-target-credential'));
      const config=JSON.parse(text);
      assert.equal(config.sources[0].name,'Source test');
      const settings=await (await fetch(base+'/api/settings')).json();
      assert.ok(!settings.sources[0].accessToken);
      const payload={sources:settings.sources.map(s=>({...s,accessToken:''})),activeSourceWorkspaceId:'SOURCE_TEST',target:{...settings.target,accessToken:''},application:{...settings.application,cacheTtlHours:24,useSystemCa:false}};
      const saved=await fetch(base+'/api/settings',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
      assert.equal(saved.status,200,await saved.text());
      const local=await readFile(path.join(process.env.ALTIUM_DATA_ROOT,'.env'),'utf8');
      assert.ok(local.includes('fake-source-credential-for-isolated-test'));
      console.log(JSON.stringify({isolated:true,port:app.address().port}));
    } finally {await new Promise(r=>app.close(r));}
  `;
  const result = await run(process.execPath, ["--input-type=module", "-e", script], { windowsHide: true, timeout: 30000, env: { ...process.env, ALTIUM_DATA_ROOT: root, ALTIUM_SOURCE_WORKSPACES_JSON: JSON.stringify([source]), ACTIVE_SOURCE_WORKSPACE: source.id, ALTIUM_TARGET_WORKSPACE_JSON: JSON.stringify(target), ALTIUM_USE_SYSTEM_CA: "false", TEST_SERVER_MODULE: new URL("../server.mjs", import.meta.url).href } });
  assert.equal(JSON.parse(result.stdout).isolated, true);
  assert.ok((await readFile(path.join(root, ".env"), "utf8")).includes("ALTIUM_CACHE_TTL_HOURS=24"));
});
