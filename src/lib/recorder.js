// recorder.js: manual recording of a camera stream, saved on the admin laptop (no cloud storage).
// Chrome/Edge: the admin picks a recordings folder once; video is written to disk every second while
// recording, so a 1-hour recording never has to fit in memory. Other browsers: the file is kept in
// memory and downloaded when recording stops.
import { LOGGING } from "./detectionConfig";

/* ---------- recordings folder (remembered in IndexedDB) ---------- */
export const folderSupported = () => typeof window !== "undefined" && "showDirectoryPicker" in window;
const DB = "twin-recordings", STORE = "handles", KEY = "folder";
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
export async function chooseFolder() {
  const handle = await window.showDirectoryPicker({ id: "twin-recordings", mode: "readwrite" });
  try { await idb("readwrite", (s) => s.put(handle, KEY)); } catch { /* not remembered; still works now */ }
  return handle;
}
export async function savedFolder() {
  if (!folderSupported()) return null;
  try { return (await idb("readonly", (s) => s.get(KEY))) || null; } catch { return null; }
}

/* ---------- recording ---------- */
function pickMime() {
  for (const m of ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"]) {
    if (window.MediaRecorder?.isTypeSupported?.(m)) return m;
  }
  return "";
}
const pad = (n) => String(n).padStart(2, "0");
export function recordingName(camName, d = new Date()) {
  const safe = camName.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "camera";
  return `${safe}_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * Start recording `stream`. Call from a click (the folder permission prompt needs one).
 * Returns { stop(), done: Promise<{ fileName, startedAt, endedAt, durationS, sizeBytes, mode }>, fileName, mode }.
 * Stops by itself after LOGGING.maxRecordingS.
 */
export async function startRecording(stream, camName, folder) {
  if (!window.MediaRecorder) throw new Error("This browser cannot record video. Use Chrome or Edge.");
  const mime = pickMime();
  const fileName = `${recordingName(camName)}.${mime.includes("mp4") ? "mp4" : "webm"}`;

  let writable = null;
  if (folder) {
    try {
      const perm = (await folder.queryPermission?.({ mode: "readwrite" })) === "granted" ? "granted" : await folder.requestPermission({ mode: "readwrite" });
      if (perm === "granted") writable = await (await folder.getFileHandle(fileName, { create: true })).createWritable();
    } catch { writable = null; /* falls back to a download */ }
  }
  const mode = writable ? "folder" : "download";
  const chunks = [];
  let size = 0, writes = Promise.resolve();

  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  rec.ondataavailable = (e) => {
    if (!e.data?.size) return;
    size += e.data.size;
    if (writable) writes = writes.then(() => writable.write(e.data)); // written to disk as it records
    else chunks.push(e.data);
  };
  const startedAt = new Date();
  const timer = setTimeout(() => rec.state !== "inactive" && rec.stop(), LOGGING.maxRecordingS * 1000);
  const done = new Promise((resolve, reject) => {
    rec.onstop = async () => {
      clearTimeout(timer);
      try {
        await writes;
        if (writable) await writable.close();
        else {
          const url = URL.createObjectURL(new Blob(chunks, { type: mime || "video/webm" }));
          const a = Object.assign(document.createElement("a"), { href: url, download: fileName });
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
        }
        const endedAt = new Date();
        resolve({ fileName, startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(), durationS: (endedAt - startedAt) / 1000, sizeBytes: size, mode });
      } catch (e) { reject(new Error(`Could not save the recording: ${e.message || e}`)); }
    };
  });
  rec.start(1000); // a chunk every second
  return { stop: () => rec.state !== "inactive" && rec.stop(), done, fileName, mode, startedAt };
}
