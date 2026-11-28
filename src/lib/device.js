// device.js: the name of THIS admin device (laptop), e.g. "Laptop A". Saved in this browser.
// A camera runs only on the device it is assigned to, because a webcam index (0, 1, ...) only means
// something on one device: "Laptop A index 0" and "Laptop B index 0" are different webcams.
const KEY = "twin.deviceName.v1";
export function loadDeviceName() { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } }
export function saveDeviceName(n) { try { localStorage.setItem(KEY, n); } catch { /* storage unavailable */ } }
export const sameDevice = (a, b) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
