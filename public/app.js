import { disposeFootprint3d, loadFootprintScene, renderFootprint3d, setFootprint3dLayers } from "/library-renderer.js";
import { getLanguage, setLanguage, t, translateDocument } from "/i18n.js";
import { explorerName, explorerRevisionId, internalRevisionGuid } from "/altium-fields.js";

const state = {
  kind: "symbols",
  completed: { symbols: {}, footprints: {}, components: {} },
  footprintBindingDiagnostics: {},
  mappingPreview: null,
  mappingDrafts: new Map(),
  config: {},
  semiAuto: { categories: null, targetCategoryId: "", prepared: null },
  views: {
    symbols: { rows: null, selected: new Set(), filter: "", folders: null, targetFolderId: "", previewId: null },
    footprints: { rows: null, selected: new Set(), filter: "", folders: null, targetFolderId: "", previewId: null },
    components: { rows: null, selected: new Set(), filter: "", folders: null, targetFolderId: "", previewId: null }
  }
};

const labels = {
  get symbols() { return t("symbols"); },
  get footprints() { return t("footprints"); },
  get components() { return t("components"); }
};

const output = document.querySelector("#output");
const list = document.querySelector("#list");
const count = document.querySelector("#count");
const migratedList = document.querySelector("#migratedList");
const migratedCount = document.querySelector("#migratedCount");
const title = document.querySelector("#title");
const filter = document.querySelector("#filter");
const targetFolder = document.querySelector("#targetFolder");
const migrateButton = document.querySelector("#migrate");
const configureMappingButton = document.querySelector("#configureMapping");
const mappingPanel = document.querySelector("#mappingPanel");
const mappingRows = document.querySelector("#mappingRows");
const componentSymbol = document.querySelector("#componentSymbol");
const componentFootprints = document.querySelector("#componentFootprints");
const semiAutoPanel = document.querySelector("#semiAutoPanel");
const sourceCategory = document.querySelector("#sourceCategory");
const targetCategory = document.querySelector("#targetCategory");
const batchSize = document.querySelector("#batchSize");
const semiAutoResults = document.querySelector("#semiAutoResults");
const modelPreview = document.querySelector("#modelPreview");
const modelPreviewName = document.querySelector("#modelPreviewName");
const modelPreviewRevision = document.querySelector("#modelPreviewRevision");
const modelPreviewContent = document.querySelector("#modelPreviewContent");
const sourceWorkspaceSelect = document.querySelector("#sourceWorkspaceSelect");
const settingsDialog = document.querySelector("#settingsDialog");
const sourceWorkspaceEditors = document.querySelector("#sourceWorkspaceEditors");
const targetWorkspaceEditor = document.querySelector("#targetWorkspaceEditor");

document.querySelector("#languageSelect").value = getLanguage();
translateDocument();

function logTimestamp() {
  const locale = { fr: "fr-FR", es: "es-ES", en: "en-GB" }[getLanguage()] || "fr-FR";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).format(new Date()).replace(",", "");
}

