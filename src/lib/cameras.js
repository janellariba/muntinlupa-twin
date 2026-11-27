// cameras.js
// WGS84 latitude/longitude -> UTM zone 51N, used to place configured cameras in the twin.

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
