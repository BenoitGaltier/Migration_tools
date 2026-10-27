import { open, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";

// Retry only the local atomic replace when Windows briefly locks a file.
// A native publication command must never be retried by this mechanism.
export async function saveProjectJournal(filename, value, { replace = rename, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, "wx");
    try { await handle.writeFile(JSON.stringify(value, null, 2)); await handle.sync(); }
    finally { await handle.close(); }
    for (let attempt = 0;; attempt++) {
      try { await replace(temporary, filename); break; }
      catch (error) {
        if (attempt === 5 || !["EPERM", "EACCES", "EBUSY"].includes(error.code)) throw error;
        await wait(50 * (attempt + 1));
      }
    }
  } finally { await rm(temporary, { force: true }); }
}
