// Project migration only. Do not use these rules to filter library revisions.
const kinds = Object.freeze({
  PCB_PROJECT: Object.freeze({ extension: ".PrjPcb", label: "PCB", documents: [".schdoc", ".pcbdoc"] }),
  HARNESS_DESIGN: Object.freeze({ extension: ".PrjHar", label: "Harness", documents: [".wirdoc", ".ldrdoc"] }),
  SYSTEM_DESIGN: Object.freeze({ extension: ".PrjMbd", label: "Multiboard", documents: [".mbsdoc", ".mbadoc"] })
});
export const supportedProjectTypes = Object.freeze(Object.keys(kinds));
export function projectKind(type) {
  if (!Object.hasOwn(kinds, type)) throw new Error(`Unsupported project type: ${type || "unknown"}. No project was published.`);
  return kinds[type];
}
export function projectTypeForFile(filename) {
  const match = supportedProjectTypes.find((type) => String(filename).toLowerCase().endsWith(kinds[type].extension.toLowerCase()));
  if (!match) throw new Error(`Unsupported project file: ${filename}`);
  return match;
}
export function projectText(bytes) {
  const buffer = Buffer.from(bytes);
  if (buffer[0] === 0xfe && buffer[1] === 0xff) throw new Error("Big-endian project encoding is not supported.");
  const encoding = buffer[0] === 0xff && buffer[1] === 0xfe ? "utf16le"
    : buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf ? "utf8" : "latin1";
  return { text: buffer.toString(encoding), encoding };
}
export function projectDocumentEntries(bytes) {
  const documents = [], sections = new Set(); let current = null, fields = new Set();
  for (const raw of projectText(bytes).text.split(/\r?\n/)) {
    const line = raw.trim(), header = line.match(/^\[([^\]]+)\]$/);
    if (header) {
      current = null; fields = new Set();
      if (/^Document\d+$/i.test(header[1])) {
        const key = header[1].toLowerCase(); if (sections.has(key)) throw new Error(`Duplicate project document section: ${header[1]}`);
        sections.add(key); current = { section: header[1], path: "", projectGuid: "" }; documents.push(current);
      }
    } else if (current) {
      const field = line.match(/^(DocumentPath|ManagedProjectGUID)\s*=\s*(.*)$/i);
      if (field) {
        const key = field[1].toLowerCase() === "documentpath" ? "path" : "projectGuid";
        if (fields.has(key)) throw new Error(`Duplicate ${field[1]} in ${current.section}`);
        fields.add(key);
        current[key] = field[2].trim();
      }
    }
  }
  return documents.filter((document) => document.path);
}
export function projectChildProjects(bytes) {
  return projectDocumentEntries(bytes).filter((document) => /\.(PrjPcb|PrjHar|PrjMbd)$/i.test(document.path)).map((document) => {
    const projectGuid = document.projectGuid.replace(/[{}]/g, "");
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(projectGuid)) throw new Error(`Managed child project has no valid GUID: ${document.path}`);
    return { ...document, projectGuid, projectType: projectTypeForFile(document.path) };
  });
}
