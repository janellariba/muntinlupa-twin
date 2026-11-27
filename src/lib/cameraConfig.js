// cameraConfig.js
// Cameras the user adds in the Camera config card: name, lat/lon (WGS84), webcam index.
// Saved in this browser's localStorage (only lat/lon/index/name are stored; map positions are
// recomputed on load, so they stay right if the twin's DEM or origin changes).
import { latLonToUtm51 } from "./cameras";
import { findBarangay } from "./twinGeometry";

const KEY = "twin.cameras.v1";
export const MAX_INDEX = 15; // highest webcam index accepted (a computer rarely has more than a few)

export function loadCameras() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(list) ? list.filter((c) => c && typeof c.id === "string") : [];
  } catch {
    return []; // storage blocked or corrupted: start empty
  }
}

export function saveCameras(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch { return false; }
}

/** Where a camera sits in the twin: local meters and its barangay (null if outside the city). */
export function placeCamera(cam, twin) {
  const [E, N] = latLonToUtm51(cam.lat, cam.lon);
  const x = E - twin.meta.origin_utm[0], y = N - twin.meta.origin_utm[1];
  const b = findBarangay(twin.barangayIndex, x, y);
  return { ...cam, x, y, barangay: b ? b.name : null };
}

/**
 * Check the form values. Returns { cam } or { error }.
 * Accepts "14.4123" style decimal degrees. The point must fall inside a Muntinlupa barangay,
 * so a typo (swapped lat/lon, a missing digit) cannot put a camera somewhere else.
 */
export function validateCamera(form, twin, existing, editingId) {
  const lat = Number(String(form.lat).trim());
  const lon = Number(String(form.lon).trim());
  const index = Number(String(form.index).trim());
  // Muntinlupa's longitude (~121) is out of range for a latitude, so this catches swapped values.
  if (Number.isFinite(lat) && Math.abs(lat) > 90 && Number.isFinite(lon) && Math.abs(lon) <= 90) return { error: "Latitude and longitude look swapped. Latitude is about 14.4, longitude about 121.0 in Muntinlupa." };
  if (String(form.lat).trim() === "" || !Number.isFinite(lat) || lat < -90 || lat > 90) return { error: "Latitude must be a number between -90 and 90 (for example 14.4081)." };
  if (String(form.lon).trim() === "" || !Number.isFinite(lon) || lon < -180 || lon > 180) return { error: "Longitude must be a number between -180 and 180 (for example 121.0415)." };
  if (String(form.index).trim() === "" || !Number.isInteger(index) || index < 0 || index > MAX_INDEX) return { error: `Camera index must be a whole number from 0 to ${MAX_INDEX} (0 is usually the laptop's own camera).` };
  const name = String(form.name || "").trim().slice(0, 40) || `Camera ${index}`;
  const placed = placeCamera({ lat, lon }, twin);
  if (!placed.barangay) return { error: "That point is outside Muntinlupa. Muntinlupa is around 14.36 to 14.45 N, 121.01 to 121.06 E." };
  if (existing.some((c) => c.id !== editingId && c.name.toLowerCase() === name.toLowerCase())) return { error: `There is already a camera named "${name}".` };
  return { cam: { id: editingId || `cam-${Date.now().toString(36)}`, name, lat, lon, index } };
}
