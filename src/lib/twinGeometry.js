// twinGeometry.js
// Pure Three.js builders for the Muntinlupa digital twin. No React in here, so the
// same code can be reused by the dashboard, tests, or a standalone viewer.
//
// Coordinate convention (matches the processed JSON files):
//   data:  local meters from the DEM centre in EPSG:32651 (x = east, y = north)
//   three: [x, elevation, -y]   (three.js is Y-up; north points to -Z)

import * as THREE from "three";

export const toThree = (x, y, h) => [x, h, -y];

/* ---------------- terrain ---------------- */

// DEM cells with value 0 lie outside the clipped city boundary, so they count as "no data".
const isValid = (v) => v > 0;

/** Returns ground(x, y): bilinear elevation (m) from the DEM at local meters. */
export function makeGroundSampler(terrain) {
  const D = terrain.meta.dem;
  const Z = terrain.z;
  const { w: W, h: H, res: R } = D;
  return function ground(x, y) {
    let c = (x - D.left) / R - 0.5;
    let r = (D.top - y) / R - 0.5;
    c = Math.min(Math.max(c, 0), W - 1.001);
    r = Math.min(Math.max(r, 0), H - 1.001);
    const c0 = c | 0, r0 = r | 0, fc = c - c0, fr = r - r0, i = r0 * W + c0;
    const a = Z[i], b = Z[i + 1], d = Z[i + W], e = Z[i + W + 1];
    const vals = [a, b, d, e].filter(isValid);
    if (vals.length < 4) return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
    return a * (1 - fc) * (1 - fr) + b * fc * (1 - fr) + d * (1 - fc) * fr + e * fc * fr;
  };
}

const ELEV_RAMP = [
  [0, [0.29, 0.42, 0.33]],
  [15, [0.42, 0.52, 0.36]],
  [35, [0.6, 0.6, 0.42]],
  [60, [0.62, 0.52, 0.38]],
  [95, [0.78, 0.72, 0.62]],
];
function rampAt(h) {
  for (let k = 1; k < ELEV_RAMP.length; k++) {
    if (h <= ELEV_RAMP[k][0]) {
      const [h0, c0] = ELEV_RAMP[k - 1], [h1, c1] = ELEV_RAMP[k];
      const t = (h - h0) / (h1 - h0);
      return c0.map((v, j) => v + (c1[j] - v) * t);
    }
  }
  return ELEV_RAMP.at(-1)[1];
}

