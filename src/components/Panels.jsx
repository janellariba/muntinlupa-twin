// Panels.jsx
// Control panels shared by the desktop sidebar and the phone/tablet bottom sheet.
import { USE_LEGEND, HEIGHT_LEGEND, SOURCE_COLORS } from "../lib/twinGeometry";

export const H2 = ({ children }) => (
  <h2 className="mb-2 font-display text-sm font-semibold uppercase tracking-[0.08em] text-muted">{children}</h2>
);

export function TitleBlock({ stats }) {
  return (
    <div>
      <h1 className="font-display text-3xl font-bold uppercase leading-none tracking-wide">
        Muntinlupa <span className="text-accent">Digital Twin</span>
      </h1>
      <p className="mt-1.5 text-xs text-muted">EPSG:32651 · UTM 51N · 30 m DEM · OSM buildings and roads</p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {[[stats.buildings, "buildings"], [stats.roads, "road segments"], [stats.maxElev, "max elev. (m)"]].map(([n, l]) => (
          <div key={l}>
            <b className="block font-display text-xl leading-none tabular-nums">{n ?? "-"}</b>
            <small className="text-[0.7rem] text-muted">{l}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

const LAYER_LABELS = {
  terrain: "Terrain", buildings: "Buildings", roads: "Roads", sidewalks: "Sidewalks",
  barangays: "Barangay boundaries", cameras: "AI-SUNOG cameras",
};

export function LayersPanel({ visible, onToggle }) {
  return (
    <div>
      <H2>Layers</H2>
      <div className="grid grid-cols-2 gap-x-3 lg:grid-cols-1">
        {Object.entries(LAYER_LABELS).map(([k, label]) => (
          <label key={k} className="flex cursor-pointer items-center gap-2.5 py-1.5 text-sm">
            <input type="checkbox" className="size-4 accent-[#f2a33a]" checked={visible[k]} onChange={() => onToggle(k)} />
            {label}
          </label>
        ))}
      </div>
    </div>
  );
}

export function ColorPanel({ mode, onMode, heightSources, sourceCounts }) {
  const legend =
    mode === "type" ? USE_LEGEND
    : mode === "height" ? HEIGHT_LEGEND
    : heightSources.map((s, i) => [SOURCE_COLORS[i], `${s} (${(sourceCounts[i] ?? 0).toLocaleString()})`]);
  return (
    <div>
      <H2>Color buildings by</H2>
      <div className="flex gap-1.5" role="group" aria-label="Building color mode">
        {[["type", "Use"], ["height", "Height"], ["source", "Height source"]].map(([m, label]) => (
          <button key={m} className="chip flex-1" aria-pressed={mode === m} onClick={() => onMode(m)}>{label}</button>
        ))}
      </div>
      <ul className="mt-2.5 grid gap-1 text-xs">
        {legend.map(([c, t]) => (
          <li key={t} className="flex items-center gap-2">
            <span className="size-3 shrink-0 rounded-sm" style={{ background: c }} />{t}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PlacesPanel({ labels, current, onPlace, onOverview, autoOrbit, onOrbit }) {
  return (
    <div>
      <H2>Fly to barangay</H2>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-2">
        {labels.map((l) => (
          <button key={l.name} className="chip text-left" aria-pressed={current === l.name} onClick={() => onPlace(l)}>{l.name}</button>
        ))}
      </div>
      <div className="mt-2 flex gap-1.5">
        <button className="chip flex-1" onClick={onOverview}>City overview</button>
        <button className="chip flex-1" aria-pressed={autoOrbit} onClick={onOrbit}>Auto orbit</button>
      </div>
    </div>
  );
}

export function CamerasPanel({ cams, note, onFile }) {
  return (
    <div>
      <H2>AI-SUNOG cameras</H2>
      <span className="inline-block rounded-full border border-accent px-2 py-0.5 font-mono text-[0.68rem] font-semibold tracking-wide text-accent">
        {cams.length ? `${cams.length} CAMERA${cams.length > 1 ? "S" : ""} FROM CSV` : "POSITIONS PENDING"}
      </span>
      <p className="mt-2 text-xs text-muted">{note}</p>
      <label className="mt-2 block text-xs text-muted">
        Load cameras.csv (needs lat, lon; optional name, heading_deg, fov_deg)
        <input type="file" accept=".csv,text/csv" onChange={onFile}
          className="mt-1.5 block w-full text-xs text-ink file:chip file:mr-2" />
      </label>
      <p className="mt-2 text-xs text-muted">Heading is a compass bearing (0° = north, clockwise). Marker and cone sizes are display only.</p>
    </div>
  );
}

export function BuildingInfo({ info, types, heightSources, onClose }) {
  if (!info) return null;
  const [, ht, gz, ti, src, name] = info;
  return (
    <section aria-live="polite">
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-display text-lg font-semibold uppercase tracking-wide">{name || "Building"}</h2>
        <button className="chip px-2 py-1 text-xs" onClick={onClose} aria-label="Close building details">Close</button>
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted">Use</dt><dd className="font-mono">{types[ti]}</dd>
        <dt className="text-muted">Height</dt><dd className="font-mono tabular-nums">{ht.toFixed(1)} m</dd>
        <dt className="text-muted">Source</dt><dd className={src === 3 ? "text-accent" : ""}>{heightSources[src]}</dd>
        <dt className="text-muted">Ground</dt><dd className="font-mono tabular-nums">{gz.toFixed(1)} m (DEM)</dd>
        <dt className="text-muted">Roof</dt><dd className="font-mono tabular-nums">{(gz + ht).toFixed(1)} m</dd>
      </dl>
    </section>
  );
}
