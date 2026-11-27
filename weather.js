// weather.js
// Current weather for a point in the twin, from Open-Meteo (https://open-meteo.com).
// Free for non-commercial use, no API key. Data licence: CC BY 4.0 (attribution required,
// shown in the weather panel). Free-tier limits: under 10,000 calls/day and 600/minute.
//
// The twin stores positions as local meters from origin_utm (EPSG:32651, UTM zone 51N),
// so this file also converts local meters -> latitude/longitude.

const API = "https://api.open-meteo.com/v1/forecast";

// Variables requested for "current" conditions (all documented Open-Meteo variable names).
const CURRENT = [
  "temperature_2m",
  "apparent_temperature",
  "relative_humidity_2m",
  "precipitation",
  "precipitation_probability",
  "weather_code",
  "cloud_cover",
  "pressure_msl",
  "wind_speed_10m",
  "wind_direction_10m",
  "wind_gusts_10m",
  "is_day",
];

/* ---------- UTM zone 51N -> WGS84 latitude/longitude ---------- */

/** Inverse Transverse Mercator (WGS84). Returns [lat, lon] in degrees. */
export function utm51ToLatLon(easting, northing) {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996;
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const lon0 = (123 * Math.PI) / 180; // central meridian of zone 51
  const x = easting - 500000, y = northing; // northern hemisphere: no false northing
  const M = y / k0;
  const mu = M / (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256));
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const sin1 = Math.sin(phi1), cos1 = Math.cos(phi1), tan1 = Math.tan(phi1);
  const C1 = ep2 * cos1 * cos1, T1 = tan1 * tan1;
  const N1 = a / Math.sqrt(1 - e2 * sin1 * sin1);
  const R1 = (a * (1 - e2)) / Math.pow(1 - e2 * sin1 * sin1, 1.5);
  const D = x / (N1 * k0);
  const lat =
    phi1 -
    ((N1 * tan1) / R1) *
      (D * D / 2 -
        ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4) / 24 +
        ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6) / 720);
  const lon =
    lon0 +
    (D - ((1 + 2 * T1 + C1) * D ** 3) / 6 +
      ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5) / 120) /
      cos1;
  return [(lat * 180) / Math.PI, (lon * 180) / Math.PI];
}

/** Local twin meters -> [lat, lon], using the twin's origin_utm from terrain.json. */
export function localToLatLon(x, y, originUtm) {
  return utm51ToLatLon(originUtm[0] + x, originUtm[1] + y);
}

/* ---------- fetching with a short cache ---------- */

const CACHE_MS = 10 * 60 * 1000; // reuse a reading for 10 min: Open-Meteo updates ~every 15 min
const cache = new Map();

/**
 * Current conditions at lat/lon. Times come back in Philippine time.
 * Returns { values: {temperature_2m, ...}, units: {...}, time, fetchedAt, gridLat, gridLon }.
 */
export async function fetchCurrentWeather(lat, lon, { signal } = {}) {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < CACHE_MS) return hit;

  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current: CURRENT.join(","),
    timezone: "Asia/Manila",
    wind_speed_unit: "kmh",
  });
  const res = await fetch(`${API}?${params}`, { signal });
  if (!res.ok) throw new Error(`Weather service returned HTTP ${res.status}`);
  const j = await res.json();
  if (!j.current) throw new Error("Weather service sent no current conditions");
  const out = {
    values: j.current,
    units: j.current_units || {},
    time: j.current.time, // local time the values are valid for, e.g. "2026-11-27T09:00"
    fetchedAt: Date.now(),
    gridLat: j.latitude, // the model grid point Open-Meteo actually used
    gridLon: j.longitude,
  };
  cache.set(key, out);
  return out;
}

/* ---------- display helpers ---------- */

// WMO weather interpretation codes, as documented by Open-Meteo.
const WMO = {
  0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Fog", 48: "Rime fog",
  51: "Light drizzle", 53: "Drizzle", 55: "Dense drizzle",
  56: "Freezing drizzle", 57: "Freezing drizzle",
  61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
  66: "Freezing rain", 67: "Freezing rain",
  71: "Slight snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
  80: "Slight rain showers", 81: "Rain showers", 82: "Violent rain showers",
  85: "Snow showers", 86: "Heavy snow showers",
  95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Thunderstorm with heavy hail",
};
export const describeWeather = (code) => WMO[code] ?? `Weather code ${code}`;

/** 0-360 degrees (direction the wind comes FROM) -> 16-point compass label. */
export function compass(deg) {
  const pts = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return pts[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}
