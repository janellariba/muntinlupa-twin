// combine.js: triangulates fire bearings from cameras on ALL admin laptops, on the server.
// Same math as the admin console (src/lib/triangulation.js, port of dt-step4-ui triangulation.py) and the
// same approved values (DETECTION.combineWindowS, TRIANGULATION.*, LOGGING.estimateIntervalS).
// Times use the SERVER clock (when each bearing arrived), so laptop clocks do not matter.
import { q } from "./db.js";
import { rayFromBearing, triangulate, ellipse95 } from "../../src/lib/triangulation.js";
import { latLonToUtm51 } from "../../src/lib/cameras.js";
import { localToLatLon } from "../../src/lib/weather.js";
import { DETECTION, TRIANGULATION, LOGGING } from "../../src/lib/detectionConfig.js";

/** Cameras whose latest bearing arrived within the combine window. */
export async function freshBearings() {
  const { rows } = await q(
    `select id, name, device_name, lat, lon, last_bearing_deg, last_bearing_class, last_bearing_conf, last_bearing_smoke,
            extract(epoch from now() - last_bearing_at) as age_s
       from twin_cameras
      where last_bearing_deg is not null and last_bearing_at > now() - make_interval(secs => $1)
      order by name`, [DETECTION.combineWindowS]);
  return rows;
}

/** Triangulate the fresh bearings. Returns { status, reason, nRays, ..., estimate?, rays }. */
export function solve(rows) {
  if (!rows.length) return { status: "none", nRays: 0, rays: [] };
  const origin = latLonToUtm51(rows[0].lat, rows[0].lon); // any nearby origin works; results go back to lat/lon
  const rays = rows.map((r) => ({ id: r.id, fromSmoke: !!r.last_bearing_smoke, ...rayFromBearing(r.lat, r.lon, r.last_bearing_deg, origin) }));
  const res = triangulate(rays, TRIANGULATION);
  const out = {
    status: res.status, reason: res.reason ?? null, nRays: res.nRays ?? rays.length,
    maxRayAngleDeg: res.maxRayAngleDeg ?? null, residualRmsDeg: res.residualRmsDeg ?? null,
    rays: rows.map((r) => ({ camera_id: r.id, camera_name: r.name, device: r.device_name, bearing_deg: r.last_bearing_deg, from_smoke: !!r.last_bearing_smoke, lat: r.lat, lon: r.lon })),
  };
  if (res.status === "ok") {
    const [lat, lon] = localToLatLon(res.point[0], res.point[1], origin);
    out.estimate = { lat, lon, ellipse: ellipse95(res.cov), usesSmoke: rays.some((r) => r.fromSmoke) };
  }
  return out;
}

/** Combine now and save the estimate unless one was saved less than LOGGING.estimateIntervalS ago. */
export async function combineAndSave() {
  const c = solve(await freshBearings());
  if (c.status !== "ok") return { ...c, saved: false };
  const e = c.estimate;
  const { rowCount } = await q(
    `insert into twin_fire_estimates (lat, lon, ellipse_major_m, ellipse_minor_m, ellipse_orient_deg, n_rays, max_ray_angle_deg, residual_rms_deg, uses_smoke, rays)
     select $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
      where not exists (select 1 from twin_fire_estimates where estimated_at > now() - make_interval(secs => $11))`,
    [e.lat, e.lon, e.ellipse.major, e.ellipse.minor, e.ellipse.orientDeg, c.nRays, c.maxRayAngleDeg, c.residualRmsDeg, e.usesSmoke,
     JSON.stringify(c.rays), LOGGING.estimateIntervalS]);
  return { ...c, saved: rowCount > 0 };
}
