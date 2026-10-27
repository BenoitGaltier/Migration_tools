const messages = {
  fr: {
    sourceWorkspace: "Workspace source", refresh: "Actualiser", integrityTitle: "Migration à intégrité stricte",
    integrityText: "L'historique Git est conservé. Les releases existantes restent dans le workspace source.",
    sourceProjects: "Projets source", filter: "Filtrer par nom, description ou type", selectProject: "Sélectionnez un projet",
    targetFolder: "Répertoire du workspace de destination", loadingFolders: "Chargement...", chooseFolder: "Choisir un répertoire cible",
    migrate: "Migrer le projet", revisions: "commits", releases: "releases", analyzing: "Analyse automatique en cours…", cached: "Analyse en cache",
    history: "Historique Git", preserved: "Préservable", blocked: "Bloqué", warnings: "Avertissements", blockers: "Blocages",
    noProjects: "Aucun projet trouvé", executable: "Migration exécutable", notExecutable: "Migration non exécutable",
    configuration: "Configuration", activityLog: "Journal d'activité", logFormat: "[Date + Heure] | Type | Éléments | Données",
    targetProjects: "Projets déjà présents", chooseFolderHint: "Choisissez un répertoire cible", targetFilter: "Filtrer les projets de destination",
    noTargetProjects: "Aucun projet dans ce répertoire", loadingTargetProjects: "Chargement des projets de destination…",
    designerPublish: "Publication par Altium Designer",
    resumeProject: "Reprendre la migration", resumeNotice: "Reprise du projet déjà créé par l’app : aucune nouvelle création.",
    verifyCloud: "Vérifier la publication cloud", pendingCloud: "Historique et fichiers vérifiés — génération cloud à confirmer", pendingNotice: "Le transfert est conservé. Cette vérification relit le même projet cible sans relancer Designer ni créer un projet.",
    alreadyMigrated: "Déjà migré — historique vérifié", completedNotice: "Migration terminée sur le projet cible existant. Aucune nouvelle migration n’est nécessaire.",
    designerConfirm: "Designer peut demander de confirmer « Migrate Project » : validez Migrer, puis OK. L’app vérifie ensuite le dépôt et l’historique avant d’annoncer le succès.",
    settingsHelp: "Les tokens existants restent inchangés quand le champ est vide.", sourceWorkspaces: "Workspaces sources",
    sourceWorkspacesHelp: "Ajoutez toutes les bibliothèques depuis lesquelles vous migrez.", addSource: "Ajouter une source", targetWorkspace: "Workspace cible",
    localSettings: "Paramètres locaux", cacheHours: "Cache (heures)", bridgeUrl: "URL du bridge Designer", bridgeToken: "Token du bridge Designer",
    keepToken: "Vide = conserver", useSystemCa: "Utiliser les certificats Windows", cancel: "Annuler", saveRestart: "Enregistrer et recharger",
    workspaceName: "Nom", workspaceId: "Identifiant", graphqlUrl: "URL GraphQL", uploadUrl: "URL d'upload", accessToken: "Token d'accès",
    tokenStored: "Token enregistré · vide = conserver", activeAtStartup: "Source active au démarrage", remove: "Supprimer", settingsSaved: "Configuration enregistrée"
  },
  es: {
    sourceWorkspace: "Workspace de origen", refresh: "Actualizar", integrityTitle: "Migración con integridad estricta",
    integrityText: "Se conserva el historial Git. Las releases existentes permanecen en el workspace de origen.",
    sourceProjects: "Proyectos de origen", filter: "Filtrar por nombre, descripción o tipo", selectProject: "Seleccione un proyecto",
    targetFolder: "Carpeta del workspace de destino", loadingFolders: "Cargando...", chooseFolder: "Elegir carpeta de destino",
    migrate: "Migrar proyecto", revisions: "commits", releases: "releases", analyzing: "Análisis automático en curso…", cached: "Análisis en caché", history: "Historial Git",
    preserved: "Conservable", blocked: "Bloqueado", warnings: "Avisos", blockers: "Bloqueos", noProjects: "No hay proyectos",
    executable: "Migración ejecutable", notExecutable: "Migración no ejecutable",
    configuration: "Configuración", activityLog: "Registro de actividad", logFormat: "[Fecha + Hora] | Tipo | Elementos | Datos",
    targetProjects: "Proyectos ya presentes", chooseFolderHint: "Elija una carpeta de destino", targetFilter: "Filtrar proyectos de destino",
    noTargetProjects: "No hay proyectos en esta carpeta", loadingTargetProjects: "Cargando proyectos de destino…",
    designerPublish: "Publicación mediante Altium Designer",
    resumeProject: "Reanudar migración", resumeNotice: "Se reanudará el proyecto ya creado por la app, sin crear otro.",
    verifyCloud: "Verificar publicación cloud", pendingCloud: "Historial y archivos verificados — generación cloud pendiente", pendingNotice: "La transferencia se conserva. La verificación consulta el mismo destino sin volver a publicar ni crear otro proyecto.",
    alreadyMigrated: "Ya migrado — historial verificado", completedNotice: "Migración completada en el proyecto de destino existente. No es necesario repetirla.",
    designerConfirm: "Si Designer muestra Migrate Project, confirme Migrate y después OK. La app verificará el repositorio y el historial antes de confirmar el éxito.",
    settingsHelp: "Los tokens existentes no cambian si el campo queda vacío.", sourceWorkspaces: "Workspaces de origen", sourceWorkspacesHelp: "Añada todos los workspaces de origen.",
    addSource: "Añadir origen", targetWorkspace: "Workspace de destino", localSettings: "Ajustes locales", cacheHours: "Caché (horas)", bridgeUrl: "URL del bridge Designer",
    bridgeToken: "Token del bridge Designer", keepToken: "Vacío = conservar", useSystemCa: "Usar certificados de Windows", cancel: "Cancelar", saveRestart: "Guardar y recargar",
    workspaceName: "Nombre", workspaceId: "Identificador", graphqlUrl: "URL GraphQL", uploadUrl: "URL de carga", accessToken: "Token de acceso",
    tokenStored: "Token guardado · vacío = conservar", activeAtStartup: "Origen activo al inicio", remove: "Eliminar", settingsSaved: "Configuración guardada"
  },
  en: {
    sourceWorkspace: "Source workspace", refresh: "Refresh", integrityTitle: "Strict-integrity migration",
    integrityText: "Git history is preserved. Existing releases remain in the source workspace.",
    sourceProjects: "Source projects", filter: "Filter by name, description, or type", selectProject: "Select a project",
    targetFolder: "Target workspace folder", loadingFolders: "Loading...", chooseFolder: "Choose a target folder",
    migrate: "Migrate project", revisions: "commits", releases: "releases", analyzing: "Automatic analysis in progress…", cached: "Cached analysis", history: "Git history",
    preserved: "Preservable", blocked: "Blocked", warnings: "Warnings", blockers: "Blockers", noProjects: "No projects found",
    executable: "Migration executable", notExecutable: "Migration not executable",
    configuration: "Configuration", activityLog: "Activity log", logFormat: "[Date + Time] | Type | Elements | Data",
    targetProjects: "Projects already present", chooseFolderHint: "Choose a target folder", targetFilter: "Filter target projects",
    noTargetProjects: "No projects in this folder", loadingTargetProjects: "Loading target projects…",
    designerPublish: "Publish through Altium Designer",
    resumeProject: "Resume migration", resumeNotice: "Resuming the project already created by this app; no new project will be created.",
    verifyCloud: "Verify cloud publication", pendingCloud: "History and files verified — cloud generation awaiting confirmation", pendingNotice: "The transfer is retained. Verification reads the same target without another Designer command or project creation.",
    alreadyMigrated: "Already migrated — history verified", completedNotice: "Migration completed on the existing destination project. No new migration is needed.",
    designerConfirm: "If Designer displays Migrate Project, confirm Migrate, then OK. The app verifies the repository and history before reporting success.",
    settingsHelp: "Existing tokens remain unchanged when the field is empty.", sourceWorkspaces: "Source workspaces", sourceWorkspacesHelp: "Add every source workspace used for migration.",
    addSource: "Add source", targetWorkspace: "Target workspace", localSettings: "Local settings", cacheHours: "Cache (hours)", bridgeUrl: "Designer bridge URL",
    bridgeToken: "Designer bridge token", keepToken: "Empty = keep", useSystemCa: "Use Windows certificates", cancel: "Cancel", saveRestart: "Save and reload",
    workspaceName: "Name", workspaceId: "Identifier", graphqlUrl: "GraphQL URL", uploadUrl: "Upload URL", accessToken: "Access token",
    tokenStored: "Token stored · empty = keep", activeAtStartup: "Active source at startup", remove: "Remove", settingsSaved: "Configuration saved"
  }
};

