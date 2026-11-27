// webcam.js
// Opens a webcam by its index (0, 1, 2...) in the browser, the way the AI-SUNOG camera node uses
// device_index. The stream comes from the computer or phone viewing the page; nothing is uploaded.
// Note: the browser's order of cameras is not guaranteed to match OpenCV/DirectShow's order, so the
// camera's name is always shown next to its index.

const supported = () => typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia && navigator.mediaDevices?.enumerateDevices;

/** Video inputs in browser order: [{ index, deviceId, label }]. Asks for permission once if
 *  needed, because browsers hide camera names (and sometimes ids) until permission is granted. */
export async function listCameras() {
  if (!supported()) throw friendly({ name: "NotSupported" });
  let cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
  if (cams.length && cams.every((d) => !d.label || !d.deviceId)) {
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ video: true });
      probe.getTracks().forEach((t) => t.stop());
    } catch (e) { throw friendly(e); }
    cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
  }
  return cams.map((d, i) => ({ index: i, deviceId: d.deviceId, label: d.label || `Camera ${i}` }));
}

/** Open the webcam at `index`. Returns { stream, label }. Throws an Error with a readable message. */
export async function openCamera(index) {
  const cams = await listCameras();
  if (!cams.length) throw new Error("No camera was found on this device. Plug in a webcam, then try again.");
  const cam = cams[index];
  if (!cam) {
    throw new Error(`Camera index ${index} was not found. This device has ${cams.length} camera${cams.length > 1 ? "s" : ""} (index 0${cams.length > 1 ? ` to ${cams.length - 1}` : ""}).`);
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: cam.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    return { stream, label: cam.label };
  } catch (e) {
    throw friendly(e, index);
  }
}

export function stopStream(stream) {
  stream?.getTracks().forEach((t) => t.stop());
}

function friendly(e, index) {
  const msg = {
    NotSupported: "This browser cannot open cameras. Use Chrome or Edge, on an https:// address.",
    NotAllowedError: "Camera permission is blocked. Allow the camera in the browser's address bar (the camera icon), then try again.",
    SecurityError: "Camera permission is blocked. Allow the camera in the browser's address bar (the camera icon), then try again.",
    NotReadableError: `Camera ${index ?? ""} is busy. Another program may be using it, for example the AI-SUNOG camera node or a video call. Close it and try again.`,
    NotFoundError: "That camera was not found. It may have been unplugged.",
    OverconstrainedError: "That camera was not found. It may have been unplugged.",
  }[e?.name];
  return new Error(msg || `Could not open the camera: ${e?.message || e}`);
}
