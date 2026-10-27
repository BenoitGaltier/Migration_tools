import * as THREE from "/vendor/three/three.module.js";
import { OrbitControls } from "/vendor/three/addons/controls/OrbitControls.js";

const activeScenes = new WeakMap();

function dispose(container) {
  const active = activeScenes.get(container);
  if (!active) return;
  active.resizeObserver.disconnect();
  active.controls.dispose();
  active.renderer.dispose();
  activeScenes.delete(container);
  container.replaceChildren();
}

function normalizeLayerSelection(layers) {
  if (layers == null) return null;
  return new Set([...layers].map((layer) => String(layer)));
}

function material(color, options = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: options.roughness ?? 0.42,
    metalness: options.metalness ?? 0.08,
    transparent: (options.opacity ?? 1) < 1,
    opacity: options.opacity ?? 1
  });
}

function addBox(group, width, height, depth, x, y, z, color, rotation = 0, options = {}) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(Math.max(width, 0.02), Math.max(height, 0.02), Math.max(depth, 0.02)),
    material(color, options)
  );
  mesh.position.set(x, y, z);
  mesh.rotation.y = THREE.MathUtils.degToRad(-rotation);
  group.add(mesh);
  return mesh;
}

function addPad(group, pad) {
  const height = 0.12;
  const layer = Number(pad.layer);
  const isPaste = layer === 35 || layer === 36;
  const isSolder = layer === 37 || layer === 38;
  const color = isPaste ? "#8c939c" : isSolder ? "#b14fc4" : "#c89b3c";
  const y = isPaste ? 0.23 : isSolder ? 0.195 : 0.14;
  const options = isSolder
    ? { metalness: 0.02, roughness: 0.55, opacity: 0.58 }
    : isPaste ? { metalness: 0.3, roughness: 0.48, opacity: 0.78 }
      : { metalness: 0.68, roughness: 0.24 };
  const round = /round|circle/i.test(pad.shape);
  let mesh;
  if (round) {
    mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(Math.max(pad.width, pad.height) / 2, Math.max(pad.width, pad.height) / 2, height, 32),
      material(color, options)
    );
    mesh.position.set(pad.x, height / 2 + y, -pad.y);
    group.add(mesh);
  } else {
    mesh = addBox(group, pad.width, height, pad.height, pad.x, height / 2 + y, -pad.y,
      color, pad.rotation, options);
  }
  if (pad.hole > 0) {
    const hole = new THREE.Mesh(
      new THREE.CylinderGeometry(pad.hole / 2, pad.hole / 2, height + 0.08, 28),
      material("#14191f", { roughness: 0.9 })
    );
    hole.position.set(pad.x, height / 2 + 0.1, -pad.y);
    group.add(hole);
  }
}

function addTrack(group, track) {
  const dx = track.x2 - track.x1;
  const dz = -(track.y2 - track.y1);
  const length = Math.hypot(dx, dz);
  const mesh = addBox(group, length, 0.055, track.width,
    (track.x1 + track.x2) / 2, 0.16, -(track.y1 + track.y2) / 2,
    "#e8e9dd", 0, { roughness: 0.7 });
  mesh.rotation.y = -Math.atan2(dz, dx);
}

function addBody(group, body, fallbackBounds) {
  const points = body.outline?.length ? body.outline : [
    [fallbackBounds.minX, fallbackBounds.minY], [fallbackBounds.maxX, fallbackBounds.maxY]
  ];
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const height = Math.max(body.height || 0, 0.3);
  addBox(group, maxX - minX, height, maxY - minY,
    (minX + maxX) / 2, body.standoff + height / 2 + 0.18, -(minY + maxY) / 2,
    body.color || "#59616b", body.rotation || 0, { opacity: body.opacity ?? 1, roughness: 0.5 });
}

