// cameras.js
// Reads a cameras.csv the user loads (nothing is ever placed without it) and converts
// each camera's lat/lon to the twin's local meters. Required columns: lat, lon
// (or latitude/longitude). Optional: name, heading_deg, fov_deg.
// Heading is read as a compass bearing: 0° = north, clockwise.

/** WGS84 lat/lon -> UTM zone 51N [easting, northing] (Transverse Mercator series). */
export function latLonToUtm51(lat, lon) {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const phi = (lat * Math.PI) / 180, lam = (lon * Math.PI) / 180, lam0 = (123 * Math.PI) / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const t = Math.tan(phi) ** 2, C = ep2 * Math.cos(phi) ** 2, A = Math.cos(phi) * (lam - lam0);
  const M = a * ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * phi
    - ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi)
    + ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi)
    - ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi));
  const E = k0 * N * (A + ((1 - t + C) * A ** 3) / 6 + ((5 - 18 * t + t * t + 72 * C - 58 * ep2) * A ** 5) / 120) + 500000;
  const Nn = k0 * (M + N * Math.tan(phi) * ((A * A) / 2 + ((5 - t + 9 * C + 4 * C * C) * A ** 4) / 24
    + ((61 - 58 * t + t * t + 600 * C - 330 * ep2) * A ** 6) / 720));
  return [E, Nn];
}

/** Parse CSV text into cameras in local meters. Returns { cams, skipped, error }. */
export function parseCamerasCsv(text, originUtm) {
  const rows = text.trim().split(/\r?\n/).map((l) => l.split(",").map((c) => c.trim()));
  const hdr = (rows.shift() || []).map((h) => h.toLowerCase());
  const col = (...names) => names.map((n) => hdr.indexOf(n)).find((i) => i >= 0);
  const iLat = col("lat", "latitude"), iLon = col("lon", "lng", "longitude");
  const iName = col("name", "camera_name", "label", "id");
  const iHd = col("heading_deg", "heading"), iFov = col("fov_deg", "fov");
  if (iLat === undefined || iLon === undefined) {
    return { cams: [], skipped: rows.length, error: `No lat/lon columns found. Columns: ${hdr.join(", ") || "none"}` };
  }
  const cams = [];
  let skipped = 0;
  rows.forEach((r, i) => {
    const lat = parseFloat(r[iLat]), lon = parseFloat(r[iLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) { skipped++; return; }
    const [E, N] = latLonToUtm51(lat, lon);
    const heading = iHd !== undefined ? parseFloat(r[iHd]) : NaN;
    const fov = iFov !== undefined ? parseFloat(r[iFov]) : NaN;
    cams.push({
      id: i,
      name: iName !== undefined && r[iName] ? r[iName] : `Camera ${i + 1}`,
      lat, lon,
      x: E - originUtm[0],
      y: N - originUtm[1],
      heading: Number.isFinite(heading) ? heading : null,
      fov: Number.isFinite(fov) ? fov : null,
    });
  });
  return { cams, skipped, error: null };
}
