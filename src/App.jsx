// App.jsx
// Loads the city data, builds the 3D geometry, and lays out the interface:
//   lg and up (laptop, PC, big screen): left sidebar + weather card top-right + building card bottom-right
//   below lg (phone, tablet): top bar + bottom sheet with tabs (Weather, Places, Layers, Cameras)
// Two modes, same 3D city:
//   twin  (/)      : read only. Cameras, latest snapshots and the latest fire estimate come from the
//                    database every LOGGING.twinRefreshS s. No camera config or detection card.
//   admin (/admin) : after the admin password. Camera config (saved to the database), webcam streams,
//                    fire/smoke detection, triangulation, snapshot + estimate logging, manual recording.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TwinScene, { WIND_SPEEDUP } from "./components/TwinScene";
import WeatherCard, { useWeather, WeatherSummary } from "./components/WeatherCard";
import { TitleBlock, LayersPanel, ColorPanel, PlacesPanel, BuildingInfo } from "./components/Panels";
import CameraConfig from "./components/CameraConfig";
import DetectionPanel from "./components/DetectionPanel";
import { loadModel, restoreModel, forgetModel } from "./lib/detector";
import { liveTriangulation, pickBox } from "./lib/liveTriangulation";
import { buildTwin, toThree, findBarangay } from "./lib/twinGeometry";
import { loadCameras, markImported, placeCamera, validateCamera, loadLiveOff, saveLiveOff } from "./lib/cameraConfig";
import { AdminBar, RecordingsPanel, ImportCard, CameraList, savedFolder } from "./components/AdminPanels";
import { useTwinStatus } from "./lib/useTwinStatus";
import { storedToLive } from "./lib/storedEstimate";
import { api } from "./lib/api";
import { LOGGING, ACTIVE_ESTIMATE_S, LIVE } from "./lib/detectionConfig";
import CameraRunner from "./components/CameraRunner";
import { hub, useHubVersion } from "./lib/cameraHub";
import { loadDeviceName, saveDeviceName, sameDevice } from "./lib/device";

// Twin page: a camera counts as "detecting now" while its latest saved snapshot is newer than
// 2 x snapshotIntervalS (snapshots are saved every snapshotIntervalS while it sees fire/smoke).
const DETECTING_NOW_S = 2 * LOGGING.snapshotIntervalS;

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