/** Elevation-coloured terrain mesh geometry; cells outside the city are skipped. */
export function buildTerrainGeometry(terrain) {
  const D = terrain.meta.dem, Z = terrain.z, W = D.w, H = D.h, R = D.res;
  const pos = new Float32Array(W * H * 3);
  const col = new Float32Array(W * H * 3);
  const idx = [];
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const i = r * W + c;
      const x = D.left + (c + 0.5) * R, y = D.top - (r + 0.5) * R, h = Z[i];
      pos.set(toThree(x, y, isValid(h) ? h : 0), i * 3);
      col.set(rampAt(h), i * 3);
    }
  }
  for (let r = 0; r < H - 1; r++) {
    for (let c = 0; c < W - 1; c++) {
      const a = r * W + c, b = a + 1, d = a + W, e = d + 1;
      if (isValid(Z[a]) && isValid(Z[b]) && isValid(Z[d]) && isValid(Z[e])) idx.push(a, d, b, b, d, e);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ---------------- roads and sidewalks ---------------- */

export const ROAD_COLORS = [
  "#e8c26a", "#e0b25a", "#d9a75a", "#cfc6b0", "#bdb8aa",
  "#a7a49b", "#8e8c86", "#b9a98f", "#9f9a8f", "#8e8c86",
].map((c) => new THREE.Color(c));
export const SIDEWALK_COLOR = new THREE.Color("#6f7a74");

/**
 * Triangulates polygons and drapes every vertex onto the terrain.
 * polys: array of [rings, classIndex], where rings = [outerFlat, holeFlat, ...]
 *        and each flat ring is [x0, y0, x1, y1, ...] in local meters.
 */
export function buildDrapedGeometry(polys, lift, colorOf, ground) {
  const pos = [], col = [];
  for (const [rings, ci] of polys) {
    const v2 = rings.map((f) => {
      const a = [];
      for (let k = 0; k < f.length; k += 2) a.push(new THREE.Vector2(f[k], f[k + 1]));
      return a;
    });
    if (!v2[0] || v2[0].length < 3) continue;
    if (THREE.ShapeUtils.isClockWise(v2[0])) v2[0].reverse();
    for (let h = 1; h < v2.length; h++) if (!THREE.ShapeUtils.isClockWise(v2[h])) v2[h].reverse();
    const tris = THREE.ShapeUtils.triangulateShape(v2[0], v2.slice(1));
    const all = v2.flat(), c = colorOf(ci);
    for (const t of tris) {
      for (const k of t) {
        const p = all[k];
        pos.push(...toThree(p.x, p.y, ground(p.x, p.y) + lift));
        col.push(c.r, c.g, c.b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/* ---------------- buildings ---------------- */

/**
 * Builds ALL buildings into one merged geometry (one draw call instead of 31k meshes).
 * Each building entry: [outerFlat, height_m, groundElev, typeIndex, heightSource, name?]
 * Returns { geometry, owner, vStart }:
 *   owner[triangleIndex]  -> building index (for click picking)
 *   vStart[b]..vStart[b+1] -> vertex range of building b (for recolouring / highlight)
 */
export function buildBuildingGeometry(buildings) {
  const n = buildings.length;
  const pos = [], nor = [], owner = [];
  const vStart = new Int32Array(n + 1);
  for (let b = 0; b < n; b++) {
    vStart[b] = pos.length / 3;
    const [f, ht, gz] = buildings[b];
    const base = gz - 1.5; // sink the base slightly so buildings on slopes never float
    const top = gz + ht;
    const pts = [];
    for (let k = 0; k < f.length; k += 2) pts.push(new THREE.Vector2(f[k], f[k + 1]));
    if (pts.length < 3) continue;
    if (THREE.ShapeUtils.isClockWise(pts)) pts.reverse();
    // walls: one quad (2 triangles) per edge, with an outward horizontal normal
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], c = pts[(i + 1) % pts.length];
      const nx = c.y - a.y, ny = -(c.x - a.x), L = Math.hypot(nx, ny) || 1;
      const quad = [[a, base], [c, base], [c, top], [a, base], [c, top], [a, top]];
      for (const [p, h] of quad) {
        pos.push(...toThree(p.x, p.y, h));
        nor.push(nx / L, 0, -ny / L);
      }
      owner.push(b, b);
    }
    // flat roof
    for (const t of THREE.ShapeUtils.triangulateShape(pts, [])) {
      for (const k of t) {
        pos.push(...toThree(pts[k].x, pts[k].y, top));
        nor.push(0, 1, 0);
      }
      owner.push(b);
    }
  }
  vStart[n] = pos.length / 3;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(vStart[n] * 3), 3));
  return { geometry: g, owner: Int32Array.from(owner), vStart };
}

function useColor(type) {
  if (/school|college|university|kindergarten/.test(type)) return "#f2a33a";
  if (/hospital|clinic/.test(type)) return "#e86a6a";
  if (/church|chapel|religious|cathedral|mosque|temple/.test(type)) return "#b48ee0";
  if (/commercial|retail|office|hotel|supermarket/.test(type)) return "#5fb3d6";
  if (/industrial|warehouse|storage|factory/.test(type)) return "#8f9aa6";
  if (/public|civic|government|townhall|fire_station|police/.test(type)) return "#6fd0a8";
  return "#d9d4c7";
}
export const USE_LEGEND = [
  ["#d9d4c7", "Residential / unspecified"], ["#5fb3d6", "Commercial / office"],
  ["#f2a33a", "School / college"], ["#e86a6a", "Hospital / clinic"],
  ["#b48ee0", "Religious"], ["#6fd0a8", "Civic / public"], ["#8f9aa6", "Industrial / storage"],
];
export const SOURCE_COLORS = ["#4fd18b", "#5fb3d6", "#c9a0f0", "#e8794a"];
const H_STOPS = [[3, "#e7e1d2"], [9, "#e8c26a"], [20, "#e8904a"], [45, "#d9534f"], [100, "#7b2d6b"]];
export const HEIGHT_LEGEND = H_STOPS.map(([h, c]) => [c, `${h} m`]);
function heightColor(h) {
  for (let k = 1; k < H_STOPS.length; k++) {
    if (h <= H_STOPS[k][0]) {
      const t = Math.max(0, (h - H_STOPS[k - 1][0]) / (H_STOPS[k][0] - H_STOPS[k - 1][0]));
      return new THREE.Color(H_STOPS[k - 1][1]).lerp(new THREE.Color(H_STOPS[k][1]), t);
    }
  }
  return new THREE.Color(H_STOPS.at(-1)[1]);
}

/** Per-vertex colours for a mode: "type" | "height" | "source". */
export function buildingColors(buildings, types, vStart, mode) {
  const n = buildings.length;
  const arr = new Float32Array(vStart[n] * 3);
  const c = new THREE.Color();
  for (let b = 0; b < n; b++) {
    const [, ht, , ti, src] = buildings[b];
    if (mode === "type") c.set(useColor(types[ti]));
    else if (mode === "height") c.copy(heightColor(ht));
    else c.set(SOURCE_COLORS[src]);
    for (let v = vStart[b]; v < vStart[b + 1]; v++) arr.set([c.r, c.g, c.b], v * 3);
  }
  return arr;
}

/* ---------------- barangay boundaries ---------------- */

/** One LineSegments geometry for all barangay outlines, draped 4 m above the ground. */
export function buildBoundaryGeometry(barangays, ground) {
  const pts = [];
  for (const b of barangays) {
    for (const poly of b.polys) {
      const f = poly[0]; // outer ring
      for (let k = 0; k < f.length; k += 2) {
        const k2 = (k + 2) % f.length;
        pts.push(
          new THREE.Vector3(...toThree(f[k], f[k + 1], ground(f[k], f[k + 1]) + 4)),
          new THREE.Vector3(...toThree(f[k2], f[k2 + 1], ground(f[k2], f[k2 + 1]) + 4))
        );
      }
    }
  }
  return new THREE.BufferGeometry().setFromPoints(pts);
}

/* ---------------- everything at once ---------------- */

/** Builds every layer from the four JSON files. Heavy: call once and memoise. */
export function buildTwin({ terrain, roads, buildings, barangays }) {
  const ground = makeGroundSampler(terrain);
  const bld = buildBuildingGeometry(buildings);
  return {
    ground,
    meta: terrain.meta,
    terrain: buildTerrainGeometry(terrain),
    roads: buildDrapedGeometry(roads.roads.map(([rings, ci]) => [rings, ci]), 1.0, (ci) => ROAD_COLORS[ci], ground),
    sidewalks: buildDrapedGeometry(roads.sidewalks.map((rings) => [rings, 0]), 0.7, () => SIDEWALK_COLOR, ground),
    buildings: bld,
    boundaries: buildBoundaryGeometry(barangays.barangays, ground),
    labels: barangays.barangays.map((b) => ({
      name: b.name,
      pop2018: b.pop2018,
      x: b.label[0],
      y: b.label[1],
      position: toThree(b.label[0], b.label[1], ground(b.label[0], b.label[1]) + 60),
    })),
  };
}
