# Muntinlupa Digital Twin + Weather

A 3D digital twin of Muntinlupa City (terrain, 31k buildings, roads, barangays) with
model-based current weather per barangay from Open-Meteo. Built with React, Vite,
Tailwind CSS v4 and React Three Fiber. Adapts to phones, tablets, laptops and big screens.

## Layout by screen size

| Screen | Layout |
|---|---|
| Phone (< 768 px) | Full-screen 3D, top bar, bottom sheet with Weather / Places / Layers / Cameras tabs. Portrait view looks north along the city. |
| Tablet (768 to 1023 px) | Same tabs in a floating card at the bottom-left |
| Laptop / PC (>= 1024 px) | Side panel on the left, weather card top-right, building details bottom-right |
| Big screen (>= 1920 px) | Same as PC, with the whole interface scaled up (root font size grows at 1920, 2560 and 3800 px) |

Touch: one finger pans, two fingers zoom and rotate, tap a building for details.

On laptop/PC the side panel and weather card each have a **Hide** button; the browser
remembers the choice. **Wind animation** (Layers) draws streaks moving with the current
wind reading at the selected place: one value for the whole city, sped up 40x to be visible.

## Project structure

| Path | What it is |
|---|---|
| `src/App.jsx` | Data loading, state, responsive layout, camera framing per screen shape |
| `src/components/TwinScene.jsx` | 3D canvas: layers, labels, camera markers, fly-to, tap/click picking |
| `src/components/Panels.jsx` | Title, layers, color mode + legend, places, cameras CSV, building details |
| `src/components/WeatherCard.jsx` | Weather hook (10-min refresh), full card and one-line summary |
| `src/lib/twinGeometry.js` | Builds terrain, roads, sidewalks, merged buildings, boundaries from the JSON |
| `src/lib/weather.js` | Local meters to lat/lon, Open-Meteo fetch with cache, weather-code text |
| `src/lib/cameras.js` | Parses a user-loaded cameras.csv (lat/lon to local meters) |
| `public/data/*.json` | City data: 30 m DEM, buildings, roads, barangays (EPSG:32651, local meters) |
| `vercel.json` | Vite build settings for Vercel and 1-hour caching of the data files |

## Run locally

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build into dist/
```

## Deploy

Pushing to `main` redeploys on Vercel automatically. `vercel.json` tells Vercel to run
`npm run build` and serve `dist/`.

## Data notes

- Weather: [Open-Meteo](https://open-meteo.com/) (CC BY 4.0), free for non-commercial use, no API key.
  Values are model estimates for the nearest grid point, not ground sensor readings.
- Building heights: about 98% are an estimated 6 m default (2 storeys x 3 m); use the
  "Height source" color mode to see which.
- AI-SUNOG cameras appear only after a cameras.csv with real positions is loaded.
  Marker height (25 m) and cone length (600 m) are display sizes only.
