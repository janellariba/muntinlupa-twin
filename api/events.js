// /api/events
//   GET  -> what the twin page shows: cameras, the latest snapshot per camera (signed picture links),
//           the latest fire estimate. Anyone can read. The pages call this every few seconds.
//   POST { type: "detection", ... , jpeg: base64 } -> admin: save a snapshot + its detection
//   POST { type: "estimate", ... }                  -> admin: save a triangulated fire estimate
//   POST { type: "preview", cameraId, jpeg }        -> admin: the once-a-minute picture for public viewers
//                                                      (one file per camera, overwritten each time)
import crypto from "node:crypto";
import { handler, readJson, send, HttpError } from "./_lib/http.js";
import { requireAdmin } from "./_lib/auth.js";
import { q } from "./_lib/db.js";
import { uploadJpeg, signedUrls } from "./_lib/storage.js";

const finite = (v) => (v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null);

async function saveDetection(b) {
  const cam = (await q("select id, name from twin_cameras where id=$1", [b.cameraId])).rows[0];
  if (!cam) throw new HttpError(404, "Camera not found.");
  const conf = Number(b.confidence);
  if (!(conf >= 0 && conf <= 1)) throw new HttpError(400, "Confidence must be between 0 and 1.");
  let path = null;
  if (b.jpeg) {
    const buf = jpegBuffer(b.jpeg);
    const day = new Date().toISOString().slice(0, 10);
    path = await uploadJpeg(`${day}/${cam.id}/${Date.now()}-${crypto.randomBytes(3).toString("hex")}.jpg`, buf);
  }
  const { rows } = await q(
    `insert into twin_detections (camera_id, camera_name, class_name, confidence, bbox, frame_w, frame_h, all_boxes, bearing_deg, from_smoke, snapshot_path)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id, detected_at`,
    [cam.id, cam.name, String(b.className ?? "").slice(0, 40), conf, JSON.stringify(b.bbox ?? {}), finite(b.frameW), finite(b.frameH),
     JSON.stringify(b.allBoxes ?? []), finite(b.bearing), Boolean(b.fromSmoke), path]);
  return { id: rows[0].id, detectedAt: rows[0].detected_at, snapshotPath: path };
}

function jpegBuffer(b64) {
  const buf = Buffer.from(String(b64 ?? ""), "base64");
  if (buf.length < 100 || buf[0] !== 0xff || buf[1] !== 0xd8) throw new HttpError(400, "Snapshot is not a JPEG picture.");
  return buf;
}

async function savePreview(b) {
  const cam = (await q("select id from twin_cameras where id=$1", [b.cameraId])).rows[0];
  if (!cam) throw new HttpError(404, "Camera not found.");
  const path = await uploadJpeg(`previews/${cam.id}.jpg`, jpegBuffer(b.jpeg), true);
  await q("update twin_cameras set preview_path=$2, preview_at=now() where id=$1", [cam.id, path]);
  return { ok: true };
}

async function saveEstimate(b) {
  const lat = finite(b.lat), lon = finite(b.lon);
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new HttpError(400, "Estimate needs a valid lat/lon.");
  const rays = Array.isArray(b.rays) ? b.rays.slice(0, 20) : [];
  if (rays.length < 2) throw new HttpError(400, "An estimate needs at least 2 bearings.");
  const { rows } = await q(
    `insert into twin_fire_estimates (lat, lon, ellipse_major_m, ellipse_minor_m, ellipse_orient_deg, n_rays, max_ray_angle_deg, residual_rms_deg, uses_smoke, rays)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id, estimated_at`,
    [lat, lon, finite(b.ellipseMajor), finite(b.ellipseMinor), finite(b.ellipseOrient), rays.length, finite(b.maxRayAngle), finite(b.residualRms), Boolean(b.usesSmoke), JSON.stringify(rays)]);
  return { id: rows[0].id, estimatedAt: rows[0].estimated_at };
}

export default handler({
  GET: async (req, res) => {
    const [cams, latest, est] = await Promise.all([
      q("select id, name, lat, lon, cam_index, heading_deg, fov_deg, live_at, preview_path, preview_at from twin_cameras order by created_at"),
      q(`select distinct on (camera_id) id, camera_id, class_name, confidence, bearing_deg, from_smoke, snapshot_path, detected_at
         from twin_detections where camera_id is not null order by camera_id, detected_at desc`),
      q("select * from twin_fire_estimates order by estimated_at desc limit 1"),
    ]);
    const urls = await signedUrls([...latest.rows.map((r) => r.snapshot_path), ...cams.rows.map((r) => r.preview_path)]);
    const e = est.rows[0];
    send(res, 200, {
      serverTime: new Date().toISOString(),
      cameras: cams.rows.map((r) => ({
        id: r.id, name: r.name, lat: r.lat, lon: r.lon, index: r.cam_index, heading: r.heading_deg, fov: r.fov_deg,
        liveAt: r.live_at, previewUrl: urls[r.preview_path] ?? null, previewAt: r.preview_at,
      })),
      latestDetections: latest.rows.map((r) => ({
        cameraId: r.camera_id, className: r.class_name, confidence: r.confidence, bearing: r.bearing_deg, fromSmoke: r.from_smoke,
        detectedAt: r.detected_at, snapshotUrl: urls[r.snapshot_path] ?? null,
      })),
      estimate: e ? {
        id: e.id, lat: e.lat, lon: e.lon, ellipse: { major: e.ellipse_major_m, minor: e.ellipse_minor_m, orientDeg: e.ellipse_orient_deg },
        nRays: e.n_rays, maxRayAngleDeg: e.max_ray_angle_deg, residualRmsDeg: e.residual_rms_deg, usesSmoke: e.uses_smoke,
        rays: e.rays, estimatedAt: e.estimated_at,
      } : null,
    });
  },
  POST: async (req, res) => {
    requireAdmin(req);
    const b = await readJson(req, 4_000_000); // Vercel functions accept up to 4.5 MB per request
    if (b.type === "detection") return send(res, 201, await saveDetection(b));
    if (b.type === "estimate") return send(res, 201, await saveEstimate(b));
    if (b.type === "preview") return send(res, 201, await savePreview(b));
    throw new HttpError(400, 'type must be "detection" or "estimate".');
  },
});
