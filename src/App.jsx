// App.jsx
// Loads the city data, builds the 3D geometry, and lays out the interface:
//   lg and up (laptop, PC, big screen): left sidebar + weather card top-right + building card bottom-right
//   below lg (phone, tablet): top bar + bottom sheet with tabs (Weather, Places, Layers, Cameras)
import { useCallback, useEffect, useMemo, useState } from "react";
import TwinScene, { WIND_SPEEDUP } from "./components/TwinScene";
import WeatherCard, { useWeather, WeatherSummary } from "./components/WeatherCard";
import { TitleBlock, LayersPanel, ColorPanel, PlacesPanel, CamerasPanel, BuildingInfo } from "./components/Panels";
import { buildTwin, toThree } from "./lib/twinGeometry";
import { parseCamerasCsv } from "./lib/cameras";

const FILES = ["terrain", "roads", "buildings", "barangays"];
const CITY = { name: "Muntinlupa City", x: 0, y: 0 }; // 0,0 = DEM centre

/* Remember the desktop panel choices between visits (one browser only; safe if storage is blocked). */
const remembered = (key, fallback) => { try { const v = localStorage.getItem(key); return v == null ? fallback : v === "1"; } catch { return fallback; } };
const remember = (key, on) => { try { localStorage.setItem(key, on ? "1" : "0"); } catch { /* storage unavailable */ } };

/* Camera framing per screen shape. Portrait screens look north along the city's long axis.
   `panels` = whether the desktop side panel / weather card are open (they cover the screen edges). */
function framing(kind, panels) {
  const portrait = window.innerWidth < window.innerHeight;
  const wide = window.innerWidth >= 1024 && (panels.side || panels.weather);
  if (kind === "overview") {
    return portrait
      ? { dx: -600, dy: -1200, dist: 21500, dir: [0.06, 0.86, 0.5] }
      : { dx: wide && panels.side ? -1300 : 0, dy: -300, dist: wide ? 17000 : 14500, dir: [0.45, 0.75, 0.5] };
  }
  return portrait ? { dx: 0, dy: -300, dist: 3600, dir: [0.06, 0.86, 0.5] } : { dx: 0, dy: 0, dist: 2600, dir: [0.45, 0.75, 0.5] };
}

