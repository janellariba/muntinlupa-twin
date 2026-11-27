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

Click or tap a barangay (or a building in it) to outline it in amber and pin its weather.
With a mouse, the weather card follows the barangay under the pointer (white outline);
clicking pins it. Clicking outside the city shows the whole-city weather again.
Each barangay's reading is cached for 10 minutes.

On laptop/PC the side panel and weather card each have a **Hide** button; the browser
remembers the choice. **Wind** (Layers) draws small dark comet marks moving with the current
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
- Cameras appear only after you add them in Camera config. The mast height (30 m) is a display size only.

## Cameras (Camera config)

1. Open **Camera config** (side panel, or the **Cameras** tab on a phone).
2. Enter the camera's **latitude** and **longitude** (decimal degrees, for example 14.408123, 121.041567)
   and its **camera index**. **Detect cameras** lists every webcam on this device with its index and name;
   click one to use its index.
3. **Add camera**. An amber mark appears on the map. Points outside Muntinlupa, or with latitude and
   longitude swapped, are refused with a message.
4. Click the mark (or **Show** in the list) to open a small popup with the live stream. Click the mark
   again, the x, or press Esc to close it; the webcam is released when the popup closes.
5. The **Cameras** layer shows or hides all marks.

Notes:
- The stream opens the webcam with that index **on the computer or phone viewing the page** (browser
  camera access, nothing is uploaded). It is not the AI-SUNOG server feed.
- The browser numbers cameras in its own order, which can differ from OpenCV's `device_index` used by
  the camera node. The popup and the Detect list show each camera's name so you can check.
- A webcam can be used by one program at a time on Windows. If the camera node is using it, the popup
  says the camera is busy.
- Cameras are saved in this browser only (localStorage). Another browser or device starts empty.

## Backup

The version before Camera config is kept on the branch **`backup/before-camera-config`**
(commit `0493e9c`). To go back: in Vercel, open the project's Deployments and use **Instant Rollback**
on that commit's deployment, or run `git revert` on the camera commit and push.