function logData(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function appendLogEntry(type, elements, data) {
  const row = document.createElement("div");
  const normalizedType = String(type || "INFO").toUpperCase();
  row.className = `log-entry log-${normalizedType.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  for (const [className, value] of [
    ["log-date", `[${logTimestamp()}]`],
    ["log-type", normalizedType],
    ["log-elements", elements || "-"],
    ["log-data", logData(data)]
  ]) {
    const cell = document.createElement("span");
    cell.className = className;
    cell.textContent = value;
    cell.title = value;
    row.append(cell);
  }

  output.append(row);
  output.scrollTop = output.scrollHeight;
}

function log(value, type = null, elements = null) {
  if (Array.isArray(value?.results)) {
    for (const result of value.results) {
      const entryType = result.status === "failed" ? "ERROR" : `MIGRATION ${result.status || "RESULT"}`;
      appendLogEntry(entryType, result.name || result.sourceId || elements, result);
    }
    return;
  }

  if (typeof value === "string") {
    const errorLike = /(error|erreur|echec|failed|indisponible|unavailable|invalid|missing|required|cannot|unable)/i.test(value);
    const warningLike = /(aucun|choisir|choisissez|no selection|not selected)/i.test(value);
    appendLogEntry(type || (errorLike ? "ERROR" : warningLike ? "WARNING" : "INFO"), elements, value);
    return;
  }

  const inferredType = type || value?.type || value?.kind || (value?.ok === false ? "ERROR" : "INFO");
  const inferredElements = elements || value?.elements || value?.element || value?.parameter
    || value?.name || value?.workspace || "-";
  appendLogEntry(inferredType, inferredElements, value);
}

function currentView() {
  return state.views[state.kind];
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || response.statusText);
  return data;
}

function isCompleted(kind, id) {
  return Boolean(state.completed[kind]?.[id]);
}

function filteredRows(completed) {
  const view = currentView();
  if (!view.rows) return [];
  const term = filter.value.trim().toLowerCase();
  return view.rows.filter((row) => isCompleted(state.kind, row.id) === completed)
    .filter((row) => !term || [
    row.name,
    row.comment,
    row.revisionId,
    row.revisionInternalId,
    row.description,
    row.folderPath,
    row.componentTypeName,
    row.lifecycleState
  ].filter(Boolean).join(" ").toLowerCase().includes(term));
}

function scientificValueToPlain(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^([+-]?)(\d+)(?:\.(\d*))?[eE]([+-]?\d+)$/);
  if (!match) return text;
  const sign = match[1] === "-" ? "-" : "";
  const integer = match[2];
  const fraction = match[3] || "";
  const exponent = Number(match[4]);
  const digits = `${integer}${fraction}`;
  const decimalIndex = integer.length + exponent;
  let plain;
  if (decimalIndex <= 0) plain = `0.${"0".repeat(-decimalIndex)}${digits}`;
  else if (decimalIndex >= digits.length) plain = `${digits}${"0".repeat(decimalIndex - digits.length)}`;
  else plain = `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
  plain = plain.replace(/^0+(?=\d)/, "").replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return `${sign}${plain || "0"}`;
}

function sourceValueForTarget(source, target) {
  if (!source) return target.defaultValue ?? "";
  if (String(target.dataType || "Text").toLowerCase() === "text") return source.value ?? "";
  if (source.realValue && String(source.type || "").toLowerCase() === String(target.dataType || "").toLowerCase()) {
    return scientificValueToPlain(source.realValue);
  }
  return source.value ?? "";
}

function sourceOptionLabel(source) {
  const sample = source.value ? ` | ${String(source.value).slice(0, 60)}` : "";
  return `${source.name}${sample}`;
}

function refreshMappingSourceOptions(preview) {
  const selects = [...mappingRows.querySelectorAll('[data-role="mapping"]')];
  const selected = new Map(selects.map((select) => [select.dataset.targetName, select.value]));
  for (const select of selects) {
    const current = selected.get(select.dataset.targetName) || "";
    const usedElsewhere = new Set([...selected.entries()]
      .filter(([targetName, sourceKey]) => targetName !== select.dataset.targetName && sourceKey)
      .map(([, sourceKey]) => sourceKey));
    const empty = new Option(select.dataset.emptyLabel || t("noSource"), "");
    const options = preview.sourceParameters
      .filter((source) => source.key === current || !usedElsewhere.has(source.key))
      .map((source) => new Option(sourceOptionLabel(source), source.key));
    select.replaceChildren(empty, ...options);
    select.value = current;
  }
}

function isIpcMediumDensity(model) {
  return /\bipc\s+(?:medium|nominal)\s+density\b/i.test([
    model?.description,
    model?.comment,
    model?.name
  ].filter(Boolean).join(" "));
}

function updateControls() {
  const view = currentView();
  document.querySelector("#selectAll").disabled = !view.rows;
  document.querySelector("#clearSelection").disabled = view.selected.size === 0;
  migrateButton.disabled = view.selected.size === 0;
  configureMappingButton.hidden = state.kind !== "components";
  configureMappingButton.disabled = view.selected.size === 0 || !view.targetFolderId;
  targetFolder.disabled = !view.folders;
  semiAutoPanel.hidden = state.kind !== "components";
}

function renderUrl(kind, id, workspace = "source", view = "2d", layers = null) {
  const layerQuery = Array.isArray(layers) ? `&layers=${[...layers].sort((a, b) => a - b).join(",")}` : "";
  return `/api/library-render?kind=${kind}&workspace=${workspace}&view=${view}&id=${encodeURIComponent(id)}${layerQuery}`;
}

function modelCard(model, kind, workspace = "source") {
  const card = document.createElement("article");
  card.className = "render-card";
  const heading = document.createElement("div");
  heading.className = "render-card-head";
  const label = document.createElement("strong");
  label.textContent = `Name : ${explorerName(model) || t("unavailable")}`;
  const revision = document.createElement("span");
  revision.textContent = `${t("revision")} : ${explorerRevisionId(model) || t("unavailable")}`;
  heading.append(label, revision);
  card.append(heading);

  const canvas = document.createElement("div");
  canvas.className = "model-preview-canvas";
  const status = document.createElement("span");
  status.textContent = t("readingLibrary");
  const image = document.createElement("img");
  image.alt = `${kind === "symbols" ? t("symbols") : t("footprints")} ${model.name || ""}`;
  image.hidden = true;
  image.onload = () => { image.hidden = false; status.hidden = true; };
  image.onerror = () => { image.hidden = true; status.hidden = false; status.textContent = t("renderUnavailable"); };
  canvas.append(image, status);
  card.append(canvas);

  let activeMode = "2d";
  let footprintScene = null;
  let visibleLayers = new Set();

  const show2d = () => {
    activeMode = "2d";
    disposeFootprint3d(canvas);
    canvas.replaceChildren(image, status);
    if (kind === "footprints" && footprintScene && visibleLayers.size === 0) {
      image.hidden = true;
      status.hidden = false;
      status.textContent = t("noLayersSelected");
      return;
    }
    image.hidden = true;
    status.hidden = false;
    status.textContent = t("readingLibrary");
    image.src = renderUrl(kind, model.id, workspace, "2d",
      kind === "footprints" && footprintScene ? [...visibleLayers] : null);
  };

  if (kind === "footprints") {
    const switcher = document.createElement("div");
    switcher.className = "view-switcher";
    const button2d = document.createElement("button");
    const button3d = document.createElement("button");
    button2d.type = button3d.type = "button";
    button2d.textContent = "2D";
    button3d.textContent = "3D";
    button2d.className = "active";
    button2d.addEventListener("click", () => {
      button2d.classList.add("active");
      button3d.classList.remove("active");
      show2d();
    });
    button3d.addEventListener("click", async () => {
      activeMode = "3d";
      button3d.classList.add("active");
      button2d.classList.remove("active");
      disposeFootprint3d(canvas);
      canvas.replaceChildren(status);
      status.hidden = false;
      status.textContent = t("building3d");
      try {
        footprintScene ||= await loadFootprintScene(renderUrl(kind, model.id, workspace, "3d"));
        await renderFootprint3d(canvas, footprintScene, visibleLayers);
      } catch (error) {
        canvas.replaceChildren(status);
        status.hidden = false;
        status.textContent = `${t("view3dUnavailable")} : ${error.message}`;
      }
    });
    switcher.append(button2d, button3d);
    heading.append(switcher);

    const layerControls = document.createElement("section");
    layerControls.className = "layer-controls";
    layerControls.setAttribute("aria-label", t("footprintLayers"));
    const layerHeader = document.createElement("div");
    layerHeader.className = "layer-controls-head";
    const layerTitle = document.createElement("strong");
    layerTitle.textContent = t("footprintLayers");
    const layerActions = document.createElement("div");
    const allLayers = document.createElement("button");
    const noLayers = document.createElement("button");
    allLayers.type = noLayers.type = "button";
    allLayers.textContent = t("showAllLayers");
    noLayers.textContent = t("hideAllLayers");
    layerActions.append(allLayers, noLayers);
    layerHeader.append(layerTitle, layerActions);
    const layerList = document.createElement("div");
    layerList.className = "layer-list";
    layerList.textContent = t("readingLayers");
    layerControls.append(layerHeader, layerList);
    card.insertBefore(layerControls, canvas);

    const applyLayerSelection = () => {
      if (activeMode === "3d") setFootprint3dLayers(canvas, visibleLayers);
      else show2d();
    };
    const setAllLayers = (checked) => {
      for (const input of layerList.querySelectorAll('input[type="checkbox"]')) input.checked = checked;
      visibleLayers = new Set(checked ? (footprintScene?.layers || []).map((layer) => layer.id) : []);
      applyLayerSelection();
    };
    allLayers.addEventListener("click", () => setAllLayers(true));
    noLayers.addEventListener("click", () => setAllLayers(false));

    loadFootprintScene(renderUrl(kind, model.id, workspace, "3d")).then((data) => {
      footprintScene = data;
      visibleLayers = new Set((data.layers || []).map((layer) => layer.id));
      layerList.replaceChildren();
      for (const layer of data.layers || []) {
        const option = document.createElement("label");
        option.className = "layer-option";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = true;
        input.value = layer.id;
        input.addEventListener("change", () => {
          if (input.checked) visibleLayers.add(layer.id);
          else visibleLayers.delete(layer.id);
          applyLayerSelection();
        });
        const swatch = document.createElement("i");
        swatch.style.backgroundColor = layer.color;
        const text = document.createElement("span");
        text.textContent = `${layer.name} (${layer.count})`;
        option.append(input, swatch, text);
        layerList.append(option);
      }
      if (!(data.layers || []).length) layerList.textContent = t("noLayersFound");
      show2d();
    }).catch((error) => {
      layerList.textContent = `${t("layersUnavailable")} : ${error.message}`;
    });
  }
  show2d();
  return card;
}

async function renderModelPreview() {
  const view = currentView();
  const row = view.rows?.find((candidate) => candidate.id === view.previewId);
  if (!row) {
    modelPreview.hidden = true;
    modelPreviewContent.replaceChildren();
    modelPreviewContent.dataset.previewKey = "";
    return;
  }
  modelPreview.hidden = false;
  modelPreviewName.textContent = `Name : ${explorerName(row) || t("unavailable")}`;
  modelPreviewRevision.textContent = `${t("revision")} : ${explorerRevisionId(row) || t("unavailable")}`;
  const previewKey = `${state.kind}:${row.id}`;
  if (modelPreviewContent.dataset.previewKey === previewKey) return;
  modelPreviewContent.dataset.previewKey = previewKey;
  modelPreviewContent.replaceChildren();
  if (state.kind !== "components") {
    modelPreviewContent.append(modelCard(row, state.kind));
    return;
  }

  const loading = document.createElement("div");
  loading.className = "result-empty";
  loading.textContent = t("componentModelsLoading");
  modelPreviewContent.append(loading);
  try {
    const data = await api(`/api/component-details?workspace=source&id=${encodeURIComponent(row.id)}`);
    if (modelPreviewContent.dataset.previewKey !== previewKey) return;
    const symbols = data.component.symbols?.length
      ? data.component.symbols
      : (data.component.models || []).filter((model) => model.modelType === "symbol");
    const footprints = data.component.footprints?.length
      ? data.component.footprints
      : (data.component.models || []).filter((model) => model.modelType === "footprint");
    modelPreviewContent.replaceChildren();
    for (const symbol of symbols) modelPreviewContent.append(modelCard(symbol, "symbols"));
    for (const footprint of footprints) modelPreviewContent.append(modelCard(footprint, "footprints"));
    if (!symbols.length && !footprints.length) {
      loading.textContent = t("noComponentModels");
      modelPreviewContent.append(loading);
    }
  } catch (error) {
    if (modelPreviewContent.dataset.previewKey !== previewKey) return;
    loading.textContent = error.message;
    modelPreviewContent.replaceChildren(loading);
  }
}

function appendLibraryRow(container, row, selectable) {
  const article = document.createElement("article");
  article.className = `row${selectable ? "" : " migrated"}`;
  article.tabIndex = 0;
  article.setAttribute("aria-label", `Afficher ${row.name || row.id}`);
  const selectPreview = () => {
    currentView().previewId = row.id;
    renderModelPreview();
  };
  article.addEventListener("click", (event) => {
    if (event.target.closest("input, button")) return;
    selectPreview();
  });
  article.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    selectPreview();
  });
  if (selectable) {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.setAttribute("aria-label", `Selectionner ${row.name || row.id}`);
    checkbox.checked = currentView().selected.has(row.id);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        currentView().selected.add(row.id);
        currentView().previewId = row.id;
      } else {
        currentView().selected.delete(row.id);
      }
      render();
    });
    article.append(checkbox);
  }
  const text = document.createElement("div");
  text.className = "row-content";
  const name = document.createElement("strong");
  name.textContent = `Name : ${explorerName(row) || t("unavailable")}`;
  const revision = document.createElement("span");
  const completed = state.completed[state.kind]?.[row.id];
  revision.textContent = [
    completed
      ? `${t("sourceRevision")} : ${explorerRevisionId(row) || completed.name || t("unavailable")}`
      : `${t("revision")} : ${explorerRevisionId(row) || t("unavailable")}`,
    completed ? `${t("targetRevision")} : ${completed.targetName || t("unavailable")}` : null
  ].filter(Boolean).join(" | ");
  const internalIds = document.createElement("span");
  internalIds.textContent = [
    completed
      ? `${t("sourceGuid")} : ${internalRevisionGuid(row) || completed.revisionId || t("unavailable")}`
      : `${t("internalGuid")} : ${internalRevisionGuid(row) || t("unavailable")}`,
    completed ? `${t("targetGuid")} : ${completed.targetRevisionId || String(completed.targetId || "").split("/").at(-1) || t("unavailable")}` : null
  ].filter(Boolean).join(" | ");
  const location = document.createElement("span");
  location.textContent = [
    row.folderPath,
    row.componentTypeName,
    row.lifecycleState
  ].filter(Boolean).join(" | ");
  const desc = document.createElement("span");
  desc.textContent = row.description || "";
  text.append(name, revision, internalIds, location, desc);
  article.append(text);
  if (!selectable || state.kind !== "components") {
    const actions = document.createElement("div");
    actions.className = "migration-actions";
    if (!selectable) {
      const badge = document.createElement("span");
      badge.className = "migration-badge";
      badge.textContent = t("migrated");
      actions.append(badge);
    }
    if (state.kind === "footprints" && !selectable
      && state.footprintBindingDiagnostics[row.id]?.status === "affected") {
      const diagnostic = state.footprintBindingDiagnostics[row.id];
      const warning = document.createElement("span");
      warning.className = "model-binding-warning";
      warning.setAttribute("role", "img");
      warning.setAttribute("aria-label", t("footprintBindingWarning", { revision: diagnostic.embeddedRevisionId }));
      warning.title = t("footprintBindingWarning", { revision: diagnostic.embeddedRevisionId });
      warning.textContent = "⚠";
      actions.append(warning);
    }
    if ((state.kind === "symbols" || state.kind === "footprints") && !selectable) {
      const modelKind = state.kind;
      const chooseRevision = document.createElement("button");
      chooseRevision.type = "button";
      chooseRevision.textContent = t("chooseTargetRevision");
      chooseRevision.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        chooseRevision.disabled = true;
        try {
          const data = await api(`/api/migration-state/model-revisions?kind=${modelKind}&sourceId=${encodeURIComponent(row.id)}`);
          const chooser = document.createElement("div");
          const select = document.createElement("select");
          for (const model of data.revisions || []) {
            select.add(new Option([model.name, model.comment, model.lifecycleState]
              .filter(Boolean).join(" | "), model.id, model.selected, model.selected));
          }
          if (!select.options.length) throw new Error(t("noTargetRevisions"));
          const apply = document.createElement("button");
          apply.type = "button";
          apply.textContent = t("applyTargetRevision");
          apply.addEventListener("click", async (applyEvent) => {
            applyEvent.preventDefault();
            applyEvent.stopPropagation();
            apply.disabled = true;
            try {
              const result = await api("/api/migration-state/model-revisions", {
                method: "POST",
                body: JSON.stringify({ kind: modelKind, sourceId: row.id, targetId: select.value })
              });
              await loadMigrationState();
              render();
              log(`${t("targetRevision")} : ${result.targetName}`);
            } catch (error) {
              log(error.message, "ERROR");
              apply.disabled = false;
            }
          });
          chooser.append(select, apply);
          actions.replaceChild(chooser, chooseRevision);
        } catch (error) {
          log(error.message, "ERROR");
          chooseRevision.disabled = false;
        }
      });
      actions.append(chooseRevision);
    }
    if (state.kind === "components" && !selectable) {
      const restore = document.createElement("button");
      restore.type = "button";
      restore.className = "restore-migration";
      restore.textContent = t("restore");
      restore.title = t("restoreHint");
      restore.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!window.confirm(t("restoreConfirm"))) return;
        restore.disabled = true;
        try {
          await api("/api/migration-state/unmark", {
            method: "POST",
            body: JSON.stringify({ kind: "components", sourceId: row.id })
          });
          await loadMigrationState();
          render();
          log(`${t("restore")} : OK`);
        } catch (error) {
          log(error.message);
          restore.disabled = false;
        }
      });
      actions.append(restore);
    }
    article.append(actions);
  } else {
    const actions = document.createElement("div");
    actions.className = "migration-actions";
    const configure = document.createElement("button");
    configure.type = "button";
    configure.className = "configure-component";
    configure.textContent = t("mapParameters");
    configure.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!currentView().targetFolderId) {
        log(t("chooseFolder"), "WARNING", row.name || row.id);
        targetFolder.focus();
        return;
      }
      currentView().selected = new Set([row.id]);
      currentView().previewId = row.id;
      render();
      await openComponentMapping(row.id);
    });
    actions.append(configure);
    article.append(actions);
  }
  container.append(article);
}