function visualBounds(data) {
  const xs = [];
  const ys = [];
  for (const pad of data.pads || []) {
    xs.push(pad.x - pad.width / 2, pad.x + pad.width / 2);
    ys.push(pad.y - pad.height / 2, pad.y + pad.height / 2);
  }
  for (const via of data.vias || []) {
    xs.push(via.x - via.width / 2, via.x + via.width / 2);
    ys.push(via.y - via.height / 2, via.y + via.height / 2);
  }
  for (const track of data.tracks || []) {
    xs.push(track.x1, track.x2);
    ys.push(track.y1, track.y2);
  }
  for (const fill of data.fills || []) {
    xs.push(fill.x1, fill.x2);
    ys.push(fill.y1, fill.y2);
  }
  for (const body of data.bodies || []) {
    for (const point of body.outline || []) {
      xs.push(point[0]);
      ys.push(point[1]);
    }
  }
  if (!xs.length || !ys.length) return data.bounds;
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

export async function loadFootprintScene(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  return response.json();
}

export async function renderFootprint3d(container, source, visibleLayers = null) {
  dispose(container);
  const data = typeof source === "string" ? await loadFootprintScene(source) : source;
  const bounds = visualBounds(data);
  const width = Math.max(bounds.maxX - bounds.minX, 1);
  const depth = Math.max(bounds.maxY - bounds.minY, 1);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = -(bounds.minY + bounds.maxY) / 2;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#f2f4f6");
  const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 5000);
  const extent = Math.max(width, depth);
  camera.position.set(centerX + extent * 1.15, extent * 0.9, centerZ + extent * 1.15);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.replaceChildren(renderer.domElement);

  scene.add(new THREE.HemisphereLight("#ffffff", "#5b6670", 2.1));
  const keyLight = new THREE.DirectionalLight("#fff8e9", 2.8);
  keyLight.position.set(extent, extent * 1.8, extent);
  scene.add(keyLight);

  const root = new THREE.Group();
  scene.add(root);
  addBox(root, width + 1, 0.16, depth + 1, centerX, 0, centerZ, "#17624d", 0, { roughness: 0.66 });
  const layerGroups = new Map();
  const layerGroup = (layer) => {
    const key = String(layer);
    if (!layerGroups.has(key)) {
      const group = new THREE.Group();
      group.userData.layer = key;
      layerGroups.set(key, group);
      root.add(group);
    }
    return layerGroups.get(key);
  };
  for (const pad of data.pads || []) addPad(layerGroup(pad.layer), pad);
  for (const via of data.vias || []) addPad(layerGroup(via.layer), via);
  for (const track of data.tracks || []) addTrack(layerGroup(track.layer), track);
  for (const fill of data.fills || []) {
    addBox(layerGroup(fill.layer), Math.abs(fill.x2 - fill.x1), 0.05, Math.abs(fill.y2 - fill.y1),
      (fill.x1 + fill.x2) / 2, 0.16, -(fill.y1 + fill.y2) / 2,
      "#e8e9dd", fill.rotation || 0, { roughness: 0.7 });
  }
  for (const body of data.bodies || []) addBody(layerGroup(body.layer), body, bounds);

  if (!(data.bodies || []).length) {
    addBox(root, width * 0.5, Math.max(0.45, extent * 0.18), depth * 0.5,
      centerX, Math.max(0.45, extent * 0.18) / 2 + 0.18, centerZ, "#38404a", 0, { roughness: 0.55 });
  }

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(centerX, 0, centerZ);
  controls.enableDamping = false;
  controls.minDistance = extent * 0.35;
  controls.maxDistance = extent * 7;

  const resize = () => {
    const rect = container.getBoundingClientRect();
    const canvasWidth = Math.max(1, Math.floor(rect.width));
    const canvasHeight = Math.max(1, Math.floor(rect.height));
    renderer.setSize(canvasWidth, canvasHeight, false);
    camera.aspect = canvasWidth / canvasHeight;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  controls.addEventListener("change", () => renderer.render(scene, camera));
  const updateLayers = (layers) => {
    const selected = normalizeLayerSelection(layers);
    for (const [layer, group] of layerGroups) group.visible = selected === null || selected.has(layer);
    renderer.render(scene, camera);
  };
  const active = { renderer, controls, resizeObserver, updateLayers };
  activeScenes.set(container, active);
  updateLayers(visibleLayers);
  return data;
}

export function setFootprint3dLayers(container, visibleLayers) {
  activeScenes.get(container)?.updateLayers(visibleLayers);
}

export function disposeFootprint3d(container) {
  dispose(container);
}
