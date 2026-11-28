// useTwinStatus.js: reads cameras, the latest snapshot per camera and the latest fire estimate from
// the database (GET /api/events) every LOGGING.twinRefreshS seconds. Pauses while the tab is hidden.
// Ages are measured on the SERVER clock, so a wrong clock on the viewing device does not matter.
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { LOGGING } from "./detectionConfig";

export function useTwinStatus() {
  const [s, setS] = useState({ loaded: false, cameras: [], latest: {}, estimate: null, error: "" });
  const offset = useRef(0); // server clock minus this device's clock (ms)
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const r = await api.status();
      offset.current = Date.parse(r.serverTime) - Date.now();
      const latest = {};
      for (const d of r.latestDetections) latest[d.cameraId] = d;
      setS({ loaded: true, cameras: r.cameras, latest, estimate: r.estimate, error: "" });
    } catch (e) {
      setS((p) => ({ ...p, loaded: true, error: e.message }));
    } finally { busy.current = false; }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(() => { if (!document.hidden) refresh(); }, LOGGING.twinRefreshS * 1000);
    const onVis = () => { if (!document.hidden) refresh(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [refresh]);

  /** Seconds since an ISO time, on the server's clock. */
  const ageS = useCallback((iso) => (iso ? (Date.now() + offset.current - Date.parse(iso)) / 1000 : Infinity), []);
  return { ...s, refresh, ageS };
}

export function agoText(s) {
  if (!Number.isFinite(s)) return "never";
  if (s < 60) return `${Math.max(0, Math.round(s))} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
