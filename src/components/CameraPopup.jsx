// CameraPopup.jsx
// Small popup above a camera mark with the live webcam stream for that camera's index.
// When a fire/smoke model is loaded, it runs detection on this stream (DETECTION.runsPerSecond),
// draws the boxes over the video and reports each result to the app for triangulation.
// The webcam is opened when the popup opens and released when it closes.
// Admin console only: saves a snapshot (annotated JPEG + detection + bearing) to the database at most
// every LOGGING.snapshotIntervalS per camera while it sees fire/smoke, and has a manual Record button
// (saved on this laptop, auto-stop after LOGGING.maxRecordingS).
import { useEffect, useRef, useState } from "react";
import { openCamera, stopStream } from "../lib/webcam";
import { detect } from "../lib/detector";
import { DETECTION, LOGGING } from "../lib/detectionConfig";
import { pickBox } from "../lib/liveTriangulation";
import { pixelToBearing } from "../lib/triangulation";
import { annotatedJpeg } from "../lib/snapshot";
import { startRecording } from "../lib/recorder";
import { api } from "../lib/api";

const isFire = (name) => /fire|flame/i.test(name);
const lastSnapshot = new Map(); // camId -> time of the last saved snapshot (kept if the popup is reopened)
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export default function CameraPopup({ cam, onClose, detecting, onResult, admin }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const recRef = useRef(null);
  const [state, setState] = useState({ status: "opening" });
  const [det, setDet] = useState(null);       // last detection run { dets, W, H, ms }
  const [detError, setDetError] = useState("");
  const [saveMsg, setSaveMsg] = useState(null); // { ok, text, t }
  const [rec, setRec] = useState(null);         // { startedAt, mode } while recording
  const [recMsg, setRecMsg] = useState(null);   // { ok, text }
  const [, tick] = useState(0);
  const camRef = useRef(cam); camRef.current = cam;

  useEffect(() => {
    let stream = null, cancelled = false;
    setState({ status: "opening" });
    openCamera(cam.index)
      .then((res) => {
        if (cancelled) { stopStream(res.stream); return; }
        stream = res.stream; streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setState({ status: "live", label: res.label });
      })
      .catch((e) => !cancelled && setState({ status: "error", message: e.message }));
    return () => {
      cancelled = true;
      recRef.current?.stop(); // closing the popup ends a recording (the file is still saved)
      streamRef.current = null;
      stopStream(stream);
    };
  }, [cam.index, cam.id]);

  // Save one snapshot per LOGGING.snapshotIntervalS while this camera sees fire or smoke.
  const maybeSave = (r) => {
    if (!admin) return;
    const box = pickBox(r.dets);
    if (!box) return;
    const now = Date.now();
    if (now - (lastSnapshot.get(cam.id) ?? 0) < LOGGING.snapshotIntervalS * 1000) return;
    lastSnapshot.set(cam.id, now);
    const c = camRef.current;
    const bearing = c.heading != null && c.fov != null ? pixelToBearing(box.cx, r.W, c.heading, c.fov) : null;
    let jpeg;
    try { jpeg = annotatedJpeg(videoRef.current, r.dets, c.name); } catch { jpeg = undefined; }
    api.saveDetection({
      cameraId: c.id, className: box.name, confidence: box.conf,
      bbox: { x1: box.x1, y1: box.y1, x2: box.x2, y2: box.y2, cx: box.cx },
      frameW: r.W, frameH: r.H, allBoxes: r.dets.map(({ name, conf, x1, y1, x2, y2 }) => ({ name, conf, x1, y1, x2, y2 })),
      bearing, fromSmoke: box.fromSmoke, jpeg,
    })
      .then(() => setSaveMsg({ ok: true, text: "Snapshot saved", t: Date.now() }))
      .catch((e) => setSaveMsg({ ok: false, text: `Snapshot not saved: ${e.message}`, t: Date.now() }));
  };
  const saveRef = useRef(maybeSave); saveRef.current = maybeSave;

  // Detection loop: one run at a time per camera, at most DETECTION.runsPerSecond.
  useEffect(() => {
    if (!detecting || state.status !== "live") { setDet(null); onResult?.(cam.id, null); return; }
    let busy = false, alive = true;
    const id = setInterval(() => {
      if (busy || !videoRef.current?.videoWidth) return;
      busy = true;
      detect(videoRef.current)
        .then((r) => { if (alive && r) { setDet(r); setDetError(""); onResult?.(cam.id, r); saveRef.current(r); } })
        .catch((e) => alive && setDetError(e.message || String(e)))
        .finally(() => { busy = false; });
    }, 1000 / DETECTION.runsPerSecond);
    return () => { alive = false; clearInterval(id); onResult?.(cam.id, null); };
  }, [detecting, state.status, cam.id, onResult]);

  // Recording: timer display + a warning if the tab is closed mid-recording.
  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    const warn = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => { clearInterval(t); window.removeEventListener("beforeunload", warn); };
  }, [rec]);

  const toggleRecord = async () => {
    if (recRef.current) { recRef.current.stop(); return; }
    if (!streamRef.current) return;
    setRecMsg(null);
    try {
      const r = await startRecording(streamRef.current, cam.name, admin?.folder);
      recRef.current = r;
      setRec({ startedAt: Date.now(), mode: r.mode });
      r.done
        .then((meta) => api.logRecording({ cameraId: cam.id, ...meta })
          .then(() => setRecMsg({ ok: true, text: `Saved ${meta.fileName}${meta.mode === "folder" ? " in your recordings folder" : " to Downloads"}` }))
          .catch((e) => setRecMsg({ ok: false, text: `Video saved as ${meta.fileName}, but not logged: ${e.message}` }))
          .finally(() => admin?.onRecorded?.()))
        .catch((e) => setRecMsg({ ok: false, text: e.message }))
        .finally(() => { recRef.current = null; setRec(null); });
    } catch (e) { setRecMsg({ ok: false, text: e.message }); }
  };
  const recS = rec ? (Date.now() - rec.startedAt) / 1000 : 0;

  useEffect(() => {
    // Esc closes the most recently opened popup only (popups are stacked in opening order).
    const onKey = (e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const top = det?.dets?.[0];
  return (
    <div role="dialog" aria-label={`${cam.name} camera stream`}
      className={`panel w-64 overflow-hidden p-0 text-left shadow-2xl sm:w-72 2xl:w-80 ${top ? "!border-red-500" : ""}`}
      onPointerDown={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate font-display text-base font-semibold uppercase leading-tight tracking-wide">{cam.name}</div>
          <div className="truncate text-[0.68rem] text-muted">index {cam.index}{state.label ? ` · ${state.label}` : ""}</div>
        </div>
        <button className="chip shrink-0 px-2 py-0.5 text-base leading-none" onClick={onClose} aria-label="Close camera stream">×</button>
      </div>
      <div className="relative aspect-video bg-black">
        <video ref={videoRef} autoPlay muted playsInline className={`h-full w-full object-contain ${state.status === "live" ? "" : "invisible"}`} />
        {/* Boxes in video pixels; preserveAspectRatio "meet" lines up exactly with object-contain. */}
        {det && det.dets.length > 0 && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${det.W} ${det.H}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
            {det.dets.map((d, i) => {
              const c = isFire(d.name) ? "#ff3b30" : "#d0d6d4";
              return (
                <g key={i}>
                  <rect x={d.x1} y={d.y1} width={d.x2 - d.x1} height={d.y2 - d.y1} fill="none" stroke={c} strokeWidth={det.W / 160} />
                  <text x={d.x1 + det.W / 160} y={Math.max(d.y1 - det.W / 120, det.W / 30)} fill={c} fontSize={det.W / 26} fontWeight="700" fontFamily="IBM Plex Mono, monospace">
                    {d.name} {Math.round(d.conf * 100)}%
                  </text>
                </g>
              );
            })}
          </svg>
        )}
        {state.status === "live" && (
          <span className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[0.65rem]">
            <span className="mr-1 inline-block size-1.5 rounded-full bg-red-500 align-middle" />LIVE
          </span>
        )}
        {rec && (
          <span className="absolute bottom-2 left-2 rounded bg-red-600/90 px-1.5 py-0.5 font-mono text-[0.65rem] font-semibold tabular-nums">
            ● REC {clock(recS)} / {clock(LOGGING.maxRecordingS)}
          </span>
        )}
        {top && (
          <span className="absolute right-2 top-2 animate-pulse rounded bg-red-600/90 px-1.5 py-0.5 font-mono text-[0.65rem] font-semibold uppercase">
            {top.name} {Math.round(top.conf * 100)}%
          </span>
        )}
        {state.status !== "live" && (
          <div className="absolute inset-0 flex items-center justify-center p-3 text-center text-xs text-muted">
            {state.status === "opening" ? "Opening camera…" : state.message}
          </div>
        )}
      </div>
      <div className="flex justify-between gap-2 px-3 py-1.5 font-mono text-[0.68rem] text-muted tabular-nums">
        <span className="truncate">{cam.lat.toFixed(5)}, {cam.lon.toFixed(5)}{cam.barangay ? ` · ${cam.barangay}` : ""}</span>
        {detecting && <span className="shrink-0">{det ? `AI ${Math.round(det.ms)} ms` : "AI …"}</span>}
      </div>
      {detError && <p className="px-3 pb-2 text-[0.68rem] text-[#f2a0a0]">Detection error: {detError}</p>}
      {admin && (
        <div className="grid gap-1 border-t border-line px-3 py-2 text-[0.68rem]">
          <button type="button" className={`chip py-1 ${rec ? "!border-red-500 text-red-300" : ""}`} onClick={toggleRecord}
            disabled={state.status !== "live" && !rec} aria-pressed={!!rec}>
            {rec ? "■ Stop recording" : "● Record"}
          </button>
          {rec && <span className="text-muted">{rec.mode === "folder" ? "Writing to your recordings folder" : "Kept in memory, downloads when you stop"}. Stops by itself after {LOGGING.maxRecordingS / 60} min.</span>}
          {recMsg && <span className={recMsg.ok ? "text-muted" : "text-[#f2a0a0]"}>{recMsg.text}</span>}
          {saveMsg && <span className={saveMsg.ok ? "text-muted" : "text-[#f2a0a0]"}>{saveMsg.text} {new Date(saveMsg.t).toLocaleTimeString()}</span>}
        </div>
      )}
    </div>
  );
}
