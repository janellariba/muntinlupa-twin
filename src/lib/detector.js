// detector.js
// Runs your YOLO fire/smoke model (exported to ONNX) in the browser with onnxruntime-web.
// - The model file is chosen by the user ("Load model") and kept in this browser's IndexedDB, so it is
//   never uploaded or published.
// - Uses WebGPU when the browser has it (fast on a real GPU), otherwise WebAssembly on the CPU.
// - Works with YOLOv8/YOLO11 detection and segmentation exports (only the boxes are used, as in the
//   camera node). Class names and input size are read from the model's own metadata.
import * as ort from "onnxruntime-web/webgpu";
import { DETECTION } from "./detectionConfig";

ort.env.wasm.wasmPaths = "/ort/"; // copied from node_modules at build time (scripts/copy-ort.mjs)
ort.env.wasm.numThreads = 1;      // threads need cross-origin isolation headers; one thread is enough as a fallback

let session = null;
let info = null;          // { name, names: {id: name}, imgsz, provider, sizeMB }
let chain = Promise.resolve(); // runs are done one at a time (one model shared by all cameras)
const canvas = typeof document !== "undefined" ? document.createElement("canvas") : null;

/* ---------- model metadata (ONNX ModelProto.metadata_props, protobuf field 14) ---------- */
function readVarint(buf, pos) {
  let result = 0, shift = 0, b;
  do { b = buf[pos++]; result += (b & 0x7f) * 2 ** shift; shift += 7; } while (b & 0x80);
  return [result, pos];
}
function readMetadata(bytes) {
  const buf = new Uint8Array(bytes), dec = new TextDecoder(), meta = {};
  let pos = 0;
  while (pos < buf.length) {
    let tag; [tag, pos] = readVarint(buf, pos);
    const field = Math.floor(tag / 8), wire = tag & 7;
    if (wire === 0) { [, pos] = readVarint(buf, pos); continue; }
    if (wire === 1) { pos += 8; continue; }
    if (wire === 5) { pos += 4; continue; }
    if (wire !== 2) break; // unexpected: stop reading metadata
    let len; [len, pos] = readVarint(buf, pos);
    if (field === 14) { // StringStringEntryProto { key = 1; value = 2; }
      const end = pos + len; let key = "", value = "", p = pos;
      while (p < end) {
        let t; [t, p] = readVarint(buf, p);
        let l; [l, p] = readVarint(buf, p);
        const s = dec.decode(buf.subarray(p, p + l)); p += l;
        if (t >> 3 === 1) key = s; else if (t >> 3 === 2) value = s;
      }
      meta[key] = value;
    }
    pos += len;
  }
  return meta;
}
function parseNames(s) { // "{0: 'fire', 1: 'smoke'}"
  const names = {};
  for (const m of String(s || "").matchAll(/(\d+)\s*:\s*['"]([^'"]*)['"]/g)) names[Number(m[1])] = m[2];
  return names;
}

/* ---------- remembering the model in this browser (IndexedDB) ---------- */
const DB = "twin-models", STORE = "models", KEY = "fire-smoke";
function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction(STORE, mode), req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
    };
  });
}

/** Load a model from bytes. Throws an Error with a readable message. */
export async function loadModel(bytes, name, { remember = true } = {}) {
  const meta = readMetadata(bytes);
  const names = parseNames(meta.names);
  if (!Object.keys(names).length) throw new Error("This model has no class names inside. Export it with Ultralytics (yolo export ... format=onnx) so the names are included.");
  const imgsz = (meta.imgsz && Number(String(meta.imgsz).match(/\d+/)?.[0])) || 640;
  let s = null, provider = null;
  for (const ep of (navigator.gpu ? ["webgpu", "wasm"] : ["wasm"])) {
    try { s = await ort.InferenceSession.create(bytes, { executionProviders: [ep], graphOptimizationLevel: "all" }); provider = ep; break; }
    catch (e) { if (ep === "wasm") throw new Error(`Could not load the model: ${e.message || e}`); }
  }
  await session?.release?.();
  session = s;
  info = { name, names, imgsz, provider, sizeMB: bytes.byteLength / 1e6, task: meta.task || "detect" };
  if (remember) { try { await idb("readwrite", (st) => st.put({ name, bytes }, KEY)); } catch { /* storage unavailable: works this session only */ } }
  return info;
}

