// CameraPopup.jsx
// Small popup above a camera mark with the live webcam stream for that camera's index.
// When a fire/smoke model is loaded, it runs detection on this stream (DETECTION.runsPerSecond),
// draws the boxes over the video and reports each result to the app for triangulation.
// The webcam is opened when the popup opens and released when it closes.
import { useEffect, useRef, useState } from "react";
import { openCamera, stopStream } from "../lib/webcam";
import { detect } from "../lib/detector";
import { DETECTION } from "../lib/detectionConfig";

const isFire = (name) => /fire|flame/i.test(name);

export default function CameraPopup({ cam, onClose, detecting, onResult }) {
  const videoRef = useRef(null);
  const [state, setState] = useState({ status: "opening" });
  const [det, setDet] = useState(null);       // last detection run { dets, W, H, ms }
  const [detError, setDetError] = useState("");

  useEffect(() => {
    let stream = null, cancelled = false;
    setState({ status: "opening" });
    openCamera(cam.index)
      .then((res) => {
        if (cancelled) { stopStream(res.stream); return; }
        stream = res.stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setState({ status: "live", label: res.label });
      })
      .catch((e) => !cancelled && setState({ status: "error", message: e.message }));
    return () => { cancelled = true; stopStream(stream); };
  }, [cam.index, cam.id]);

  // Detection loop: one run at a time per camera, at most DETECTION.runsPerSecond.
  useEffect(() => {
    if (!detecting || state.status !== "live") { setDet(null); onResult?.(cam.id, null); return; }
    let busy = false, alive = true;
    const id = setInterval(() => {
      if (busy || !videoRef.current?.videoWidth) return;
      busy = true;
      detect(videoRef.current)
        .then((r) => { if (alive && r) { setDet(r); setDetError(""); onResult?.(cam.id, r); } })
        .catch((e) => alive && setDetError(e.message || String(e)))
        .finally(() => { busy = false; });
    }, 1000 / DETECTION.runsPerSecond);
    return () => { alive = false; clearInterval(id); onResult?.(cam.id, null); };
  }, [detecting, state.status, cam.id, onResult]);

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
    </div>
  );
}
