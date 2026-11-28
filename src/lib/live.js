// live.js: WebRTC with Cloudflare Realtime. The browser makes the connection; /api/live only passes
// session descriptions to Cloudflare (the Cloudflare secret never reaches a browser).
//   publish(): admin laptop sends one camera's video (one upload, no matter how many viewers).
//   watch():   a viewer receives that camera's video.
import { api } from "./api";
import { LIVE } from "./detectionConfig";

const ICE = [{ urls: "stun:stun.cloudflare.com:3478" }]; // Cloudflare's free public STUN server

/** Wait until the connection is up (or fails). */
function connected(pc, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const check = () => {
      if (pc.connectionState === "connected") { cleanup(); resolve(); }
      else if (["failed", "closed"].includes(pc.connectionState)) { cleanup(); reject(new Error("Connection to Cloudflare failed.")); }
    };
    const t = setTimeout(() => { cleanup(); reject(new Error("Connection to Cloudflare timed out.")); }, timeoutMs);
    const cleanup = () => { clearTimeout(t); pc.removeEventListener("connectionstatechange", check); };
    pc.addEventListener("connectionstatechange", check);
    check();
  });
}

/** Send `stream`'s video for camera `cameraId`. Returns { pc, close }. onDrop() is called if it disconnects later. */
export async function publish(cameraId, stream, onDrop) {
  const track = stream.getVideoTracks()[0];
  if (!track) throw new Error("No video to send.");
  const pc = new RTCPeerConnection({ iceServers: ICE, bundlePolicy: "max-bundle" });
  try {
    const tr = pc.addTransceiver(track, { direction: "sendonly" });
    await pc.setLocalDescription(await pc.createOffer());
    const r = await api.livePublish({ cameraId, sdp: pc.localDescription.sdp, mid: tr.mid });
    await pc.setRemoteDescription(r.sessionDescription);
    try { // limit upload per camera (LIVE.maxBitrateKbps)
      const p = tr.sender.getParameters();
      p.encodings = p.encodings?.length ? p.encodings : [{}];
      p.encodings[0].maxBitrate = LIVE.maxBitrateKbps * 1000;
      await tr.sender.setParameters(p);
    } catch { /* some browsers do not allow it; the stream still works */ }
    await connected(pc);
  } catch (e) { pc.close(); throw e; }
  let closed = false;
  pc.addEventListener("connectionstatechange", () => {
    if (!closed && ["failed", "disconnected", "closed"].includes(pc.connectionState)) onDrop?.();
  });
  return {
    pc,
    close() {
      if (closed) return;
      closed = true;
      pc.close();
      api.liveStop(cameraId).catch(() => {}); // best effort; otherwise the server sees no heartbeat
    },
  };
}

/** Show camera `cameraId` live in `video`. Returns { close }. onDrop() is called if it disconnects. */
export async function watch(cameraId, video, onDrop) {
  const pc = new RTCPeerConnection({ iceServers: ICE, bundlePolicy: "max-bundle" });
  pc.ontrack = (e) => { video.srcObject = e.streams?.[0] ?? new MediaStream([e.track]); video.play?.().catch(() => {}); };
  try {
    const v = await api.liveView(cameraId);
    await pc.setRemoteDescription(v.sessionDescription);
    await pc.setLocalDescription(await pc.createAnswer());
    await api.liveAnswer({ sessionId: v.sessionId, token: v.token, sdp: pc.localDescription.sdp });
    await connected(pc);
  } catch (e) { pc.close(); throw e; }
  let closed = false;
  pc.addEventListener("connectionstatechange", () => {
    if (!closed && ["failed", "disconnected", "closed"].includes(pc.connectionState)) onDrop?.();
  });
  return { close() { closed = true; pc.close(); } };
}