function render() {
  const view = currentView();
  title.textContent = labels[state.kind];
  const pendingRows = filteredRows(false);
  const completedRows = filteredRows(true);
  const totalPending = (view.rows || []).filter((row) => !isCompleted(state.kind, row.id)).length;
  const totalCompleted = (view.rows || []).length - totalPending;
  count.textContent = view.rows
    ? t("displayed", { shown: pendingRows.length, total: totalPending })
    : t("listNotLoaded");
  migratedCount.textContent = view.rows
    ? t("displayed", { shown: completedRows.length, total: totalCompleted })
    : t("listNotLoaded");
  list.innerHTML = "";
  migratedList.innerHTML = "";
  for (const row of pendingRows) appendLibraryRow(list, row, true);
  for (const row of completedRows) appendLibraryRow(migratedList, row, false);
  mappingPanel.hidden = state.kind !== "components" || !state.mappingPreview;
  semiAutoPanel.hidden = state.kind !== "components";
  renderModelPreview();
  updateControls();
}

function renderTargetFolders() {
  const view = currentView();
  targetFolder.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = view.folders ? t("chooseFolder") : t("loadingFolders");
  targetFolder.append(placeholder);
  const selectedTargetCategory = state.kind === "components" && state.semiAuto.targetCategoryId
    ? state.semiAuto.categories?.target?.find((category) => category.id === state.semiAuto.targetCategoryId)
    : null;
  const folders = selectedTargetCategory?.folderIds?.length
    ? (view.folders || []).filter((folder) => selectedTargetCategory.folderIds.includes(folder.id))
    : (view.folders || []);
  for (const folder of folders) {
    const option = document.createElement("option");
    option.value = folder.id;
    const namingScheme = folder.effectiveItemNamingSchemeTemplate
      ? ` | ${folder.effectiveItemNamingSchemeTemplate}`
      : "";
    option.textContent = `${folder.path || folder.name}${namingScheme}`;
    targetFolder.append(option);
  }
  targetFolder.value = view.targetFolderId;
  updateControls();
}