export default function App() {
  const [data, setData] = useState(null);
  const [loaded, setLoaded] = useState(0);
  const [error, setError] = useState("");
  const [twin, setTwin] = useState(null);

  const [visible, setVisible] = useState({ terrain: true, buildings: true, roads: true, sidewalks: true, barangays: true, cameras: true, wind: false });
  const [showSide, setShowSide] = useState(() => remembered("twin.sidePanel", true));
  const [showWeather, setShowWeather] = useState(() => remembered("twin.weatherCard", true));
  const toggleSide = (on) => { setShowSide(on); remember("twin.sidePanel", on); };
  const toggleWeather = (on) => { setShowWeather(on); remember("twin.weatherCard", on); };
  const [colorMode, setColorMode] = useState("type");
  const [flyTarget, setFlyTarget] = useState(null);
  const [place, setPlace] = useState(CITY);
  const [autoOrbit, setAutoOrbit] = useState(false);
  const [pickedTri, setPickedTri] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [cams, setCams] = useState([]);
  const [camNote, setCamNote] = useState("No camera data loaded. Nothing is placed until real positions are provided.");
  const [tab, setTab] = useState("weather");
  const [sheetOpen, setSheetOpen] = useState(false);

  // 1. Load the four data files from /data (served from public/data).
  useEffect(() => {
    Promise.all(
      FILES.map((n) =>
        fetch(`/data/${n}.json`)
          .then((r) => { if (!r.ok) throw new Error(`Could not load ${n}.json (HTTP ${r.status})`); return r.json(); })
          .then((j) => { setLoaded((c) => c + 1); return j; })
      )
    )
      .then(([terrain, roads, buildings, barangays]) => setData({ terrain, roads, buildings, barangays }))
      .catch((e) => setError(e.message));
  }, []);

  // 2. Build the geometry once (1-2 s). setTimeout lets the loading screen paint first.
  useEffect(() => {
    if (!data) return;
    const id = setTimeout(() => {
      try { setTwin(buildTwin(data)); } catch (e) { setError(`Could not build the city model: ${e.message}`); }
    }, 0);
    return () => clearTimeout(id);
  }, [data]);

  const fly = useCallback((x, y, kind) => {
    if (!twin) return;
    const f = framing(kind, { side: showSide, weather: showWeather });
    const tx = x + f.dx, ty = y + f.dy;
    setFlyTarget({ look: toThree(tx, ty, twin.ground(tx, ty)), dir: f.dir, dist: f.dist });
  }, [twin, showSide, showWeather]);

  const overview = useCallback(() => { fly(0, 0, "overview"); setPlace(CITY); }, [fly]);
  const goPlace = useCallback((l) => {
    fly(l.x, l.y, "place");
    setPlace({ name: `Brgy. ${l.name}`, x: l.x, y: l.y, label: l.name });
    setTab("weather");
  }, [fly]);
  useEffect(() => { if (twin) overview(); }, [twin]); // eslint-disable-line react-hooks/exhaustive-deps

  const weather = useWeather(place, twin?.meta.origin_utm);

  // Wind for the animation: the current reading at the selected place.
  const wv = weather.data?.values;
  const wind = useMemo(
    () => (wv?.wind_speed_10m != null && wv?.wind_direction_10m != null ? { speedKmh: wv.wind_speed_10m, fromDeg: wv.wind_direction_10m } : null),
    [wv?.wind_speed_10m, wv?.wind_direction_10m]
  );
  const windNote = wind
    ? `${wind.speedKmh.toFixed(0)} km/h from ${Math.round(wind.fromDeg)}° at ${place.name}. One model reading for the whole city; motion sped up ${WIND_SPEEDUP}× so it is visible.`
    : "Waiting for weather data: the animation starts when the wind reading arrives.";

  const selected = twin && pickedTri != null ? twin.buildings.owner[pickedTri] : null;
  const info = selected != null ? data.buildings[selected] : null;
  useEffect(() => { if (info) { setTab("info"); setSheetOpen(true); } }, [info]);

  const heightSources = twin?.meta.height_sources ?? [];
  const sourceCounts = useMemo(() => {
    const c = [0, 0, 0, 0];
    data?.buildings.forEach((b) => c[b[4]]++);
    return c;
  }, [data]);
  const stats = {
    buildings: data?.buildings.length.toLocaleString(),
    roads: data?.roads.roads.length.toLocaleString(),
    maxElev: data ? Math.round(data.terrain.meta.dem.max) : null,
  };

  const onCamFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !twin) return;
    const { cams: list, skipped, error: err } = parseCamerasCsv(await file.text(), twin.meta.origin_utm);
    setCams(list);
    setCamNote(err ? `${err}. Nothing was placed.` : `Placed ${list.length} from ${file.name}${skipped ? `; skipped ${skipped} rows without valid lat/lon` : ""}.`);
  };

  const toggle = (k) => setVisible((v) => ({ ...v, [k]: !v[k] }));
  const [ox, oy] = twin?.meta.origin_utm ?? [0, 0];

  const panels = {
    layers: <LayersPanel visible={visible} onToggle={toggle} windNote={windNote} />,
    color: <ColorPanel mode={colorMode} onMode={setColorMode} heightSources={heightSources} sourceCounts={sourceCounts} />,
    places: twin && <PlacesPanel labels={twin.labels} current={place.label} onPlace={goPlace} onOverview={overview} autoOrbit={autoOrbit} onOrbit={() => setAutoOrbit((o) => !o)} />,
    cameras: <CamerasPanel cams={cams} note={camNote} onFile={onCamFile} />,
    weather: <WeatherCard place={place} w={weather} />,
    info: <BuildingInfo info={info} types={twin?.meta.building_types ?? []} heightSources={heightSources} onClose={() => setPickedTri(null)} />,
  };

  const TABS = [["weather", "Weather"], ["places", "Places"], ["layers", "Layers"], ["cameras", "Cameras"], ...(info ? [["info", "Building"]] : [])];

  return (
    <div className="relative h-dvh w-full overflow-hidden select-none">
      <TwinScene
        twin={twin}
        buildings={data?.buildings}
        visible={visible}
        colorMode={colorMode}
        flyTarget={flyTarget}
        selected={selected}
        cams={cams}
        wind={wind}
        autoOrbit={autoOrbit}
        onPick={setPickedTri}
        onHover={setCursor}
      />

      {/* Loading / error overlay */}
      {(!twin || error) && (
        <div className="absolute inset-0 z-50 grid place-items-center bg-bg p-6 text-center">
          {error ? (
            <div className="max-w-md">
              <p className="font-display text-xl font-semibold uppercase tracking-wide text-[#f2a0a0]">Could not open the twin</p>
              <p className="mt-2 text-sm text-muted">{error}. Reload the page; if it keeps failing, the data files may be missing from the deployment.</p>
            </div>
          ) : (
            <div>
              <p className="font-display text-lg font-semibold uppercase tracking-[0.12em] text-muted">
                {loaded < FILES.length ? `Loading city data ${loaded}/${FILES.length}` : "Building 3D city…"}
              </p>
              <progress className="mt-3 h-1.5 w-60 accent-[#f2a33a]" max={FILES.length + 1} value={loaded} />
            </div>
          )}
        </div>
      )}

      {/* ===== Laptop / PC / big screen ===== */}
      {showSide ? (
      <aside className="scroll-thin absolute inset-y-4 left-4 z-20 hidden w-80 flex-col gap-3 overflow-y-auto pr-1 lg:flex 2xl:w-96">
        <div className="panel p-4"><TitleBlock stats={stats} onHide={() => toggleSide(false)} /></div>
        <div className="panel p-4">{panels.layers}</div>
        <div className="panel p-4">{panels.color}</div>
        <div className="panel p-4">{panels.places}</div>
        <div className="panel p-4">{panels.cameras}</div>
      </aside>
      ) : (
        <button className="panel absolute left-4 top-4 z-20 hidden items-center gap-2 px-3 py-2 text-sm hover:border-accent lg:flex"
          onClick={() => toggleSide(true)} aria-label="Show side panel">
          <span className="font-display text-base font-bold uppercase tracking-wide">Muntinlupa <span className="text-accent">Twin</span></span>
          <span className="text-muted">› Show panel</span>
        </button>
      )}
      <div className="absolute right-4 top-4 z-20 hidden w-80 flex-col items-end gap-2 lg:flex 2xl:w-96">
        {cursor && twin && (
          <div className="panel px-2.5 py-1.5 font-mono text-xs text-muted tabular-nums">
            E {(cursor.x + ox).toFixed(0)} · N {(cursor.y + oy).toFixed(0)} · elev {twin.ground(cursor.x, cursor.y).toFixed(1)} m
          </div>
        )}
        {showWeather ? (
          <div className="panel w-full p-4"><WeatherCard place={place} w={weather} onHide={() => toggleWeather(false)} /></div>
        ) : (
          <button className="panel flex items-center gap-2 px-3 py-2 text-sm hover:border-accent" onClick={() => toggleWeather(true)} aria-label="Show weather card">
            <span className="font-display text-base font-semibold tabular-nums">{wv?.temperature_2m != null ? `${wv.temperature_2m.toFixed(1)}°C` : "Weather"}</span>
            <span className="text-muted">‹ Show weather</span>
          </button>
        )}
      </div>
      {info && <div className="panel absolute bottom-4 right-4 z-20 hidden w-80 p-4 lg:block 2xl:w-96">{panels.info}</div>}

      {/* ===== Phone / tablet ===== */}
      <header className="panel absolute inset-x-2 top-2 z-30 flex items-center justify-between gap-3 px-3 py-2 lg:hidden"
        style={{ marginTop: "env(safe-area-inset-top)" }}>
        <h1 className="font-display text-xl font-bold uppercase leading-none tracking-wide">
          Muntinlupa <span className="text-accent">Twin</span>
        </h1>
        <span className="text-right text-[0.7rem] leading-tight text-muted tabular-nums">{stats.buildings ?? "-"} buildings<br />{stats.roads ?? "-"} roads</span>
      </header>

      <section
        className="panel absolute inset-x-0 bottom-0 z-30 flex max-h-[62dvh] flex-col rounded-b-none md:inset-x-auto md:bottom-4 md:left-4 md:w-[26rem] md:rounded-b-xl lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Controls"
      >
        <button
          className="flex w-full flex-col items-center gap-2 px-4 pt-2 pb-2.5 text-left"
          onClick={() => setSheetOpen((o) => !o)}
          aria-expanded={sheetOpen}
          aria-controls="sheet-body"
        >
          <span className="h-1 w-10 rounded-full bg-line" aria-hidden="true" />
          <span className="flex w-full items-center justify-between gap-3">
            <WeatherSummary place={place} w={weather} />
            <span className="shrink-0 text-xs text-muted">{sheetOpen ? "Hide" : "More"}</span>
          </span>
        </button>
        {sheetOpen && (
          <>
            <nav className="flex gap-1 overflow-x-auto border-y border-line px-2 py-1.5" role="tablist">
              {TABS.map(([k, label]) => (
                <button key={k} role="tab" aria-selected={tab === k} aria-pressed={tab === k} className="chip shrink-0" onClick={() => setTab(k)}>{label}</button>
              ))}
            </nav>
            <div id="sheet-body" className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4" role="tabpanel">
              {tab === "layers" ? <div className="grid gap-5">{panels.layers}{panels.color}</div> : panels[tab]}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
