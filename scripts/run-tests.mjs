import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = (await readdir(path.join(root, "test"))).filter((file) => file.endsWith(".test.mjs")).sort().map((file) => path.join(root, "test", file));
const env = { ...process.env };
// Git invokes hooks with repository-local variables. Do not let those variables
// redirect the temporary repositories used by the regression tests to this index.
for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_PREFIX", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"]) delete env[key];
const result = spawnSync(process.execPath, ["--test", ...process.argv.slice(2), ...files], { cwd: root, env, stdio: "inherit", windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