async function loadTargetFolders(kind) {
  const view = state.views[kind];
  if (view.folders) {
    if (state.kind === kind) renderTargetFolders();
    return;
  }
  try {
    const data = await api(`/api/folders?kind=${kind}`);
    view.folders = data.rows;
    if (!view.folders.some((folder) => folder.id === view.targetFolderId)) view.targetFolderId = "";
    if (state.kind === kind) renderTargetFolders();
  } catch (error) {
    view.folders = [];
    if (state.kind === kind) renderTargetFolders();
    log(error.message);
  }
}

async function loadMigrationState() {
  state.completed = await api("/api/migration-state");
  void loadFootprintBindingDiagnostics();
  for (const kind of Object.keys(state.views)) {
    const view = state.views[kind];
    view.selected = new Set([...view.selected].filter((id) => !isCompleted(kind, id)));
  }
}

async function loadFootprintBindingDiagnostics() {
  try {
    const data = await api("/api/migration-state/footprint-bindings");
    state.footprintBindingDiagnostics = data.results || {};
    if (state.kind === "footprints") render();
  } catch (error) {
    log(error.message);
  }
}

function renderSemiAutoCategories() {
  const categories = state.semiAuto.categories;
  sourceCategory.replaceChildren(new Option(t("chooseCategory"), ""));
  targetCategory.replaceChildren(new Option(t("chooseCategory"), ""));
  for (const category of categories?.source || []) {
    const option = document.createElement("option");
    option.value = category.id;
    option.textContent = `${category.name} (${category.count})`;
    sourceCategory.append(option);
  }
  for (const category of categories?.target || []) {
    const option = document.createElement("option");
    option.value = category.id;
    option.textContent = [category.name, category.templateName].filter(Boolean).join(" | ");
    targetCategory.append(option);
  }
  targetCategory.value = state.semiAuto.targetCategoryId;
}

async function loadSemiAutoCategories(force = false) {
  if (state.semiAuto.categories && !force) return renderSemiAutoCategories();
  const categories = await api("/api/component-migration-categories");
  state.semiAuto.categories = categories;
  renderSemiAutoCategories();
}

function renderSemiAutoResults(data) {
  semiAutoResults.innerHTML = "";
  if (!data?.rows?.length) {
    semiAutoResults.textContent = t("noRemainingCategory");
    return;
  }
  const summary = document.createElement("p");
  summary.className = "semi-auto-summary";
  summary.textContent = `${data.count} composant(s) prepares sur ${data.available} restant(s) | ${data.template.name}`;
  semiAutoResults.append(summary);
  for (const row of data.rows) {
    const article = document.createElement("article");
    article.className = `semi-auto-row ${row.status}`;
    const body = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = row.name;
    const details = document.createElement("span");
    const symbolCount = row.recommendations?.symbols?.length || 0;
    const footprintCount = row.recommendations?.footprints?.length || 0;
    details.textContent = row.error || `${symbolCount} symbole(s) candidat(s), ${footprintCount} empreinte(s), ${row.unresolvedParameters?.length || 0} parametre(s) vide(s)`;
    body.append(name, details);
    article.append(body);
    if (row.status !== "failed") {
      const configure = document.createElement("button");
      configure.type = "button";
      configure.textContent = t("verify");
      configure.addEventListener("click", () => openComponentMapping(row.id));
      article.append(configure);
    }
    semiAutoResults.append(article);
  }
}

function renderWorkspaceConfiguration(config) {
  sourceWorkspaceSelect.replaceChildren();
  for (const workspace of config.sources || []) {
    const option = new Option(workspace.name, workspace.id);
    sourceWorkspaceSelect.append(option);
  }
  sourceWorkspaceSelect.value = config.activeSourceWorkspaceId || "";
  const sourceName = (config.sources || []).find((workspace) => workspace.id === config.activeSourceWorkspaceId)?.name || "Source";
  const targetName = config.target?.name || "Target";
  document.querySelector("#workspaceRoute").textContent = `${sourceName} -> ${targetName}`;
  document.querySelector("#targetFolderLabel").textContent = `${t("targetFolder")} - ${targetName}`;
}

