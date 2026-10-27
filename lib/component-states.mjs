export function isMigratableComponentState(value) {
  const state = String(value || "").trim().toLowerCase();
  return state === "production" || state.startsWith("prototype");
}
