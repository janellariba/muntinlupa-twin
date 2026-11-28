// /api/live: live camera video through Cloudflare Realtime (SFU). The Cloudflare secret stays here;
// browsers only exchange WebRTC session descriptions (SDP) through this function.
//
//   POST ?action=publish   admin  { cameraId, sdp, mid }      -> laptop starts sending one camera
//   POST ?action=heartbeat admin  { cameraIds: [...] }        -> "these cameras are still streaming"
//   POST ?action=stop      admin  { cameraId }                -> camera stopped streaming
//   POST ?action=view      viewer { cameraId }                -> viewer session + offer to receive it
//   POST ?action=answer    viewer { sessionId, token, sdp }   -> viewer's answer completes the connection
//
// Flow:  laptop --(1 upload per camera)--> Cloudflare --> each viewer
import crypto from "node:crypto";
import { handler, readJson, send, query, HttpError } from "./_lib/http.js";
import { requireAdmin, requireViewer } from "./_lib/auth.js";
import { q } from "./_lib/db.js";
import { LIVE } from "../src/lib/detectionConfig.js";

const API = "https://rtc.live.cloudflare.com/v1";

function cf() {
  const id = process.env.CF_REALTIME_APP_ID, secret = process.env.CF_REALTIME_APP_SECRET;
  if (!id || !secret) throw new HttpError(500, "CF_REALTIME_APP_ID and CF_REALTIME_APP_SECRET must be set in the Vercel environment variables.");
  return {
    secret,
    async call(method, path, body) {
      let r;
      try {
        r = await fetch(`${process.env.CF_REALTIME_API || API}/apps/${id}${path}`, {
          method, headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (e) { throw new HttpError(502, `Cannot reach Cloudflare Realtime: ${e.message}`); }
      const j = await r.json().catch(() => ({}));
      if (r.status === 401 || r.status === 403) throw new HttpError(502, "Cloudflare rejected the app secret: check CF_REALTIME_APP_ID and CF_REALTIME_APP_SECRET.");
      if (!r.ok || j.errorCode) throw new HttpError(502, `Cloudflare Realtime: ${j.errorDescription || j.errorCode || `HTTP ${r.status}`}`);
      const trackErr = (j.tracks || []).find((t) => t.errorCode);
      if (trackErr) throw new HttpError(502, `Cloudflare Realtime: ${trackErr.errorDescription || trackErr.errorCode}`);
      return j;
    },
  };
}

// The viewer's Cloudflare session id is signed so a browser can only answer sessions this API created.
const tokenFor = (secret, sessionId) => crypto.createHmac("sha256", secret).update(`view:${sessionId}`).digest("base64url");
const sdpOk = (s) => typeof s === "string" && s.startsWith("v=") && s.length < 100_000;

async function camera(id) {
  const c = (await q("select id, name, live_session, live_track, live_at from twin_cameras where id=$1", [id])).rows[0];
  if (!c) throw new HttpError(404, "Camera not found.");
  return c;
}

const actions = {
  async publish(req, b) {
    requireAdmin(req);
    if (!sdpOk(b.sdp) || !b.mid) throw new HttpError(400, "Missing stream offer.");
    const cam = await camera(b.cameraId), api = cf();
    const { sessionId } = await api.call("POST", "/sessions/new");
    const trackName = `cam-${cam.id}`;
    const r = await api.call("POST", `/sessions/${sessionId}/tracks/new`, {
      sessionDescription: { type: "offer", sdp: b.sdp },
      tracks: [{ location: "local", mid: String(b.mid), trackName }],
    });
    await q("update twin_cameras set live_session=$2, live_track=$3, live_at=now() where id=$1", [cam.id, sessionId, trackName]);
    return { sessionDescription: r.sessionDescription };
  },
  async heartbeat(req, b) {
    requireAdmin(req);
    const ids = (Array.isArray(b.cameraIds) ? b.cameraIds : []).slice(0, 50).map(String);
    if (ids.length) await q("update twin_cameras set live_at=now() where id = any($1::uuid[]) and live_session is not null", [ids]);
    return { ok: true };
  },
  async stop(req, b) {
    requireAdmin(req);
    await q("update twin_cameras set live_session=null, live_track=null, live_at=null where id=$1", [b.cameraId]);
    return { ok: true };
  },
  async view(req, b) {
    requireViewer(req);
    const cam = await camera(b.cameraId);
    const fresh = cam.live_at && Date.now() - new Date(cam.live_at).getTime() < LIVE.offlineAfterS * 1000;
    if (!cam.live_session || !fresh) throw new HttpError(409, `${cam.name} is not streaming right now. The admin console must be open with this camera connected.`);
    const api = cf();
    const { sessionId } = await api.call("POST", "/sessions/new");
    const r = await api.call("POST", `/sessions/${sessionId}/tracks/new`, {
      tracks: [{ location: "remote", sessionId: cam.live_session, trackName: cam.live_track }],
    });
    if (!r.sessionDescription) throw new HttpError(502, "Cloudflare Realtime returned no offer for the viewer.");
    return { sessionId, token: tokenFor(api.secret, sessionId), sessionDescription: r.sessionDescription };
  },
  async answer(req, b) {
    requireViewer(req);
    const api = cf();
    const expected = tokenFor(api.secret, String(b.sessionId ?? ""));
    const given = String(b.token ?? "");
    if (given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) throw new HttpError(403, "Invalid viewer session.");
    if (!sdpOk(b.sdp)) throw new HttpError(400, "Missing answer.");
    await api.call("PUT", `/sessions/${encodeURIComponent(b.sessionId)}/renegotiate`, { sessionDescription: { type: "answer", sdp: b.sdp } });
    return { ok: true };
  },
};

export default handler({
  POST: async (req, res) => {
    const fn = actions[query(req).action];
    if (!fn) throw new HttpError(400, "Unknown action.");
    send(res, 200, await fn(req, await readJson(req, 200_000)));
  },
});