function settingsField(labelKey, value, { type = "text", role, placeholder = "", required = false } = {}) {
  const label = document.createElement("label");
  const caption = document.createElement("span");
  caption.textContent = t(labelKey);
  const input = document.createElement("input");
  input.type = type;
  input.value = value || "";
  input.dataset.role = role || labelKey;
  input.placeholder = placeholder;
  input.required = required;
  label.append(caption, input);
  return label;
}

function workspaceEditor(workspace, { source = false } = {}) {
  const editor = document.createElement("article");
  editor.className = "workspace-editor";
  editor.dataset.workspaceId = workspace.id || "";
  if (source) {
    const editorHead = document.createElement("div");
    editorHead.className = "workspace-editor-head";
    const active = document.createElement("label");
    active.className = "check-field";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "activeSourceWorkspace";
    radio.value = workspace.id || "";
    radio.checked = workspace.id === state.settings?.activeSourceWorkspaceId;
    active.append(radio, document.createTextNode(t("activeAtStartup")));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-workspace";
    remove.textContent = t("remove");
    remove.addEventListener("click", () => {
      editor.remove();
      const remaining = sourceWorkspaceEditors.querySelectorAll(".workspace-editor");
      if (remaining.length && !sourceWorkspaceEditors.querySelector('input[name="activeSourceWorkspace"]:checked')) {
        remaining[0].querySelector('input[name="activeSourceWorkspace"]').checked = true;
      }
    });
    editorHead.append(active, remove);
    editor.append(editorHead);
  }
  const grid = document.createElement("div");
  grid.className = "settings-grid";
  grid.append(
    settingsField("workspaceName", workspace.name, { role: "name", required: true }),
    settingsField("workspaceId", workspace.id, { role: "id", required: true }),
    settingsField("graphqlUrl", workspace.apiUrl, { type: "url", role: "apiUrl", required: true }),
    settingsField("uploadUrl", workspace.filesUploadUrl, { type: "url", role: "filesUploadUrl" }),
    settingsField("accessToken", "", {
      type: "password", role: "accessToken",
      placeholder: workspace.tokenConfigured ? t("tokenStored") : t("accessToken")
    })
  );
  grid.lastElementChild.classList.add("wide-field");
  editor.append(grid);
  return editor;
}

function renderSettings(settings) {
  state.settings = settings;
  sourceWorkspaceEditors.replaceChildren(...settings.sources.map((workspace) => workspaceEditor(workspace, { source: true })));
  targetWorkspaceEditor.replaceChildren(...workspaceEditor(settings.target).childNodes);
  document.querySelector("#settingsCacheTtl").value = settings.application.cacheTtlHours;
  document.querySelector("#settingsBridgeUrl").value = settings.application.designerBridgeUrl || "";
  const bridgeToken = document.querySelector("#settingsBridgeToken");
  bridgeToken.value = "";
  bridgeToken.placeholder = settings.application.designerBridgeTokenConfigured ? t("tokenStored") : t("keepToken");
  document.querySelector("#settingsSystemCa").checked = settings.application.useSystemCa;
  document.querySelector("#settingsError").textContent = "";
}

function readWorkspaceEditor(editor) {
  return Object.fromEntries([...editor.querySelectorAll("[data-role]")]
    .map((input) => [input.dataset.role, input.value.trim()]));
}

async function openSettings() {
  const settings = await api("/api/settings");
  renderSettings(settings);
  settingsDialog.showModal();
}

document.querySelector("#openSettings").addEventListener("click", () => {
  openSettings().catch((error) => log(error.message));
});
document.querySelector("#closeSettings").addEventListener("click", () => settingsDialog.close());
document.querySelector("#cancelSettings").addEventListener("click", () => settingsDialog.close());
document.querySelector("#addSourceWorkspace").addEventListener("click", () => {
  const index = sourceWorkspaceEditors.children.length + 1;
  sourceWorkspaceEditors.append(workspaceEditor({ id: `SOURCE_${index}`, name: `Source ${index}` }, { source: true }));
});

document.querySelector("#settingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const saveButton = document.querySelector("#saveSettings");
  const errorElement = document.querySelector("#settingsError");
  saveButton.disabled = true;
  errorElement.textContent = "";
  try {
    const sourceEditors = [...sourceWorkspaceEditors.querySelectorAll(":scope > .workspace-editor")];
    const activeEditor = sourceWorkspaceEditors.querySelector('input[name="activeSourceWorkspace"]:checked')?.closest(".workspace-editor");
    const sources = sourceEditors.map(readWorkspaceEditor);
    const activeIndex = activeEditor ? sourceEditors.indexOf(activeEditor) : 0;
    const body = {
      sources,
      activeSourceWorkspaceId: sources[activeIndex]?.id,
      target: readWorkspaceEditor(targetWorkspaceEditor),
      application: {
        cacheTtlHours: Number(document.querySelector("#settingsCacheTtl").value),
        designerBridgeUrl: document.querySelector("#settingsBridgeUrl").value.trim(),
        designerBridgeToken: document.querySelector("#settingsBridgeToken").value.trim(),
        useSystemCa: document.querySelector("#settingsSystemCa").checked
      }
    };
    await api("/api/settings", { method: "POST", body: JSON.stringify(body) });
    log(t("settingsSaved"));
    settingsDialog.close();
    window.setTimeout(() => window.location.reload(), 300);
  } catch (error) {
    errorElement.textContent = error.message;
  } finally {
    saveButton.disabled = false;
  }
});

sourceWorkspaceSelect.addEventListener("change", async () => {
  sourceWorkspaceSelect.disabled = true;
  try {
    log(t("switchingSource"));
    await api("/api/source-workspace", { method: "POST", body: JSON.stringify({ id: sourceWorkspaceSelect.value }) });
    window.location.reload();
  } catch (error) {
    sourceWorkspaceSelect.disabled = false;
    log(error.message);
  }
});

document.querySelector("#languageSelect").addEventListener("change", (event) => {
  setLanguage(event.target.value);
  translateDocument();
  renderWorkspaceConfiguration(state.config);
  render();
  renderTargetFolders();
  if (state.semiAuto.categories) renderSemiAutoCategories();
  updateTokenStatus("source", state.config.sourceTokenConfigured);
  updateTokenStatus("target", state.config.targetTokenConfigured);
});

async function boot() {
  try {
    const config = await api("/api/config");
    state.config = config;
    renderWorkspaceConfiguration(config);
    updateTokenStatus("source", config.sourceTokenConfigured);
    updateTokenStatus("target", config.targetTokenConfigured, null, config.targetUsesLegacyToken);
    checkDesignerBridge();
    log(config);
    renderTargetFolders();
    await Promise.all([loadMigrationState(), loadTargetFolders(state.kind)]);
    await loadView("symbols", false, { silent: false });
    await Promise.all([
      loadView("footprints", false, { silent: true }),
      loadView("components", false, { silent: true })
    ]);
    await loadSemiAutoCategories();
  } catch (error) {
    log(error.message);
  }
}

