// storedEstimate.js: turns a fire estimate saved in the database back into the shape the map's
// triangulation layer draws ({ rays, result, estimate }). Bearing lines are rebuilt from each ray's
// saved camera position + bearing with the same rayFromBearing() the admin console used.
import { rayFromBearing } from "./triangulation";
import { latLonToUtm51 } from "./cameras";

export function storedToLive(est, cams, originUtm, active) {
  if (!est) return null;
  const [E, N] = latLonToUtm51(est.lat, est.lon);
  const x = E - originUtm[0], y = N - originUtm[1];
  const rays = [], ranges = {};
  (est.rays || []).forEach((r, i) => {
    // Camera position saved with the ray; older rows fall back to the camera's current position.
    const cam = cams.find((c) => c.id === r.camera_id);
    const lat = r.lat ?? cam?.lat, lon = r.lon ?? cam?.lon;
    if (lat == null || lon == null || r.bearing_deg == null) return;
    const id = `${r.camera_id ?? "cam"}-${i}`;
    const ray = { id, name: r.camera_name, fromSmoke: !!r.from_smoke, bearing: r.bearing_deg, ...rayFromBearing(lat, lon, r.bearing_deg, originUtm) };
    rays.push(ray);
    ranges[id] = Math.max(0, (x - ray.origin[0]) * ray.dir[0] + (y - ray.origin[1]) * ray.dir[1]); // distance along the line
  });
  return {
    rays,
    result: { status: "ok", ranges, nRays: est.nRays, maxRayAngleDeg: est.maxRayAngleDeg, residualRmsDeg: est.residualRmsDeg },
    estimate: { x, y, lat: est.lat, lon: est.lon, ellipse: est.ellipse, anySmoke: est.usesSmoke },
    stored: { active, estimatedAt: est.estimatedAt },
  };
}
