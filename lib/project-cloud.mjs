// Project creation and a populated Git repository do not prove that the web
// viewer can open the design. Validate generated data at the published commit.
export function projectDesignDocuments(bytes) {
  const buffer = Buffer.from(bytes);
  const encoding = buffer[0] === 0xff && buffer[1] === 0xfe ? "utf16le"
    : buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf ? "utf8" : "latin1";
  const text = buffer.toString(encoding).replace(/^\uFEFF/, "");
  let documentSection = false;
  const documents = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) documentSection = /^Document\d+$/i.test(header[1]);
    if (documentSection) {
      const filename = line.match(/^DocumentPath=(.+)$/i)?.[1].trim();
      if (filename && /\.(?:SchDoc|PcbDoc)$/i.test(filename)) documents.push(filename);
    }
  }
  return [...new Set(documents)];
}

export function projectCloudState({ projectGuid, targetHead, details, variants = [], expectedDocuments = [] }) {
  const id = String(details?.Guid || "").replace(/[{}]/g, "").toLowerCase();
  if (id !== String(projectGuid || "").replace(/[{}]/g, "").toLowerCase()) throw new Error("Cloud design metadata belongs to a different project.");
  const wip = details.WorkInProgressInfoWithStatus || details.WorkInProgressInfo || {};
  const message = wip.GenerationMessage || "";
  const generationStatus = Number(wip.GenerationStatus);
  const sources = wip.Sources || [];
  const currentMetadata = sources.some((source) => source.Source === "Metadata" && source.VcsRevision === targetHead);
  const documentNames = new Set(variants.flatMap((variant) => [...(variant.schematics || []), ...(variant.pcb ? [variant.pcb] : [])])
    .map((document) => String(document.documentName || "").replaceAll("\\", "/").split("/").pop().toLowerCase()));
  const required = expectedDocuments.filter((filename) => /\.(?:SchDoc|PcbDoc)$/i.test(filename));
  const missingDocuments = required.filter((filename) => !documentNames.has(filename.replaceAll("\\", "/").split("/").pop().toLowerCase()));
  const ready = generationStatus === 1 && currentMetadata && required.length > 0 && missingDocuments.length === 0;
  return { verified: ready, available: required.length > 0 && missingDocuments.length === 0, generationStatus, targetHead, currentMetadata, missingDocuments, documentCount: documentNames.size, message };
}

export async function waitForProjectCloudData(readState, { attempts = 30, delayMs = 5000, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  let state;
  for (let attempt = 0; attempt < attempts; attempt++) {
    state = await readState();
    if (state.verified) return state;
    if (/failed|error/i.test(state.message || "")) throw new Error(`Cloud design generation failed: ${state.message}. The existing target and local copy are retained.`);
    if (attempt + 1 < attempts) await wait(delayMs);
  }
  const error = new Error("The Git transfer is preserved, but Altium 365 has not generated the current schematic/PCB data. Migration is awaiting cloud validation; inspect the existing target instead of creating another project.");
  error.cloudVerification = state;
  throw error;
}