async function checkDesignerBridge({ report = false } = {}) {
  const element = document.querySelector("#designerStatus");
  const button = document.querySelector("#testDesignerBridge");
  element.className = "status";
  element.textContent = t("checkingBridge");
  button.disabled = true;
  try {
    const status = await api("/api/designer/status");
    element.textContent = `${t("bridgeConnected")}${status.version ? ` (${status.version})` : ""}`;
    element.classList.add("status-ok");
    if (report) log({ message: "Bridge Altium Designer operationnel", ...status });
    return status;
  } catch (error) {
    element.textContent = t("bridgeUnavailable");
    element.classList.add("status-error");
    element.title = error.message;
    if (report) log(`Bridge Altium Designer indisponible : ${error.message}`);
    return null;
  } finally {
    button.disabled = false;
  }
}

function updateTokenStatus(workspace, configured, connected = null, legacy = false) {
  const element = document.querySelector(`#${workspace}Status`);
  const label = workspace === "source"
    ? (state.config.sources || []).find((item) => item.id === state.config.activeSourceWorkspaceId)?.name || "Source"
    : state.config.target?.name || "Target";
  element.className = "status";
  if (!configured) {
    element.textContent = t("tokenMissing", { name: label });
    element.classList.add("status-error");
  } else if (connected === true) {
    element.textContent = t("tokenOk", { name: label });
    element.classList.add("status-ok");
  } else if (connected === false) {
    element.textContent = t("tokenFailed", { name: label });
    element.classList.add("status-error");
  } else {
    element.textContent = t("tokenReady", { name: label });
  }
}

document.querySelectorAll("[data-action]").forEach((button) => {
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const action = button.dataset.action;
      const workspace = button.dataset.workspace;
      const data = await api(`/api/${action}?workspace=${workspace}`);
      if (action === "test") updateTokenStatus(workspace, true, true);
      log(data);
    } catch (error) {
      if (button.dataset.action === "test") updateTokenStatus(button.dataset.workspace, true, false);
      log(error.message);
    } finally {
      button.disabled = false;
    }
  });
});

document.querySelectorAll(".step").forEach((button) => {
  button.addEventListener("click", () => {
    rememberCurrentMappingDraft();
    currentView().filter = filter.value;
    document.querySelector(".step.active").classList.remove("active");
    button.classList.add("active");
    state.kind = button.dataset.kind;
    filter.value = currentView().filter;
    render();
    renderTargetFolders();
    loadTargetFolders(state.kind);
    if (state.kind === "components") loadSemiAutoCategories().catch((error) => log(error.message));
  });
});

async function loadView(kind, forceRefresh = false, { silent = false } = {}) {
  const view = state.views[kind];
  try {
    if (!silent) log(`Chargement ${labels[kind]}...`);
    const refresh = forceRefresh ? "&refresh=true" : "";
    const data = await api(`/api/list?kind=${kind}&workspace=source${refresh}`);
    view.rows = data.rows;
    view.selected = new Set([...view.selected].filter((id) => view.rows.some((row) => row.id === id)
      && !isCompleted(kind, id)));
    if (state.kind === kind) render();
    if (!silent) {
      log({
        type: labels[kind],
        elements: data.rows.length,
        cache: data.cache?.source || (data.cache?.hit ? "utilise" : "network"),
        cachedAt: data.cache?.cachedAt
      });
    }
  } catch (error) {
    log(error.message);
  }
}

document.querySelector("#load").addEventListener("click", () => loadView(state.kind));
document.querySelector("#refreshList").addEventListener("click", () => loadView(state.kind, true));

document.querySelector("#selectAll").addEventListener("click", () => {
  const view = currentView();
  for (const row of filteredRows(false)) view.selected.add(row.id);
  render();
});

document.querySelector("#clearSelection").addEventListener("click", () => {
  currentView().selected.clear();
  render();
});

