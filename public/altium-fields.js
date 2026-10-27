// Altium Explorer uses the API's "comment" for Name and "name" for Revision ID.
// API revisionId/revisionInternalId values are internal GUIDs.
export function explorerName(row) {
  return row?.comment || "";
}

export function explorerRevisionId(row) {
  return row?.name || "";
}

export function internalRevisionGuid(row) {
  return row?.revisionInternalId || row?.revisionId
    || row?.revision?.details?.revisionId || String(row?.id || "").split("/").at(-1) || "";
}
