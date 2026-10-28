// Project creation and a populated Git repository do not prove that the web
// viewer can open the design. Validate generated data at the published commit.
import { projectKind, projectDocumentEntries } from "./project-types.mjs";
export function projectDesignDocuments(bytes, projectType = "PCB_PROJECT") {
  const kind = projectKind(projectType);
  return [...new Set(projectDocumentEntries(bytes).map((document) => document.path)
    .filter((filename) => kind.documents.some((extension) => filename.toLowerCase().endsWith(extension))))];
}

export function projectCloudState({ projectGuid, targetHead, details, variants = [], expectedDocuments = [], projectType = "PCB_PROJECT" }) {
  const kind = projectKind(projectType);
  const id = String(details?.Guid || "").replace(/[{}]/g, "").toLowerCase();
  if (id !== String(projectGuid || "").replace(/[{}]/g, "").toLowerCase()) throw new Error("Cloud design metadata belongs to a different project.");
  const wip = details.WorkInProgressInfoWithStatus || details.WorkInProgressInfo || {};
  const message = wip.GenerationMessage || "";
  const generationStatus = Number(wip.GenerationStatus);
  const sources = wip.Sources || [];
  const currentMetadata = sources.some((source) => source.Source === "Metadata" && source.VcsRevision === targetHead);
  const currentPreview = sources.some((source) => source.Source === "Preview" && source.VcsRevision === targetHead);
  const documentNames = new Set(variants.flatMap((variant) => [...(variant.schematics || []), ...(variant.pcb ? [variant.pcb] : [])])
    .map((document) => String(document.documentName || "").replaceAll("\\", "/").split("/").pop().toLowerCase()));
  const required = expectedDocuments.filter((filename) => kind.documents.some((extension) => filename.toLowerCase().endsWith(extension)));
  // Harness/system designs legitimately have no GraphQL variants. Their native
  // processing service publishes commit-specific Metadata and Preview receipts.
  if (projectType !== "PCB_PROJECT") return {
    verified: generationStatus === 1 && currentMetadata && currentPreview && required.length > 0,
    available: generationStatus === 1 && currentPreview, generationStatus, targetHead, currentMetadata, currentPreview,
    expectedDocumentCount: required.length, documentCount: documentNames.size, missingDocuments: [], message,
    basis: "current-metadata-and-preview-with-verified-git-documents"
  };
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
  const error = new Error("The Git transfer is preserved, but Altium 365 has not generated the current project design data. Migration is awaiting cloud validation; inspect the existing target instead of creating another project.");
  error.cloudVerification = state;
  throw error;
}