function renderMapping(preview) {
  state.mappingPreview = preview;
  document.querySelector("#mappingTemplate").textContent = [
    preview.template.category,
    preview.template.name,
    preview.template.revisionId,
    preview.template.itemNamingTemplate
  ].filter(Boolean).join(" | ");
  componentSymbol.replaceChildren(new Option(t("chooseSymbol"), ""));
  const recommendedSymbols = new Set((preview.recommendations?.symbols || []).map((model) => model.id));
  const symbolModels = [...(preview.modelOptions?.symbols || [])].sort((left, right) => (
    Number(recommendedSymbols.has(right.id)) - Number(recommendedSymbols.has(left.id))
  ));
  for (const model of symbolModels) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = [recommendedSymbols.has(model.id) ? t("recommended") : "",
      model.origin === "migration" ? t("migrated") : t("existing"),
      `Name : ${explorerName(model) || t("unavailable")}`,
      `${t("revision")} : ${explorerRevisionId(model) || t("unavailable")}`,
      model.lifecycleState, model.folderPath]
      .filter(Boolean).join(" | ");
    componentSymbol.append(option);
  }
  componentSymbol.value = preview.models?.symbolId || "";
  componentFootprints.innerHTML = "";
  const selectedFootprints = new Set(preview.models?.footprintIds || []);
  const recommendedFootprints = new Set((preview.recommendations?.footprints || []).map((model) => model.id));
  const defaultFootprintId = preview.models?.defaultFootprintId
    || (preview.models?.footprintIds || []).find((id) => (
      isIpcMediumDensity((preview.modelOptions?.footprints || []).find((model) => model.id === id))
    ));
  const footprintModels = [...(preview.modelOptions?.footprints || [])].sort((left, right) => (
    Number(right.id === defaultFootprintId) - Number(left.id === defaultFootprintId)
    || Number(recommendedFootprints.has(right.id)) - Number(recommendedFootprints.has(left.id))
  ));
  for (const model of footprintModels) {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = model.id;
    checkbox.checked = selectedFootprints.has(model.id);
    const text = document.createElement("span");
    text.textContent = [model.id === defaultFootprintId ? t("defaultMedium") : "",
      recommendedFootprints.has(model.id) ? t("recommended") : "",
      model.origin === "migration" ? t("migrated") : t("existing"),
      `Name : ${explorerName(model) || t("unavailable")}`,
      `${t("revision")} : ${explorerRevisionId(model) || t("unavailable")}`,
      model.folderPath]
      .filter(Boolean).join(" | ");
    label.append(checkbox, text);
    componentFootprints.append(label);
  }
  if (!(preview.modelOptions?.footprints || []).length) {
    componentFootprints.textContent = t("noComponentModels");
  }
  document.querySelector("#sourceSymbol").textContent = preview.sourceModels?.symbols?.length
    ? `${state.config.sources?.find((item) => item.id === state.config.activeSourceWorkspaceId)?.name || "Source"} : ${preview.sourceModels.symbols.map((model) => (
      `Name : ${explorerName(model) || t("unavailable")} | ${t("revision")} : ${explorerRevisionId(model) || t("unavailable")}`
    )).join(", ")}`
    : "Aucun symbole dans le composant source";
  document.querySelector("#sourceFootprints").textContent = preview.sourceModels?.footprints?.length
    ? `${state.config.sources?.find((item) => item.id === state.config.activeSourceWorkspaceId)?.name || "Source"} : ${preview.sourceModels.footprints.map((model) => (
      `Name : ${explorerName(model) || t("unavailable")} | ${t("revision")} : ${explorerRevisionId(model) || t("unavailable")}`
    )).join(", ")}`
    : "Aucune empreinte dans le composant source";
  mappingRows.innerHTML = "";
  const sourceByKey = new Map(preview.sourceParameters.map((source) => [source.key, source]));
  for (const target of preview.targetParameters) {
    const tr = document.createElement("tr");
    const targetCell = document.createElement("td");
    targetCell.textContent = target.name;
    if (target.required) {
      const required = document.createElement("span");
      required.className = "required-mark";
      required.textContent = "*";
      targetCell.append(required);
    }
    const typeCell = document.createElement("td");
    typeCell.textContent = target.definitionType?.toLowerCase() === "dictionary"
      ? `${target.dataType} / Dictionnaire`
      : target.dataType;
    const sourceCell = document.createElement("td");
    const select = document.createElement("select");
    select.dataset.targetName = target.name;
    select.dataset.role = "mapping";
    select.dataset.emptyLabel = target.defaultValue ? `Default: ${target.defaultValue}` : t("noSource");
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = select.dataset.emptyLabel;
    select.append(empty);
    for (const source of preview.sourceParameters) {
      const option = document.createElement("option");
      option.value = source.key;
      option.textContent = sourceOptionLabel(source);
      select.append(option);
    }
    select.value = preview.mappings[target.name] || "";
    sourceCell.append(select);

    const valueCell = document.createElement("td");
    const mappedSourceValue = sourceValueForTarget(sourceByKey.get(select.value), target);
    const initialValue = Object.hasOwn(preview.resolvedValues || {}, target.name)
      ? preview.resolvedValues[target.name]
      : mappedSourceValue;
    let valueControl;
    if (target.definitionType?.toLowerCase() === "dictionary") {
      valueControl = document.createElement("select");
      const emptyValue = document.createElement("option");
      emptyValue.value = "";
      emptyValue.textContent = target.required ? t("chooseValue") : t("noValue");
      valueControl.append(emptyValue);
      for (const dictionaryValue of target.dictionaryValues || []) {
        const option = document.createElement("option");
        option.value = dictionaryValue;
        option.textContent = dictionaryValue;
        valueControl.append(option);
      }
      valueControl.value = (target.dictionaryValues || []).includes(initialValue) ? initialValue : "";
    } else {
      valueControl = document.createElement("input");
      valueControl.type = "text";
      valueControl.value = initialValue;
    }
    valueControl.dataset.targetName = target.name;
    valueControl.dataset.role = "value";
    const valueEditor = document.createElement("div");
    valueEditor.className = "parameter-value-editor";
    valueEditor.append(valueControl);
    const enrichButton = document.createElement("button");
    enrichButton.type = "button";
    enrichButton.className = "parameter-enrich";
    enrichButton.textContent = t("enrich");
    enrichButton.title = `Rechercher ${target.name} avec Manufacturer Part Search et SiliconExpert`;
    enrichButton.disabled = !state.config?.altiumDesignerBridgeConfigured;
    const updateEnrichVisibility = () => {
      enrichButton.hidden = Boolean(select.value && String(valueControl.value || "").trim());
    };
    valueControl.addEventListener("input", updateEnrichVisibility);
    valueControl.addEventListener("change", updateEnrichVisibility);
    select.addEventListener("change", updateEnrichVisibility);
    enrichButton.addEventListener("click", () => (
      enrichParameterWithDesigner(target, select, valueControl, enrichButton)
    ));
    valueEditor.append(enrichButton);
    updateEnrichVisibility();
    valueCell.append(valueEditor);
    select.addEventListener("change", () => {
      const nextValue = sourceValueForTarget(sourceByKey.get(select.value), target);
      if (valueControl.tagName === "SELECT") {
        valueControl.value = (target.dictionaryValues || []).includes(nextValue) ? nextValue : "";
      } else {
        valueControl.value = nextValue;
      }
      valueControl.dispatchEvent(new Event("change"));
      refreshMappingSourceOptions(preview);
    });
    tr.append(targetCell, typeCell, sourceCell, valueCell);
    mappingRows.append(tr);
  }
  refreshMappingSourceOptions(preview);
  mappingPanel.hidden = false;
}

function currentMappingForm() {
  return {
    mappings: Object.fromEntries([...mappingRows.querySelectorAll('[data-role="mapping"]')]
      .map((select) => [select.dataset.targetName, select.value || null])),
    values: Object.fromEntries([...mappingRows.querySelectorAll('[data-role="value"]')]
      .map((control) => [control.dataset.targetName, control.value])),
    models: {
      symbolId: componentSymbol.value || null,
      footprintIds: [...componentFootprints.querySelectorAll('input[type="checkbox"]:checked')]
        .map((checkbox) => checkbox.value)
    }
  };
}

function mappingDraftKey(componentId, targetFolderId, templateRevisionId) {
  return `${componentId}|${targetFolderId}|${templateRevisionId || ""}`;
}

function rememberCurrentMappingDraft() {
  if (state.kind !== "components" || !state.mappingPreview) return;
  const key = mappingDraftKey(state.mappingPreview.componentId,
    state.views.components.targetFolderId, state.mappingPreview.template.revisionId);
  state.mappingDrafts.set(key, currentMappingForm());
}

async function openComponentMapping(componentId) {
  const view = currentView();
  if (!componentId || !view.targetFolderId) return;
  rememberCurrentMappingDraft();
  configureMappingButton.disabled = true;
  try {
    log("Chargement du template cible et des parametres...");
    const preview = await api("/api/component-mapping-preview", {
      method: "POST",
      body: JSON.stringify({ componentId, targetFolderId: view.targetFolderId })
    });
    const draft = state.mappingDrafts.get(mappingDraftKey(componentId,
      view.targetFolderId, preview.template.revisionId));
    if (draft) {
      preview.mappings = { ...preview.mappings, ...draft.mappings };
      preview.resolvedValues = { ...preview.resolvedValues, ...draft.values };
      preview.models = { ...preview.models, ...draft.models };
    }
    renderMapping(preview);
    mappingPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    log({
      message: "Mapping charge",
      template: preview.template,
      parameters: preview.targetParameters.length,
      warnings: preview.warnings || []
    });
  } catch (error) {
    log(error.message);
  } finally {
    updateControls();
  }
}

configureMappingButton.addEventListener("click", async () => {
  await openComponentMapping([...currentView().selected][0]);
});

targetCategory.addEventListener("change", () => {
  state.semiAuto.targetCategoryId = targetCategory.value;
  const category = state.semiAuto.categories?.target?.find((item) => item.id === targetCategory.value);
  if (category?.folderIds?.length && !category.folderIds.includes(currentView().targetFolderId)) {
    currentView().targetFolderId = "";
  }
  renderTargetFolders();
});

