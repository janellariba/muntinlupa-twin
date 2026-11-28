// CameraInfoPopup.jsx (twin page)
// Popup above a camera mark:
//   - with the viewer password and the camera streaming: LIVE video (Cloudflare Realtime)
//   - otherwise: a picture. The fire/smoke snapshot while it is detecting (every 10 s), else the
//     preview picture the admin laptop uploads every LIVE.previewIntervalS (60 s).
import { useEffect, useRef, useState } from "react";
import { agoText } from "../lib/useTwinStatus";
import { watch } from "../lib/live";
import { LIVE } from "../lib/detectionConfig";

function LiveVideo({ cam }) {
  const videoRef = useRef(null);
  const [st, setSt] = useState({ status: "connecting" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true, conn = null;
    setSt({ status: "connecting" });
    watch(cam.id, videoRef.current, () => alive && setSt({ status: "error", message: "The live video stopped." }))
      .then((c) => { if (!alive) c.close(); else { conn = c; setSt({ status: "playing" }); } })
      .catch((e) => alive && setSt({ status: "error", message: e.message }));
    return () => { alive = false; conn?.close(); };
  }, [cam.id, attempt]);
  return (
    <>
      <video ref={videoRef} autoPlay muted playsInline className={`h-full w-full object-contain ${st.status === "playing" ? "" : "invisible"}`} />
      {st.status === "playing" && (
        <span className="absolute left-2 top-2 rounded bg-red-600/90 px-1.5 py-0.5 font-mono text-[0.65rem] font-semibold">● LIVE</span>
      )}
      {st.status !== "playing" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center text-xs text-muted">
          {st.status === "connecting" ? "Connecting to live video…" : st.message}
          {st.status === "error" && <button className="chip py-1" onClick={() => setAttempt((a) => a + 1)}>Try again</button>}
        </div>
      )}
    </>
  );
}

function Unlock({ viewer }) {
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setMsg("");
    try { await viewer.unlock(pw); setPw(""); } catch (err) { setMsg(err.message); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap gap-1.5 border-t border-line px-3 py-2 text-[0.7rem]">
      <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Viewer password for live video" aria-label="Viewer password"
        className="min-w-0 flex-1 rounded-md border border-line bg-[#0f191d] px-2 py-1 text-ink focus:border-accent focus:outline-none" />
      <button className="chip shrink-0 py-1" disabled={busy || !pw}>{busy ? "…" : "Watch live"}</button>
      {msg && <span role="alert" className="basis-full text-[#f2a0a0]">{msg}</span>}
    </form>
  );
}

export default function CameraInfoPopup({ cam, onClose, viewer }) {
  const d = cam.lastDet;
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const showLive = cam.live && viewer?.ok;
  // Which picture to show without live video: the detection snapshot while detecting, else the newest of the two.
  const pic = cam.detectingNow && d?.snapshotUrl ? { url: d.snapshotUrl, what: "fire/smoke snapshot", age: cam.lastDetAgeS }
    : cam.previewUrl && (!d?.snapshotUrl || cam.previewAgeS <= cam.lastDetAgeS) ? { url: cam.previewUrl, what: "camera picture", age: cam.previewAgeS }
    : d?.snapshotUrl ? { url: d.snapshotUrl, what: "last fire/smoke snapshot", age: cam.lastDetAgeS } : null;

  return (
    <div role="dialog" aria-label={`${cam.name} camera`}
      className={`panel w-64 overflow-hidden p-0 text-left shadow-2xl sm:w-72 2xl:w-80 ${cam.detectingNow ? "!border-red-500" : ""}`}
      onPointerDown={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate font-display text-base font-semibold uppercase leading-tight tracking-wide">{cam.name}</div>
          <div className="truncate text-[0.68rem] text-muted">
            {showLive ? "Live video" : pic ? `${pic.what}, ${agoText(pic.age)}` : "No picture yet"}
            {!cam.live && (cam.previewAgeS < 2 * LIVE.previewIntervalS ? " · live video off" : " · camera offline")}
          </div>
        </div>
        <button className="chip shrink-0 px-2 py-0.5 text-base leading-none" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="relative aspect-video bg-black">
        {showLive ? <LiveVideo cam={cam} /> : pic ? (
          <img src={pic.url} alt={`${cam.name}: ${pic.what}`} className="h-full w-full object-contain" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center p-3 text-center text-xs text-muted">
            {cam.live ? `The first picture arrives within ${LIVE.previewIntervalS} s.` : "Camera offline: the admin console is not running with this camera."}
          </div>
        )}
        {cam.detectingNow && (
          <span className="absolute right-2 top-2 animate-pulse rounded bg-red-600/90 px-1.5 py-0.5 font-mono text-[0.65rem] font-semibold uppercase">
            {d.className} {Math.round(d.confidence * 100)}%
          </span>
        )}
      </div>
      <div className="grid gap-0.5 px-3 py-1.5 font-mono text-[0.68rem] text-muted tabular-nums">
        {d && (
          <span className={cam.detectingNow ? "text-red-300" : ""}>
            {cam.detectingNow ? "" : "last "}{d.className} {Math.round(d.confidence * 100)}% · {d.bearing != null ? `bearing ${d.bearing.toFixed(1)}°${d.fromSmoke ? " (smoke)" : ""}` : "no bearing (NOT MEASURED)"} · {agoText(cam.lastDetAgeS)}
          </span>
        )}
        <span className="truncate">{cam.lat.toFixed(5)}, {cam.lon.toFixed(5)}{cam.barangay ? ` · ${cam.barangay}` : ""}</span>
        {!showLive && cam.live && <span>Picture updates every {LIVE.previewIntervalS} s.</span>}
      </div>
      {cam.live && !viewer?.ok && <Unlock viewer={viewer} />}
    </div>
  );
}
