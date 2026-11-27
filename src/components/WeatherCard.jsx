// WeatherCard.jsx
// Current weather for the selected place, from Open-Meteo (no API key; CC BY 4.0 credit shown).
// useWeather() fetches and refreshes every 10 minutes; WeatherCard shows full details and
// WeatherSummary is the one-line version for the collapsed phone sheet.
import { useEffect, useMemo, useState } from "react";
import { localToLatLon, fetchCurrentWeather, describeWeather, compass } from "../lib/weather";

const REFRESH_MS = 10 * 60 * 1000;

export function useWeather(place, originUtm) {
  const [state, setState] = useState({ status: "idle" });
  const [lat, lon] = useMemo(
    () => (place && originUtm ? localToLatLon(place.x, place.y, originUtm) : [null, null]),
    [place, originUtm]
  );
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (lat == null) return;
    const ctrl = new AbortController();
    const load = () => {
      setState((s) => ({ ...s, status: s.data ? "refreshing" : "loading" }));
      fetchCurrentWeather(lat, lon, { signal: ctrl.signal })
        .then((data) => setState({ status: "ok", data }))
        .catch((e) => e.name !== "AbortError" && setState({ status: "error", message: e.message }));
    };
    setState({ status: "loading" });
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => { ctrl.abort(); clearInterval(id); };
  }, [lat, lon, attempt]);
  return { ...state, lat, lon, retry: () => setAttempt((n) => n + 1) };
}

const fmt = (v, u, key, digits = 0) => (v?.[key] == null ? "-" : `${v[key].toFixed(digits)}${u?.[key] ? " " + u[key] : ""}`);

export function WeatherSummary({ place, w }) {
  const v = w.data?.values;
  return (
    <div className="min-w-0 text-sm">
      <span className="block truncate font-display text-base font-semibold uppercase leading-tight tracking-wide">{place?.name}</span>
      {v ? (
        <span className="block truncate text-muted tabular-nums">
          <b className="text-ink">{v.temperature_2m?.toFixed(1)}°C</b> · {describeWeather(v.weather_code)} · {v.relative_humidity_2m}% RH
        </span>
      ) : (
        <span className="block text-muted">{w.status === "error" ? "Weather unavailable" : "Loading weather…"}</span>
      )}
    </div>
  );
}

export default function WeatherCard({ place, w }) {
  const v = w.data?.values, u = w.data?.units;
  const wd = v?.wind_direction_10m ?? 0;
  return (
    <section aria-live="polite" aria-label="Current weather">
      <h2 className="font-display text-lg font-semibold uppercase leading-tight tracking-wide">{place?.name}</h2>
      {w.lat != null && <p className="font-mono text-[0.7rem] text-muted tabular-nums">{w.lat.toFixed(4)}°N {w.lon.toFixed(4)}°E</p>}

      {w.status === "loading" && <p className="mt-3 text-sm text-muted">Loading current weather…</p>}
      {w.status === "error" && (
        <div className="mt-3 text-sm">
          <p className="text-[#f2a0a0]">Weather unavailable. Check your internet connection.</p>
          <button className="chip mt-2" onClick={w.retry}>Try again</button>
        </div>
      )}

      {v && (
        <>
          <div className="mt-2 flex items-end gap-3">
            <span className="font-display text-5xl font-bold leading-none tabular-nums">{v.temperature_2m?.toFixed(1)}°C</span>
            <span className="pb-1 text-sm">
              {describeWeather(v.weather_code)}
              <span className="block text-muted">Feels like {fmt(v, u, "apparent_temperature", 1)}</span>
            </span>
          </div>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">Humidity</dt><dd className="font-mono tabular-nums">{fmt(v, u, "relative_humidity_2m")}</dd>
            <dt className="text-muted">Precipitation</dt><dd className="font-mono tabular-nums">{fmt(v, u, "precipitation", 1)}</dd>
            <dt className="text-muted">Rain chance</dt><dd className="font-mono tabular-nums">{fmt(v, u, "precipitation_probability")}</dd>
            <dt className="text-muted">Wind</dt>
            <dd className="font-mono tabular-nums">
              {/* arrow shows where the wind blows TO (the "from" direction + 180°) */}
              <span aria-hidden="true" className="mr-1 inline-block text-accent" style={{ transform: `rotate(${wd + 180}deg)` }}>↑</span>
              {fmt(v, u, "wind_speed_10m")} from {compass(wd)}
            </dd>
            <dt className="text-muted">Gusts</dt><dd className="font-mono tabular-nums">{fmt(v, u, "wind_gusts_10m")}</dd>
            <dt className="text-muted">Cloud cover</dt><dd className="font-mono tabular-nums">{fmt(v, u, "cloud_cover")}</dd>
            <dt className="text-muted">Pressure</dt><dd className="font-mono tabular-nums">{fmt(v, u, "pressure_msl")}</dd>
          </dl>
          <p className="mt-3 text-xs leading-snug text-muted">
            Valid {w.data.time.replace("T", " ")} PHT{w.status === "refreshing" ? " · refreshing…" : ""}. Model forecast for the
            nearest grid point, not a ground sensor. Weather data by{" "}
            <a className="underline hover:text-ink" href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo.com</a> (CC BY 4.0)
          </p>
        </>
      )}
    </section>
  );
}
