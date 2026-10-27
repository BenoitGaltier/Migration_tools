// Preserve all binary offsets and artwork while removing the source workspace
// references. Earlier migrations renamed the keys but retained the GUIDs.
export function removeSourceRevisionBindings(bytes, filename) {
  if (!/\.(?:pcb|sch)lib$/i.test(filename)) return Buffer.from(bytes);
  const original = Buffer.from(bytes);
  const text = original.toString("latin1");
  const sanitized = text
    .replace(/ITEMGUID=([0-9a-f]{8}-[0-9a-f-]{27})/gi,
      () => `ORIGGUID=${" ".repeat(36)}`)
    .replace(/REVISIONGUID=([0-9a-f]{8}-[0-9a-f-]{27})/gi,
      () => `SOURCE_REVID=${" ".repeat(36)}`)
    .replace(/VAULTGUID=([0-9a-f]{8}-[0-9a-f-]{27})/gi,
      () => `ORIGVAULT=${" ".repeat(36)}`)
    .replace(/FOLDERGUID=([0-9a-f]{8}-[0-9a-f-]{27})/gi,
      () => `ORIGFOLDID=${" ".repeat(36)}`)
    .replace(/(?:ORIGGUID|SOURCE_REVID)=([0-9a-f]{8}-[0-9a-f-]{27})/gi,
      (field) => `${field.slice(0, field.indexOf("=") + 1)}${" ".repeat(36)}`);
  const result = Buffer.from(sanitized, "latin1");
  if (result.length !== original.length) {
    throw new Error(`Managed revision binding cleanup changed the size of ${filename}`);
  }
  return result;
}

// Both the native field and the older migration's renamed field must be
// checked: either may still retain a real GUID that Designer can validate.
export function embeddedModelRevisionGuid(bytes, filename) {
  if (!/\.(?:pcb|sch)lib$/i.test(filename)) return null;
  return Buffer.from(bytes).toString("latin1")
    .match(/(?:REVISIONGUID|SOURCE_REVID)=([0-9a-f]{8}-[0-9a-f-]{27})/i)?.[1] || null;
}