document.querySelector("#prepareSemiAuto").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const view = state.views.components;
  if (!sourceCategory.value) return log(t("sourceCategory"));
  if (!targetCategory.value) return log(t("targetCategory"));
  if (!view.targetFolderId) return log(t("chooseComponentFolder"));
  button.disabled = true;
  try {
    log(t("analyzingBatch"));
    const data = await api("/api/semi-auto/prepare", {
      method: "POST",
      body: JSON.stringify({
        sourceCategoryId: sourceCategory.value,
        targetCategoryId: targetCategory.value,
        targetFolderId: view.targetFolderId,
        batchSize: batchSize.value
      })
    });
    state.semiAuto.prepared = data;
    view.selected = new Set(data.rows.filter((row) => row.status !== "failed").map((row) => row.id));
    renderSemiAutoResults(data);
    render();
    log({ message: "Lot prepare. Verifiez chaque composant avant migration.", count: data.count,
      available: data.available, template: data.template });
  } catch (error) {
    log(error.message);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#refreshDictionaries").addEventListener("click", async (event) => {
  if (!state.mappingPreview) return;
  const button = event.currentTarget;
  const draft = currentMappingForm();
  button.disabled = true;
  try {
    log(t("refreshingDictionariesStatus"));
    const preview = await api("/api/dictionary-values/refresh", {
      method: "POST",
      body: JSON.stringify({
        componentId: state.mappingPreview.componentId,
        targetFolderId: currentView().targetFolderId
      })
    });
    preview.mappings = draft.mappings;
    preview.values = draft.values;
    preview.resolvedValues = { ...preview.resolvedValues, ...draft.values };
    preview.models = draft.models;
    renderMapping(preview);
    log({
      message: "Dictionnaires actualises",
      refreshedAt: preview.dictionariesRefreshedAt
    });
  } catch (error) {
    log(error.message);
  } finally {
    button.disabled = false;
  }
});

async function enrichParameterWithDesigner(target, sourceControl, control, button) {
  if (!state.mappingPreview || (sourceControl.value && control.value)) return;
  button.disabled = true;
  try {
    const form = currentMappingForm();
    log({ message: "Recherche Designer lancee", parameter: target.name,
      context: Object.fromEntries(Object.entries(form.values).filter(([, value]) => String(value).trim())) });
    const data = await api("/api/component-enrichment", {
      method: "POST",
      body: JSON.stringify({
        componentId: state.mappingPreview.componentId,
        targetFolderId: currentView().targetFolderId,
        parameterName: target.name,
        searchContext: form.values
      })
    });
    const value = data.values?.[target.name];
    const validation = data.validations?.[target.name] || null;
    let applied = false;
    let rejectedValue = null;
    let manualReview = false;
    if (typeof value === "string" && value) {
      if (control.tagName === "SELECT" && ![...control.options].some((option) => option.value === value)) {
        rejectedValue = value;
      } else {
        const accepted = !validation?.requiresConfirmation || window.confirm(t("confirmTextEnrichment", {
          name: target.name,
          value: validation.rawValue || value
        }));
        control.value = accepted ? value : (validation?.rawValue || value);
        control.dispatchEvent(new Event("change"));
        applied = accepted;
        manualReview = !accepted;
        if (manualReview) {
          control.focus();
          control.select?.();
        }
      }
    }
    log({
      message: applied ? "Valeur Designer appliquee" : "Recherche Designer terminee sans valeur applicable",
      parameter: target.name,
      query: data.search?.query || null,
      selectedPart: data.search?.selectedPart || null,
      providers: data.search?.matches?.map((match) => match.provider).filter(Boolean) || [],
      siliconExpert: {
        available: data.search?.siliconExpertAvailable,
        requested: data.search?.siliconExpertRequested
      },
      value: applied ? value : null,
      rawValue: validation?.rawValue || null,
      siValidated: validation?.siValidated || false,
      manualReview,
      rejectedDictionaryValue: rejectedValue,
      availableParameters: data.search?.availableParameters || [],
      warnings: data.warnings
    });
  } catch (error) {
    log(error.message);
  } finally {
    button.disabled = !state.config?.altiumDesignerBridgeConfigured;
  }
}

async function saveCurrentMapping({ report = true } = {}) {
  if (!state.mappingPreview) return null;
  const { mappings, values, models } = currentMappingForm();
  const data = await api("/api/parameter-mappings", {
    method: "POST",
    body: JSON.stringify({
      templateId: state.mappingPreview.template.id,
      templateRevisionId: state.mappingPreview.template.revisionId,
      componentId: state.mappingPreview.componentId,
      targetFolderId: currentView().targetFolderId,
      mappings,
      values,
      models
    })
  });
  state.mappingPreview.mappings = mappings;
  state.mappingPreview.values = values;
  state.mappingPreview.models = models;
  if (report) {
    log({
      message: "Mapping et modeles enregistres",
      template: state.mappingPreview.template,
      symbol: componentSymbol.selectedOptions[0]?.textContent || null,
      footprints: [...componentFootprints.querySelectorAll('input[type="checkbox"]:checked')]
        .map((checkbox) => checkbox.nextElementSibling?.textContent),
      mappings: data.mappings,
      values: data.values
    });
  }
  return data;
}

document.querySelector("#saveMapping").addEventListener("click", async (event) => {
  if (!state.mappingPreview) return;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await saveCurrentMapping();
  } catch (error) {
    log(error.message);
  } finally {
    button.disabled = false;
  }
});

migrateButton.addEventListener("click", async () => {
  try {
    const view = currentView();
    if (view.selected.size === 0) return log("Aucun element selectionne.");
    if (!view.targetFolderId) {
      log(t("chooseFolder"));
      targetFolder.focus();
      return;
    }
    migrateButton.disabled = true;
    if (state.kind === "components"
      && state.mappingPreview
      && view.selected.has(state.mappingPreview.componentId)) {
      await saveCurrentMapping({ report: false });
    }
    const dryRun = document.querySelector("#dryRun").checked;
    const data = await api("/api/migrate", {
      method: "POST",
      body: JSON.stringify({
        kind: state.kind,
        ids: [...view.selected],
        dryRun,
        targetFolderId: view.targetFolderId
      })
    });
    if (!dryRun && data.results.some((result) => ["created", "released", "already-migrated"].includes(result.status))) {
      await loadMigrationState();
      render();
    }
    log(data);
  } catch (error) {
    log(error.message);
  } finally {
    updateControls();
  }
});

filter.addEventListener("input", () => {
  currentView().filter = filter.value;
  render();
});

targetFolder.addEventListener("change", () => {
  rememberCurrentMappingDraft();
  currentView().targetFolderId = targetFolder.value;
  state.mappingPreview = null;
  mappingPanel.hidden = true;
  updateControls();
});

document.querySelector("#restartApp").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = t("restarting");
  try {
    const config = await api("/api/restart", { method: "POST", body: "{}" });
    updateTokenStatus("source", config.sourceTokenConfigured);
    updateTokenStatus("target", config.targetTokenConfigured, null, config.targetUsesLegacyToken);
    log({ message: t("restarted"), ...config });
    window.setTimeout(() => window.location.reload(), 500);
  } catch (error) {
    log(error.message);
    button.disabled = false;
    button.textContent = t("restart");
  }
});

document.querySelector("#testDesignerBridge").addEventListener("click", () => {
  checkDesignerBridge({ report: true });
});

boot();