/** Reload the model this browser remembered, if any. Returns info or null. */
export async function restoreModel() {
  try {
    const rec = await idb("readonly", (st) => st.get(KEY));
    return rec ? await loadModel(rec.bytes, rec.name, { remember: false }) : null;
  } catch { return null; }
}

export async function forgetModel() {
  await session?.release?.();
  session = null; info = null;
  try { await idb("readwrite", (st) => st.delete(KEY)); } catch { /* nothing stored */ }
}

export const modelInfo = () => info;

/* ---------- one detection run ---------- */
function iou(a, b) {
  const x1 = Math.max(a.x1, b.x1), y1 = Math.max(a.y1, b.y1), x2 = Math.min(a.x2, b.x2), y2 = Math.min(a.y2, b.y2);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / ((a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter + 1e-9);
}

/**
 * Detect fire/smoke in the current video frame. Resolves to
 * { dets: [{ cls, name, conf, x1, y1, x2, y2, cx, cy }], W, H, ms } in video pixels, or null if busy/unready.
 */
export function detect(video) {
  if (!session || !video?.videoWidth) return Promise.resolve(null);
  const run = chain.then(async () => {
    if (!session) return null;
    const W = video.videoWidth, H = video.videoHeight, S = info.imgsz;
    // Letterbox: fit the frame into S x S keeping its shape, pad with grey (as Ultralytics does).
    const r = Math.min(S / W, S / H), nw = Math.round(W * r), nh = Math.round(H * r);
    const px = Math.floor((S - nw) / 2), py = Math.floor((S - nh) / 2);
    canvas.width = S; canvas.height = S;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "rgb(114,114,114)"; ctx.fillRect(0, 0, S, S);
    ctx.drawImage(video, px, py, nw, nh);
    const px8 = ctx.getImageData(0, 0, S, S).data, plane = S * S, input = new Float32Array(3 * plane);
    for (let i = 0; i < plane; i++) { input[i] = px8[i * 4] / 255; input[plane + i] = px8[i * 4 + 1] / 255; input[2 * plane + i] = px8[i * 4 + 2] / 255; }

    const t0 = performance.now();
    const out = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, S, S]) });
    const ms = performance.now() - t0;
    const o = out[session.outputNames[0]];         // [1, 4 + classes (+ 32 mask coefficients), anchors]
    const [, C, N] = o.dims, data = o.data, nc = Object.keys(info.names).length;
    if (C < 4 + nc) throw new Error(`Unexpected model output shape [${o.dims}].`);

    const boxes = [];
    for (let i = 0; i < N; i++) {
      let best = 0, cls = -1;
      for (let c = 0; c < nc; c++) { const s = data[(4 + c) * N + i]; if (s > best) { best = s; cls = c; } }
      if (best < DETECTION.confThreshold) continue;
      const cx = data[i], cy = data[N + i], w = data[2 * N + i], h = data[3 * N + i];
      const x1 = (cx - w / 2 - px) / r, y1 = (cy - h / 2 - py) / r, x2 = (cx + w / 2 - px) / r, y2 = (cy + h / 2 - py) / r;
      boxes.push({ cls, name: info.names[cls] ?? String(cls), conf: best,
        x1: Math.max(0, x1), y1: Math.max(0, y1), x2: Math.min(W, x2), y2: Math.min(H, y2) });
    }
    // Non-maximum suppression per class (drop boxes overlapping a stronger one of the same class).
    boxes.sort((a, b) => b.conf - a.conf);
    const keep = [];
    for (const b of boxes) if (!keep.some((k) => k.cls === b.cls && iou(k, b) > DETECTION.nmsIou)) keep.push(b);
    keep.forEach((b) => { b.cx = (b.x1 + b.x2) / 2; b.cy = (b.y1 + b.y2) / 2; });
    return { dets: keep, W, H, ms };
  });
  chain = run.catch(() => null);
  return run;
}
