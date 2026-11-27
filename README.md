# Muntinlupa Digital Twin + Weather

A standalone 3D digital twin of Muntinlupa City (terrain, 31k buildings, roads, barangays)
with model-based current weather per barangay from Open-Meteo. Static site: no build step.

## Files

| Path | What it is |
|---|---|
| `index.html` | The viewer: Three.js scene, side panel, weather card |
| `weather.js` | Local meters to lat/lon, Open-Meteo fetch with 10-min cache, weather code text |
| `data/terrain.json` | 30 m DEM grid (EPSG:32651, local meters from `origin_utm`) |
| `data/buildings.json` | Building footprints, heights, height source |
| `data/roads.json` | Road and sidewalk polygons |
| `data/barangays.json` | Barangay outlines, labels, 2018 population |
| `vercel.json` | Caches the data files for 1 hour |

## Deploy

Vercel: import this repo, framework preset **Other**, no build command, output directory `.` (root).
Every push to `main` redeploys automatically.

## Data notes

- Weather: [Open-Meteo](https://open-meteo.com/) (CC BY 4.0), free for non-commercial use, no API key.
  Values are model estimates for the nearest grid point, not ground sensor readings.
- Building heights: about 98% are an estimated 6 m default (2 storeys x 3 m); use the
  "Height source" color mode to see which.
