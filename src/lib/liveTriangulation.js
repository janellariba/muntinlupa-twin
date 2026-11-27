// liveTriangulation.js
// Turns the latest detections of each open camera into bearings and a triangulated estimate.
//   1. Per camera, pick one box: the most confident FIRE box; a SMOKE box only if that camera sees
//      no fire (flagged fromSmoke, a weaker bearing because smoke drifts). Approved 2026-11-27.
//   2. Keep each camera's last detection for DETECTION.combineWindowS seconds.
//   3. Bearing = pinhole pixelToBearing() when heading AND field of view are measured; otherwise the
//      camera is listed as NOT MEASURED and gives no line.
//   4. Triangulate (port of dt-step4-ui). Assumes ONE fire: all bearings are combined.
import { DETECTION, TRIANGULATION } from "./detectionConfig";
import { pixelToBearing, rayFromBearing, triangulate, ellipse95 } from "./triangulation";
import { localToLatLon } from "./weather";

export function pickBox(dets) {
  const fire = dets.filter((d) => /fire|flame/i.test(d.name)).sort((a, b) => b.conf - a.conf)[0];
  if (fire) return { ...fire, fromSmoke: false };
  const smoke = dets.filter((d) => /smoke/i.test(d.name)).sort((a, b) => b.conf - a.conf)[0];
  return smoke ? { ...smoke, fromSmoke: true } : null;
}

/**
 * cams: placed cameras ({ id, name, lat, lon, x, y, heading, fov }), hits: { camId: { box, W, H, t } },
 * now: ms timestamp, originUtm: twin origin. Returns { observations, rays, result, estimate }.
 */
export function liveTriangulation(cams, hits, now, originUtm) {
  const observations = [];
  for (const c of cams) {
    const h = hits[c.id];
    if (!h || now - h.t > DETECTION.combineWindowS * 1000) continue;
    const measured = c.heading != null && c.fov != null;
    observations.push({
      cam: c, box: h.box, ageS: (now - h.t) / 1000,
      bearing: measured ? pixelToBearing(h.box.cx, h.W, c.heading, c.fov) : null,
    });
  }
  const rays = observations.filter((o) => o.bearing != null).map((o) => ({
    id: o.cam.id, name: o.cam.name, fromSmoke: o.box.fromSmoke, bearing: o.bearing,
    ...rayFromBearing(o.cam.lat, o.cam.lon, o.bearing, originUtm),
  }));
  const result = rays.length ? triangulate(rays, TRIANGULATION) : null;
  let estimate = null;
  if (result?.status === "ok") {
    const [lat, lon] = localToLatLon(result.point[0], result.point[1], originUtm);
    estimate = { x: result.point[0], y: result.point[1], lat, lon, ellipse: ellipse95(result.cov), anySmoke: rays.some((r) => r.fromSmoke) };
  }
  return { observations, rays, result, estimate };
}