export default function App({ admin = false, onLogout }) {
  const [data, setData] = useState(null);
  const [loaded, setLoaded] = useState(0);
  const [error, setError] = useState("");
  const [twin, setTwin] = useState(null);

  const [visible, setVisible] = useState({ terrain: true, buildings: true, roads: true, sidewalks: true, barangays: true, cameras: true, triangulation: true, wind: false });
  const [showSide, setShowSide] = useState(() => remembered("twin.sidePanel", true));
  const [showWeather, setShowWeather] = useState(() => remembered("twin.weatherCard", true));
  const toggleSide = (on) => { setShowSide(on); remember("twin.sidePanel", on); };
  const toggleWeather = (on) => { setShowWeather(on); remember("twin.weatherCard", on); };
  const [colorMode, setColorMode] = useState("type");
  const [flyTarget, setFlyTarget] = useState(null);
  const [place, setPlace] = useState(CITY);
  const [autoOrbit, setAutoOrbit] = useState(false);
  const [pickedTri, setPickedTri] = useState(null);
  const [selectedBrgy, setSelectedBrgy] = useState(null); // clicked / flown-to barangay (amber outline)
  const [hoverBrgy, setHoverBrgy] = useState(null);       // barangay under the mouse (white outline)
  const [cursor, setCursor] = useState(null);
  const status = useTwinStatus();                              // database: cameras, latest snapshots, estimate
  const camConfigs = status.cameras;                           // { id, name, lat, lon, index, heading, fov }
  const [localCams, setLocalCams] = useState(() => (admin ? loadCameras() : []));
  const [folder, setFolder] = useState(null);                  // admin: recordings folder on this laptop
  const [recVersion, setRecVersion] = useState(0);
  const [deviceName, setDeviceName] = useState(() => (admin ? loadDeviceName() : "")); // this admin laptop's name
  const renameDevice = (n) => { saveDeviceName(n); setDeviceName(n); };
  const [liveOff, setLiveOff] = useState(() => (admin ? loadLiveOff() : [])); // camera ids with live stopped
  const setLive = useCallback((ids, on) => setLiveOff((prev) => {
    const next = on ? prev.filter((x) => !ids.includes(x)) : [...new Set([...prev, ...ids])];
    saveLiveOff(next); return next;
  }), []);
  const [openCamIds, setOpenCamIds] = useState([]);           // cameras whose stream popups are open (several at once)
  const [model, setModel] = useState({ status: "none" });     // fire/smoke model: none | loading | ready | error
  const [detectOn, setDetectOn] = useState(true);
  const [hits, setHits] = useState({});                        // camId -> last box worth a bearing { box, W, H, t }
  const [now, setNow] = useState(() => Date.now());
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

  const brgyPlace = (b) => ({ name: `Brgy. ${b.name}`, x: b.x, y: b.y, label: b.name });
  const overview = useCallback(() => { fly(0, 0, "overview"); setPlace(CITY); setSelectedBrgy(null); }, [fly]);
  const goPlace = useCallback((l) => {
    fly(l.x, l.y, "place");
    setPlace(brgyPlace(l));
    setSelectedBrgy(l.name);
    setTab("weather");
  }, [fly]);

  // Click/tap on the map: select the building (if any) and the barangay under the click.
  const onPick = useCallback(({ tri, point }) => {
    setPickedTri(tri);
    const b = twin && point ? findBarangay(twin.barangayIndex, point.x, point.y) : null;
    setSelectedBrgy(b ? b.name : null);
    setHoverBrgy(null);
    // Inside a barangay: pin its weather. Outside the city (or the empty area around it): whole city.
    setPlace(b ? brgyPlace(b) : CITY);
  }, [twin]);

  // Mouse hover: which barangay is under the pointer. Applied after 250 ms of staying on the same
  // barangay so the weather card does not flicker (and fire requests) while crossing boundaries.
  const pointedBrgy = useMemo(() => (twin && cursor ? findBarangay(twin.barangayIndex, cursor.x, cursor.y)?.name ?? null : null), [twin, cursor]);
  useEffect(() => {
    if (pointedBrgy === hoverBrgy) return;
    const id = setTimeout(() => setHoverBrgy(pointedBrgy === selectedBrgy ? null : pointedBrgy), 250);
    return () => clearTimeout(id);
  }, [pointedBrgy, hoverBrgy, selectedBrgy]);
  const hoverRec = hoverBrgy ? twin?.barangayIndex.find((b) => b.name === hoverBrgy) : null;
  const weatherPlace = hoverRec ? { ...brgyPlace(hoverRec), hover: true } : place;
  useEffect(() => { if (twin) overview(); }, [twin]); // eslint-disable-line react-hooks/exhaustive-deps

  const weather = useWeather(weatherPlace, twin?.meta.origin_utm);

  // Wind for the animation: the current reading at the selected place.
  const wv = weather.data?.values;
  const wind = useMemo(
    () => (wv?.wind_speed_10m != null && wv?.wind_direction_10m != null ? { speedKmh: wv.wind_speed_10m, fromDeg: wv.wind_direction_10m } : null),
    [wv?.wind_speed_10m, wv?.wind_direction_10m]
  );
  const windNote = wind
    ? `${wind.speedKmh.toFixed(0)} km/h from ${Math.round(wind.fromDeg)}° at ${weatherPlace.name}. One model reading for the whole city; motion sped up ${WIND_SPEEDUP}× so it is visible.`
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

  // Cameras placed on the map (local meters + barangay), recomputed from the saved lat/lon,
  // plus each camera's latest saved detection (twin page popups and red marks).
  // Which cameras count as detecting now / streaming now; strings so the map only re-renders when they change.
  const detectingKey = admin ? "" : camConfigs.filter((c) => status.ageS(status.latest[c.id]?.detectedAt) < DETECTING_NOW_S).map((c) => c.id).join(",");
  const liveKey = camConfigs.filter((c) => status.ageS(c.liveAt) < LIVE.offlineAfterS).map((c) => c.id).join(",");
  const cams = useMemo(() => (twin ? camConfigs.map((c) => {
    const d = status.latest[c.id], age = d ? status.ageS(d.detectedAt) : Infinity;
    return { ...placeCamera(c, twin), lastDet: d ?? null, lastDetAgeS: age, detectingNow: detectingKey.split(",").includes(c.id),
      live: liveKey.split(",").includes(c.id), previewAgeS: status.ageS(c.previewAt) };
  }) : []), [twin, camConfigs, status.latest, status.ageS, detectingKey, liveKey]);
  const fields = ({ name, lat, lon, index, heading, fov, device }) => ({ name, lat, lon, index, heading, fov, device });
  // Admin: cameras plugged into THIS device run here; the others are only watched (live video).
  const localIds = useMemo(() => cams.filter((c) => sameDevice(c.device, deviceName)).map((c) => c.id), [cams, deviceName]);
  const localKey = localIds.join(",");
  const myCams = useMemo(() => cams.filter((c) => localIds.includes(c.id)), [localKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const assignHere = async (c) => { await api.updateCamera(c.id, { ...fields(c), device: deviceName }); await status.refresh(); };
  const saveCam = async (cam, editingId) => {
    if (editingId) await api.updateCamera(editingId, fields(cam)); else await api.addCamera(fields(cam));
    await status.refresh();
  };
  const openCam = useCallback((id) => setOpenCamIds((ids) => (ids.includes(id) ? ids : [...ids, id])), []);
  const closeCam = useCallback((id) => setOpenCamIds((ids) => ids.filter((x) => x !== id)), []);
  const removeCam = async (id) => { await api.removeCamera(id); closeCam(id); await status.refresh(); };
  // A camera removed on another device: close its popup here.
  useEffect(() => { setOpenCamIds((ids) => { const keep = ids.filter((id) => camConfigs.some((c) => c.id === id)); return keep.length === ids.length ? ids : keep; }); }, [camConfigs]);
  // One-time copy of cameras that were saved in this browser before the database existed.
  const importLocal = async () => {
    const failed = [];
    for (const c of localCams) {
      try { await api.addCamera({ ...fields(c), device: deviceName }); }
      catch (e) { if (e.status !== 409) failed.push(`${c.name}: ${e.message}`); } // 409 = already in the database
    }
    await status.refresh();
    if (failed.length) return `Not imported: ${failed.join("; ")}`;
    markImported(); setLocalCams([]);
    return "";
  };
  const showCam = (c) => {
    setVisible((v) => ({ ...v, cameras: true }));
    fly(c.x, c.y, "place");
    openCam(c.id);
    setSheetOpen(false); // phone: get the sheet out of the way of the popup
  };
  const openAllCams = () => { setVisible((v) => ({ ...v, cameras: true })); setOpenCamIds(camConfigs.map((c) => c.id)); setSheetOpen(false); };
  const closeAllCams = () => setOpenCamIds([]);

  // ---- Fire/smoke detection (model in this browser) and live triangulation ----
  useEffect(() => {
    if (!admin) return; // detection runs only in the admin console
    let alive = true;
    setModel({ status: "loading" });
    restoreModel().then((info) => alive && setModel(info ? { status: "ready", info } : { status: "none" }));
    return () => { alive = false; };
  }, []);
  const onLoadModelFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setModel({ status: "loading" });
    try { setModel({ status: "ready", info: await loadModel(await file.arrayBuffer(), file.name) }); }
    catch (err) { setModel({ status: "error", error: err.message }); }
  };
  const onForgetModel = async () => { await forgetModel(); setModel({ status: "none" }); setHits({}); };
  // Each run from a popup: keep the box that would give this camera's bearing (fire, else smoke).
  const onDetResult = useCallback((id, r) => {
    setHits((h) => {
      if (!r) { if (!(id in h)) return h; const n = { ...h }; delete n[id]; return n; } // stream closed
      const box = pickBox(r.dets);
      return box ? { ...h, [id]: { box, W: r.W, H: r.H, t: Date.now() } } : h;     // keep the last hit for the window
    });
  }, []);
  const detecting = admin && model.status === "ready" && detectOn;
  useEffect(() => { if (!detecting) setHits({}); }, [detecting]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const liveAdmin = useMemo(
    () => (twin && detecting ? liveTriangulation(myCams, hits, now, twin.meta.origin_utm) : null),
    [twin, detecting, myCams, hits, now]
  );
  // The fire estimate is combined and saved on the SERVER from all laptops' bearings (api/_lib/combine.js).
  // Map (twin and admin): the latest saved estimate. ACTIVE while newer than ACTIVE_ESTIMATE_S, otherwise dimmed as the last one.
  const estimateActive = !!status.estimate && status.ageS(status.estimate.estimatedAt) < ACTIVE_ESTIMATE_S; // re-checked every second (App ticks)
  const liveStored = useMemo(() => {
    if (!twin || !status.estimate) return null;
    return storedToLive(status.estimate, camConfigs, twin.meta.origin_utm, estimateActive);
  }, [twin, status.estimate, camConfigs, estimateActive]);
  const live = liveStored;
  useEffect(() => { if (admin) savedFolder().then((f) => f && setFolder(f)); }, [admin]);
  const folderRef = useRef(null); folderRef.current = folder;
  // Admin: tell the server every LIVE.heartbeatS which cameras are on air; warn before closing mid-recording.
  useHubVersion();
  const recording = admin && [...hub.all().values()].some((s) => s.rec);
  useEffect(() => {
    if (!admin) return;
    const beat = () => {
      const ids = [...hub.all().entries()].filter(([, s]) => s.air?.status === "on").map(([id]) => id);
      if (ids.length) api.liveHeartbeat(ids).catch(() => {});
    };
    const t = setInterval(beat, LIVE.heartbeatS * 1000);
    // Tab closed or laptop going away: mark the cameras offline right away (otherwise after offlineAfterS).
    const bye = () => [...hub.all().entries()].filter(([, s]) => s.air?.status === "on").forEach(([id, s]) => api.liveStop(id, s.air.sessionId).catch(() => {}));
    window.addEventListener("pagehide", bye);
    return () => { clearInterval(t); window.removeEventListener("pagehide", bye); };
  }, [admin]);
  useEffect(() => {
    if (!recording) return;
    const warn = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [recording]);
  // Twin: live video needs the viewer password (admins count as viewers).
  const [viewerOk, setViewerOk] = useState(false);
  useEffect(() => { api.session().then((r) => setViewerOk(!!r.viewer)).catch(() => {}); }, []);
  const viewer = useMemo(() => ({
    ok: viewerOk,
    unlock: async (pw) => { await api.login(pw, "viewer"); setViewerOk(true); },
    lock: async () => { await api.logout("viewer").catch(() => {}); api.session().then((r) => setViewerOk(!!r.viewer)).catch(() => setViewerOk(false)); },
  }), [viewerOk]);
  const onRecorded = useCallback(() => setRecVersion((v) => v + 1), []);
  const adminTools = useMemo(() => (admin ? { folder, onRecorded, liveOff, setLive, localKey } : null), [admin, folder, onRecorded, liveOff, setLive, localKey]);
  useEffect(() => { if (!visible.cameras) setOpenCamIds([]); }, [visible.cameras]);

  const toggle = (k) => setVisible((v) => ({ ...v, [k]: !v[k] }));
  const [ox, oy] = twin?.meta.origin_utm ?? [0, 0];

  const panels = {
    layers: <LayersPanel visible={visible} onToggle={toggle} windNote={windNote} />,
    color: <ColorPanel mode={colorMode} onMode={setColorMode} heightSources={heightSources} sourceCounts={sourceCounts} />,
    places: twin && <PlacesPanel labels={twin.labels} current={place.label} onPlace={goPlace} onOverview={overview} autoOrbit={autoOrbit} onOrbit={() => setAutoOrbit((o) => !o)} />,
    detection: (
      <DetectionPanel model={model} onLoadFile={onLoadModelFile} onForget={onForgetModel} detectOn={detectOn}
        onToggleDetect={() => setDetectOn((d) => !d)} live={liveAdmin} openCount={myCams.length} combined={status.combined} estimate={status.estimate} estimateActive={estimateActive} deviceName={deviceName} />
    ),
    adminBar: <AdminBar onLogout={onLogout} dbError={status.error} deviceName={deviceName} onDeviceName={renameDevice} />,
    recordings: <RecordingsPanel folder={folder} onFolder={setFolder} version={recVersion} />,
    cameras: twin && (admin ? (
      <div className="grid gap-2">
        <ImportCard local={localCams} onImport={importLocal} />
        <CameraConfig cameras={cams} onSave={saveCam} onRemove={removeCam} onShow={showCam} liveOff={liveOff} onSetLive={setLive}
          deviceName={deviceName} localIds={localIds} onAssignHere={assignHere}
          openIds={openCamIds} onOpenAll={openAllCams} onCloseAll={closeAllCams}
          validate={(form, editingId) => validateCamera(form, twin, camConfigs, editingId)} />
      </div>
    ) : (
      <CameraList cameras={cams} onShow={showCam} openIds={openCamIds} error={status.error} loaded={status.loaded} viewer={viewer} />
    )),
    weather: <WeatherCard place={weatherPlace} w={weather} />,
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
        selectedBrgy={selectedBrgy}
        hoverBrgy={hoverBrgy}
        cams={cams}
        openCamIds={openCamIds}
        onOpenCam={openCam}
        onCloseCam={closeCam}
        live={live}
        admin={adminTools}
        viewer={viewer}
        wind={wind}
        autoOrbit={autoOrbit}
        onPick={onPick}
        onHover={setCursor}
      />

      {/* Admin: every camera runs in the background (stream, live, detection, previews, recording). */}
      {admin && twin && myCams.map((c) => (
        <CameraRunner key={c.id} cam={cams.find((k) => k.id === c.id) ?? c} detecting={detecting} liveOn={!liveOff.includes(c.id)} onResult={onDetResult} folderRef={folderRef} onRecorded={onRecorded} />
      ))}

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
        {admin && <div className="panel p-3">{panels.adminBar}</div>}
        <div className="panel p-4"><TitleBlock stats={stats} onHide={() => toggleSide(false)} /></div>
        <div className="panel p-4">{panels.layers}</div>
        <div className="panel p-4">{panels.color}</div>
        <div className="panel p-4">{panels.places}</div>
        <div className="panel p-4">{panels.cameras}</div>
        {admin && <div className="panel p-4">{panels.detection}</div>}
        {admin && <div className="panel p-4">{panels.recordings}</div>}
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
          <div className="panel w-full p-4"><WeatherCard place={weatherPlace} w={weather} onHide={() => toggleWeather(false)} /></div>
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
            <WeatherSummary place={weatherPlace} w={weather} />
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
              {tab === "layers" ? <div className="grid gap-5">{panels.layers}{panels.color}</div>
                : tab === "cameras" ? (admin
                  ? <div className="grid gap-5">{panels.adminBar}{panels.cameras}{panels.detection}{panels.recordings}</div>
                  : panels.cameras)
                : panels[tab]}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