const state = { config: null, rows: [], targetRows: [], selected: null, folderId: "", report: null, settings: null, migrating: false };
let language = localStorage.getItem("altium-migration-language") || "fr";
if (!messages[language]) language = "fr";
const t = (key) => messages[language][key] || messages.fr[key] || key;
const $ = (selector) => document.querySelector(selector);

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { "content-type": "application/json", ...(options.headers || {}) } });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || response.statusText);
  return data;
}

function logTimestamp() {
  const locale = { fr: "fr-FR", es: "es-ES", en: "en-GB" }[language] || "fr-FR";
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .format(new Date()).replace(",", "");
}

function log(value, type = "INFO", elements = "-") {
  const output = $("#output");
  const row = document.createElement("div");
  const normalizedType = String(type || "INFO").toUpperCase();
  row.className = `log-entry log-${normalizedType.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  let data;
  try { data = typeof value === "string" ? value : JSON.stringify(value); } catch { data = String(value); }
  for (const [className, text] of [["log-date", `[${logTimestamp()}]`], ["log-type", normalizedType], ["log-elements", elements || "-"], ["log-data", data]]) {
    const cell = document.createElement("span"); cell.className = className; cell.textContent = text; cell.title = text; row.append(cell);
  }
  output.append(row);
  output.scrollTop = output.scrollHeight;
}

function translate() {
  document.documentElement.lang = language;
  document.querySelectorAll("[data-project-i18n]").forEach((node) => { node.textContent = t(node.dataset.projectI18n); });
  document.querySelectorAll("[data-project-i18n-placeholder]").forEach((node) => { node.placeholder = t(node.dataset.projectI18nPlaceholder); });
  renderProjects();
  renderTargetProjects();
  if (state.report) renderReport(state.report);
}

function renderProjects() {
  const term = $("#projectFilter").value.trim().toLowerCase();
  const rows = state.rows.filter((row) => !term || [row.name, row.description, row.projectType].filter(Boolean).join(" ").toLowerCase().includes(term));
  $("#projectCount").textContent = `${rows.length} / ${state.rows.length}`;
  const list = $("#projectsList");
  list.replaceChildren();
  if (!rows.length) list.textContent = t("noProjects");
  for (const row of rows) {
    const button = document.createElement("button");
    button.type = "button";
    button.disabled = state.migrating;
    button.className = `project-row${state.selected?.id === row.id ? " selected" : ""}`;
    const name = document.createElement("strong");
    name.textContent = row.name || row.projectId;
    const meta = document.createElement("span");
    meta.textContent = `${row.projectType} · ${row.revisionCount} ${t("revisions")} · ${row.releaseCount} ${t("releases")}`;
    const description = document.createElement("small");
    description.textContent = row.description || row.repositoryType || "";
    button.append(name, meta, description);
    button.addEventListener("click", () => selectProject(row));
    list.append(button);
  }
}

function renderTargetProjects() {
  const term = $("#targetProjectFilter").value.trim().toLowerCase();
  const rows = state.targetRows.filter((row) => !term || [row.name, row.description, row.owner].filter(Boolean).join(" ").toLowerCase().includes(term));
  $("#targetProjectCount").textContent = state.folderId ? `${rows.length} / ${state.targetRows.length}` : "0";
  const list = $("#targetProjectsList");
  list.replaceChildren();
  if (!state.folderId) {
    const empty = document.createElement("p"); empty.className = "empty-project-list"; empty.textContent = t("chooseFolderHint"); list.append(empty); return;
  }
  if (!rows.length) {
    const empty = document.createElement("p"); empty.className = "empty-project-list"; empty.textContent = t("noTargetProjects"); list.append(empty); return;
  }
  for (const row of rows) {
    const article = document.createElement("article"); article.className = "target-project-row";
    const name = document.createElement("strong"); name.textContent = row.name;
    const description = document.createElement("span"); description.textContent = row.description || row.path || "";
    const meta = document.createElement("small"); meta.textContent = [row.owner, row.modifiedAt ? new Date(row.modifiedAt).toLocaleDateString() : ""].filter(Boolean).join(" · ");
    article.append(name, description, meta); list.append(article);
  }
}

async function loadTargetProjects() {
  state.targetRows = [];
  renderTargetProjects();
  if (!state.folderId) { $("#targetFolderPath").textContent = t("chooseFolderHint"); return; }
  const selectedOption = $("#targetFolder").selectedOptions[0];
  $("#targetFolderPath").textContent = selectedOption?.textContent || "";
  $("#targetProjectsList").textContent = t("loadingTargetProjects");
  try {
    const data = await api(`/api/projects-migration/target-projects?folderId=${encodeURIComponent(state.folderId)}`);
    state.targetRows = data.rows || [];
    renderTargetProjects();
    log(`${state.targetRows.length} projet(s) présent(s) dans ${data.folder.path}`, "INFO", "Destination");
  } catch (error) {
    $("#targetProjectsList").textContent = error.message;
    log(error.message, "ERROR", "Destination");
  }
}

function selectProject(project) {
  state.selected = project;
  state.report = null;
  $("#preflightReport").hidden = true;
  $("#selectedProjectName").textContent = project.name || project.projectId;
  $("#selectedProjectMeta").textContent = `${project.projectType} · ${project.revisionCount} ${t("revisions")} · ${project.releaseCount} ${t("releases")} · ${project.repositoryType}`;
  updateActions();
  renderProjects();
  analyzeSelectedProject();
}

function updateActions() {
  $("#migrateProject").disabled = state.migrating || !state.report?.executable;
  $("#migrateProject").textContent = state.report?.awaitingCloud ? t("verifyCloud") : state.report?.alreadyMigrated ? t("alreadyMigrated") : state.report?.resumeTransfer ? t("resumeProject") : t("migrate");
  for (const id of ["#targetFolder", "#sourceWorkspaceSelect", "#refreshProjects"]) $(id).disabled = state.migrating;
}

function statusCard(label, ok) {
  const card = document.createElement("div");
  card.className = `preservation-card ${ok ? "ok" : "bad"}`;
  const strong = document.createElement("strong"); strong.textContent = label;
  const span = document.createElement("span"); span.textContent = ok ? t("preserved") : t("blocked");
  card.append(strong, span);
  return card;
}

function messageList(title, items, className) {
  if (!items.length) return null;
  const section = document.createElement("section"); section.className = className;
  const heading = document.createElement("h3"); heading.textContent = title;
  const list = document.createElement("ul");
  for (const value of items) { const item = document.createElement("li"); item.textContent = value; list.append(item); }
  section.append(heading, list); return section;
}

function renderReport(report) {
  const root = $("#preflightReport"); root.replaceChildren(); root.hidden = false;
  const summary = document.createElement("div"); summary.className = "preservation-grid";
  summary.append(statusCard(t("history"), report.preservation.gitHistory));
  if (report.creationMode?.startsWith("designer-")) summary.append(statusCard(t("designerPublish"), Boolean(report.designer)));
  const verdict = document.createElement("div"); verdict.className = `preflight-verdict ${report.executable || report.alreadyMigrated ? "ok" : "bad"}`;
  verdict.textContent = report.awaitingCloud ? t("pendingCloud") : report.alreadyMigrated ? t("alreadyMigrated") : report.executable ? t("executable") : t("notExecutable");
  root.append(verdict, summary);
  if (report.resumeTransfer) { const notice = document.createElement("p"); notice.className = "api-limitation"; notice.textContent = report.awaitingCloud ? t("pendingNotice") : t("resumeNotice"); root.append(notice); }
  if (report.alreadyMigrated) { const notice = document.createElement("p"); notice.className = "api-limitation"; notice.textContent = t("completedNotice"); root.append(notice); }
  const blockers = messageList(t("blockers"), report.blockers, "report-blockers"); if (blockers) root.append(blockers);
  const warnings = messageList(t("warnings"), report.warnings, "report-warnings"); if (warnings) root.append(warnings);
  $("#analysisStatus").textContent = report.cache?.hit ? t("cached") : "";
  updateActions();
}

let analysisSequence = 0;
async function analyzeSelectedProject(refresh = false) {
  const sequence = ++analysisSequence;
  state.report = null;
  updateActions();
  if (!state.selected || !state.folderId) {
    $("#preflightReport").hidden = true;
    $("#analysisStatus").textContent = "";
    return;
  }
  $("#analysisStatus").textContent = t("analyzing");
  const root = $("#preflightReport");
  root.hidden = false;
  root.textContent = t("analyzing");
  try {
    const report = await api("/api/projects-migration/preflight", {
      method: "POST",
      body: JSON.stringify({ projectId: state.selected.id, targetFolderId: state.folderId, refresh })
    });
    if (sequence !== analysisSequence) return;
    state.report = report;
    renderReport(report);
    log(report.awaitingCloud ? t("pendingCloud") : report.alreadyMigrated ? t("alreadyMigrated") : report.executable ? t("executable") : t("notExecutable"), report.awaitingCloud ? "WARNING" : report.alreadyMigrated ? "INFO" : report.executable ? "ANALYSIS" : "WARNING", state.selected.name);
  } catch (error) {
    if (sequence !== analysisSequence) return;
    state.report = { executable: false, preservation: {}, releases: { retained: [], excludedClosed: [] }, blockers: [error.message], warnings: [] };
    renderReport(state.report);
    log(error.message, "ERROR", state.selected?.name || "Analyse");
  }
}

async function loadProjects(refresh = false) {
  $("#projectsList").textContent = "…";
  const data = await api(`/api/projects-migration/projects${refresh ? "?refresh=true" : ""}`);
  state.rows = data.rows;
  if (state.selected) state.selected = state.rows.find((row) => row.id === state.selected.id) || null;
  renderProjects(); updateActions();
  log(`${state.rows.length} projet(s) source chargé(s)`, "INFO", "Source");
  if (state.selected && state.folderId) analyzeSelectedProject(refresh);
}

async function boot() {
  try {
    state.config = await api("/api/config");
    const source = state.config.sources.find((item) => item.id === state.config.activeSourceWorkspaceId);
    const select = $("#sourceWorkspaceSelect");
    for (const item of state.config.sources) select.append(new Option(item.name, item.id));
    select.value = state.config.activeSourceWorkspaceId;
    $("#routeSummary").textContent = `${source?.name || "Source"} → ${state.config.target?.name || "Target"}`;
    const folders = await api("/api/folders?kind=projects");
    $("#targetFolder").replaceChildren(new Option(t("chooseFolder"), ""), ...folders.rows.map((folder) => new Option(folder.path, folder.id)));
    await loadProjects();
    log(`${source?.name || "Source"} → ${state.config.target?.name || "Target"}`, "READY", "Projects_migration");
  } catch (error) {
    $("#projectsList").textContent = error.message;
    log(error.message, "ERROR", "Initialisation");
  }
}

function settingsField(labelKey, value, { type = "text", role, placeholder = "", required = false } = {}) {
  const label = document.createElement("label");
  const caption = document.createElement("span"); caption.textContent = t(labelKey);
  const input = document.createElement("input"); input.type = type; input.value = value || ""; input.dataset.role = role || labelKey; input.placeholder = placeholder; input.required = required;
  label.append(caption, input); return label;
}

function workspaceEditor(workspace, { source = false } = {}) {
  const editor = document.createElement("article"); editor.className = "workspace-editor"; editor.dataset.workspaceId = workspace.id || "";
  if (source) {
    const head = document.createElement("div"); head.className = "workspace-editor-head";
    const active = document.createElement("label"); active.className = "check-field";
    const radio = document.createElement("input"); radio.type = "radio"; radio.name = "activeSourceWorkspace"; radio.value = workspace.id || ""; radio.checked = workspace.id === state.settings?.activeSourceWorkspaceId;
    active.append(radio, document.createTextNode(t("activeAtStartup")));
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "remove-workspace"; remove.textContent = t("remove");
    remove.addEventListener("click", () => { editor.remove(); const first = $("#sourceWorkspaceEditors").querySelector('input[name="activeSourceWorkspace"]'); if (first && !$("#sourceWorkspaceEditors").querySelector('input[name="activeSourceWorkspace"]:checked')) first.checked = true; });
    head.append(active, remove); editor.append(head);
  }
  const grid = document.createElement("div"); grid.className = "settings-grid";
  grid.append(
    settingsField("workspaceName", workspace.name, { role: "name", required: true }),
    settingsField("workspaceId", workspace.id, { role: "id", required: true }),
    settingsField("graphqlUrl", workspace.apiUrl, { type: "url", role: "apiUrl", required: true }),
    settingsField("uploadUrl", workspace.filesUploadUrl, { type: "url", role: "filesUploadUrl" }),
    settingsField("accessToken", "", { type: "password", role: "accessToken", placeholder: workspace.tokenConfigured ? t("tokenStored") : t("accessToken") })
  );
  grid.lastElementChild.classList.add("wide-field"); editor.append(grid); return editor;
}

function renderSettings(settings) {
  state.settings = settings;
  $("#sourceWorkspaceEditors").replaceChildren(...settings.sources.map((workspace) => workspaceEditor(workspace, { source: true })));
  $("#targetWorkspaceEditor").replaceChildren(...workspaceEditor(settings.target).childNodes);
  $("#settingsCacheTtl").value = settings.application.cacheTtlHours;
  $("#settingsBridgeUrl").value = settings.application.designerBridgeUrl || "";
  $("#settingsBridgeToken").value = "";
  $("#settingsBridgeToken").placeholder = settings.application.designerBridgeTokenConfigured ? t("tokenStored") : t("keepToken");
  $("#settingsSystemCa").checked = settings.application.useSystemCa;
  $("#settingsError").textContent = "";
}

function readWorkspaceEditor(editor) {
  return Object.fromEntries([...editor.querySelectorAll("[data-role]")].map((input) => [input.dataset.role, input.value.trim()]));
}

async function openSettings() {
  renderSettings(await api("/api/settings"));
  $("#settingsDialog").showModal();
}

$("#languageSelect").value = language;
$("#languageSelect").addEventListener("change", (event) => { language = event.target.value; localStorage.setItem("altium-migration-language", language); translate(); });
$("#projectFilter").addEventListener("input", renderProjects);
$("#targetProjectFilter").addEventListener("input", renderTargetProjects);
$("#refreshProjects").addEventListener("click", () => Promise.all([loadProjects(true), loadTargetProjects()]));
$("#targetFolder").addEventListener("change", (event) => { state.folderId = event.target.value; loadTargetProjects(); analyzeSelectedProject(); });
$("#sourceWorkspaceSelect").addEventListener("change", async (event) => { await api("/api/source-workspace", { method: "POST", body: JSON.stringify({ id: event.target.value }) }); window.location.reload(); });
$("#migrateProject").addEventListener("click", async () => {
  if (state.migrating || !state.report?.executable) return;
  state.migrating = true;
  const project = state.selected;
  updateActions();
  renderProjects();
  const validationOnly = state.report?.awaitingCloud;
  if (!validationOnly && state.report?.creationMode?.startsWith("designer-")) log(t("designerConfirm"), "INFO", project.name);
  try {
    const result = await api(`/api/projects-migration/${validationOnly ? "validate" : "migrate"}`, { method: "POST", body: JSON.stringify({ projectId: project.id,
      targetFolderId: state.folderId, dryRun: false }) });
    $("#analysisStatus").textContent = `${result.status} · ${result.historyRevisions} commits`;
    log(result, result.status === "awaiting-cloud" ? "WARNING" : "MIGRATION", project.name);
    await loadProjects(true);
    await loadTargetProjects();
  } catch (error) { state.report = null; log(error.message, "ERROR", project?.name || "Migration"); }
  finally { state.migrating = false; updateActions(); renderProjects(); }
});

$("#openSettings").addEventListener("click", () => openSettings().catch((error) => log(error.message, "ERROR", "Configuration")));
$("#closeSettings").addEventListener("click", () => $("#settingsDialog").close());
$("#cancelSettings").addEventListener("click", () => $("#settingsDialog").close());
$("#addSourceWorkspace").addEventListener("click", () => {
  const container = $("#sourceWorkspaceEditors");
  const index = container.children.length + 1;
  container.append(workspaceEditor({ id: `SOURCE_${index}`, name: `Source ${index}` }, { source: true }));
});
$("#settingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const saveButton = $("#saveSettings");
  const errorElement = $("#settingsError");
  saveButton.disabled = true; errorElement.textContent = "";
  try {
    const sourceEditors = [...$("#sourceWorkspaceEditors").querySelectorAll(":scope > .workspace-editor")];
    const activeEditor = $("#sourceWorkspaceEditors").querySelector('input[name="activeSourceWorkspace"]:checked')?.closest(".workspace-editor");
    const sources = sourceEditors.map(readWorkspaceEditor);
    const activeIndex = activeEditor ? sourceEditors.indexOf(activeEditor) : 0;
    await api("/api/settings", { method: "POST", body: JSON.stringify({
      sources,
      activeSourceWorkspaceId: sources[activeIndex]?.id,
      target: readWorkspaceEditor($("#targetWorkspaceEditor")),
      application: {
        cacheTtlHours: Number($("#settingsCacheTtl").value),
        designerBridgeUrl: $("#settingsBridgeUrl").value.trim(), designerBridgeToken: $("#settingsBridgeToken").value.trim(),
        useSystemCa: $("#settingsSystemCa").checked
      }
    }) });
    log(t("settingsSaved"), "INFO", "Configuration");
    $("#settingsDialog").close();
    window.setTimeout(() => window.location.reload(), 300);
  } catch (error) { errorElement.textContent = error.message; log(error.message, "ERROR", "Configuration"); }
  finally { saveButton.disabled = false; }
});

translate();
boot();
