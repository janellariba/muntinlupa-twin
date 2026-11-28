// triangulation.js
// Port of dt-step4-ui server/app/triangulation.py (bearing-only triangulation) and the
// true-north handling of server/app/geo.py, working in the twin's UTM 51N metres.
//
// Each observation is a ray: origin p and unit direction d. The estimate x minimises the weighted
// sum of squared perpendicular distances to every ray:
//   A = sum w (I - d d^T),  b = sum w (I - d d^T) p,  x = A^-1 b,  w = 1 / (range * sigma)^2
// Because w depends on x the solve is repeated. A^-1 is the 2x2 covariance -> 95% ellipse.
// REJECTED when: fewer than 2 rays, lines nearly parallel, estimate behind a camera, or beyond max range.
import { latLonToUtm51 } from "./cameras.js";

const CHI2_2DOF_95 = 5.991464547107979; // chi-square, 2 degrees of freedom, 95% (statistics constant)
const MIN_SIGMA_RAD = 1e-6;             // numerical floor so a zero-noise case does not divide by zero
const WGS84_A = 6378137, WGS84_E2 = 0.0066943799901413165; // WGS84 ellipsoid (same as pyproj)
const rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;

/** Point `dist` metres from lat/lon along a TRUE bearing, using the WGS84 ellipsoid's local radii
 *  (north-south radius M and east-west radius N differ, so a sphere would bend the direction ~0.2°). */
function destination(lat, lon, bearingDeg, dist) {
  const p = rad(lat), s = Math.sin(p), w = 1 - WGS84_E2 * s * s;
  const M = (WGS84_A * (1 - WGS84_E2)) / Math.pow(w, 1.5), N = WGS84_A / Math.sqrt(w);
  const th = rad(bearingDeg);
  return [lat + deg((dist * Math.cos(th)) / M), lon + deg((dist * Math.sin(th)) / (N * Math.cos(p)))];
}

/** Ray in local metres for a TRUE bearing. Like geo.ray_in_crs: projecting a second point 1 km away
 *  handles the ~0.5° gap between true north and UTM grid north without a convergence formula. */
export function rayFromBearing(lat, lon, trueBearingDeg, originUtm) {
  const [e0, n0] = latLonToUtm51(lat, lon);
  const [e1, n1] = latLonToUtm51(...destination(lat, lon, trueBearingDeg, 100)); // 100 m probe
  const dx = e1 - e0, dy = n1 - n0, L = Math.hypot(dx, dy);
  return { origin: [e0 - originUtm[0], n0 - originUtm[1]], dir: [dx / L, dy / L] };
}

function solve(rays, weights) {
  let a00 = 0, a01 = 0, a11 = 0, b0 = 0, b1 = 0;
  rays.forEach((r, i) => {
    const [dx, dy] = r.dir, w = weights[i];
    const p00 = 1 - dx * dx, p01 = -dx * dy, p11 = 1 - dy * dy; // P = I - d d^T
    a00 += w * p00; a01 += w * p01; a11 += w * p11;
    b0 += w * (p00 * r.origin[0] + p01 * r.origin[1]);
    b1 += w * (p01 * r.origin[0] + p11 * r.origin[1]);
  });
  const det = a00 * a11 - a01 * a01;
  return { A: [a00, a01, a11], x: [(a11 * b0 - a01 * b1) / det, (a00 * b1 - a01 * b0) / det], det };
}

/** rays: [{ id, origin:[x,y], dir:[dx,dy] }]. Returns { status, reason, point, cov, nRays, maxRayAngleDeg, residualRmsDeg, ranges }. */
export function triangulate(rays, { minRayAngleDeg, maxRangeM, bearingSigmaDeg }, iterations = 3) {
  const n = rays.length;
  if (n < 2) return { status: "rejected", reason: `Need at least 2 bearings, got ${n}. One bearing is direction only, not a location.`, nRays: n };

  let widest = 0; // widest angle between any two lines, 0..90°
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const dot = Math.abs(rays[i].dir[0] * rays[j].dir[0] + rays[i].dir[1] * rays[j].dir[1]);
    widest = Math.max(widest, deg(Math.acos(Math.min(1, dot))));
  }
  if (widest < minRayAngleDeg) {
    return { status: "rejected", reason: `Bearing lines are nearly parallel (widest angle ${widest.toFixed(1)}°, minimum ${minRayAngleDeg}°).`, nRays: n, maxRayAngleDeg: widest };
  }

  const sig = Math.max(rad(bearingSigmaDeg), MIN_SIGMA_RAD);
  let { A, x, det } = solve(rays, rays.map(() => 1)); // first guess: unweighted
  for (let it = 0; it < iterations; it++) {
    const w = rays.map((r) => 1 / (Math.max(Math.hypot(x[0] - r.origin[0], x[1] - r.origin[1]), 1) * sig) ** 2);
    ({ A, x, det } = solve(rays, w));
  }

  const ranges = {};
  for (const r of rays) {
    const vx = x[0] - r.origin[0], vy = x[1] - r.origin[1];
    const along = r.dir[0] * vx + r.dir[1] * vy, R = Math.hypot(vx, vy);
    ranges[r.id] = R;
    if (along <= 0) return { status: "rejected", reason: `Estimate is behind camera ${r.name || r.id}; the bearings do not meet in front of the cameras.`, nRays: n, maxRayAngleDeg: widest };
    if (R > maxRangeM) return { status: "rejected", reason: `Estimate is ${R.toFixed(0)} m from ${r.name || r.id}, beyond max range ${maxRangeM} m.`, nRays: n, maxRayAngleDeg: widest };
  }

  // Angular residuals: how far each line misses the estimate (2 lines always meet exactly).
  let rms = null;
  if (n > 2) {
    const res = rays.map((r) => {
      const vx = x[0] - r.origin[0], vy = x[1] - r.origin[1];
      return deg(Math.atan2(Math.abs(r.dir[0] * vy - r.dir[1] * vx), r.dir[0] * vx + r.dir[1] * vy));
    });
    rms = Math.sqrt(res.reduce((s, e) => s + e * e, 0) / n);
  }
  const [a00, a01, a11] = A; // covariance = A^-1
  const cov = [a11 / det, -a01 / det, a00 / det];
  return { status: "ok", point: x, cov, nRays: n, maxRayAngleDeg: widest, residualRmsDeg: rms, ranges };
}

/** 95% error ellipse: { major, minor (semi-axes, m), orientDeg (clockwise from grid north, 0..180) }. */
export function ellipse95([c00, c01, c11]) {
  const tr = c00 + c11, dt = c00 * c11 - c01 * c01, disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - dt));
  const l1 = Math.max(0, tr / 2 + disc), l2 = Math.max(0, tr / 2 - disc);
  let vE, vN; // eigenvector of the larger eigenvalue
  if (Math.abs(c01) > 1e-12) { vE = l1 - c11; vN = c01; } else if (c00 >= c11) { vE = 1; vN = 0; } else { vE = 0; vN = 1; }
  const orient = ((deg(Math.atan2(vE, vN)) % 180) + 180) % 180;
  return { major: Math.sqrt(CHI2_2DOF_95 * l1), minor: Math.sqrt(CHI2_2DOF_95 * l2), orientDeg: orient };
}

/** Pinhole pixel -> true bearing (approved temporary model, see detectionConfig.js). */
export function pixelToBearing(cx, width, headingDeg, fovDeg) {
  const off = deg(Math.atan(((cx - width / 2) / (width / 2)) * Math.tan(rad(fovDeg) / 2)));
  return (((headingDeg + off) % 360) + 360) % 360;
}
