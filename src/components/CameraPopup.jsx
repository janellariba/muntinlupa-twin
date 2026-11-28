// CameraPopup.jsx (admin console)
// Popup above a camera mark showing that camera's stream, detection boxes, live (ON AIR) status and the
// Record button. The camera itself is run by CameraRunner, so closing this popup does not stop
// streaming, detection or a recording.
import { useEffect, useRef, useState } from "react";
import { LOGGING } from "../lib/detectionConfig";
import { hub, useCam } from "../lib/cameraHub";

const isFire = (name) => /fire|flame/i.test(name);
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export default function CameraPopup({ cam, onClose, liveOn = true, onSetLive }) {
  const videoRef = useRef(null);
  const s = useCam(cam.id);
  const [, tick] = useState(0);

  useEffect(() => { if (videoRef.current && s.stream) videoRef.current.srcObject = s.stream; }, [s.stream]);
  useEffect(() => { // recording timer
    if (!s.rec) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [s.rec]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const det = s.det, top = det?.dets?.[0], live = s.status === "live";
  const air = s.air?.status;
  const recS = s.rec ? (Date.now() - s.rec.startedAt) / 1000 : 0;
  return (
    <div role="dialog" aria-label={`${cam.name} camera stream`}
      className={`panel w-64 overflow-hidden p-0 text-left shadow-2xl sm:w-72 2xl:w-80 ${top ? "!border-red-500" : ""}`}
      onPointerDown={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate font-display text-base font-semibold uppercase leading-tight tracking-wide">{cam.name}</div>
          <div className="truncate text-[0.68rem] text-muted">index {cam.index}{s.label ? ` · ${s.label}` : ""}</div>
        </div>
        <button className="chip shrink-0 px-2 py-0.5 text-base leading-none" onClick={onClose} aria-label="Close popup (the camera keeps running)">×</button>
      </div>
      <div className="relative aspect-video bg-black">
        <video ref={videoRef} autoPlay muted playsInline className={`h-full w-full object-contain ${live ? "" : "invisible"}`} />
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
        {live && (
          <span className="absolute left-2 top-2 flex gap-1 font-mono text-[0.65rem]">
            <span className={`rounded px-1.5 py-0.5 ${air === "on" ? "bg-red-600/90 font-semibold" : "bg-black/70"}`}
              title={air === "on" ? "Viewers with the password can watch" : s.air?.message || "Connecting to Cloudflare"}>
              {air === "on" ? "● ON AIR" : air === "connecting" ? "connecting…" : air === "stopped" ? "LIVE STOPPED" : air === "error" ? "OFF AIR" : "LOCAL"}
            </span>
          </span>
        )}
        {s.rec && (
          <span className="absolute bottom-2 left-2 rounded bg-red-600/90 px-1.5 py-0.5 font-mono text-[0.65rem] font-semibold tabular-nums">
            ● REC {clock(recS)} / {clock(LOGGING.maxRecordingS)}
          </span>
        )}
        {top && (
          <span className="absolute right-2 top-2 animate-pulse rounded bg-red-600/90 px-1.5 py-0.5 font-mono text-[0.65rem] font-semibold uppercase">
            {top.name} {Math.round(top.conf * 100)}%
          </span>
        )}
        {!live && (
          <div className="absolute inset-0 flex items-center justify-center p-3 text-center text-xs text-muted">
            {s.status === "error" ? s.message : "Opening camera…"}
          </div>
        )}
      </div>
      <div className="flex justify-between gap-2 px-3 py-1.5 font-mono text-[0.68rem] text-muted tabular-nums">
        <span className="truncate">{cam.lat.toFixed(5)}, {cam.lon.toFixed(5)}{cam.barangay ? ` · ${cam.barangay}` : ""}</span>
        {det && <span className="shrink-0">AI {Math.round(det.ms)} ms</span>}
      </div>
      {s.detError && <p className="px-3 pb-2 text-[0.68rem] text-[#f2a0a0]">Detection error: {s.detError}</p>}
      <div className="grid gap-1 border-t border-line px-3 py-2 text-[0.68rem]">
        <div className="grid grid-cols-2 gap-1.5">
          <button type="button" className={`chip py-1 ${liveOn ? "" : "!border-accent"}`} onClick={() => onSetLive?.([cam.id], !liveOn)} aria-pressed={!liveOn}
            title={liveOn ? "Stop sending live video. Detection, pictures and recording keep running." : "Send live video again"}>
            {liveOn ? "■ Stop live" : "▶ Start live"}
          </button>
          <button type="button" className={`chip py-1 ${s.rec ? "!border-red-500 text-red-300" : ""}`} onClick={() => hub.action(cam.id).toggleRecord?.()}
            disabled={!live && !s.rec} aria-pressed={!!s.rec}>
            {s.rec ? "■ Stop rec" : "● Record"}
          </button>
        </div>
        {!liveOn && <span className="text-muted">Live video stopped for viewers. Detection and the per-minute picture still run.</span>}
        {s.rec && <span className="text-muted">{s.rec.mode === "folder" ? "Writing to your recordings folder" : "Kept in memory, downloads when you stop"}. Stops by itself after {LOGGING.maxRecordingS / 60} min. Closing this popup does not stop it.</span>}
        {s.recMsg && <span className={s.recMsg.ok ? "text-muted" : "text-[#f2a0a0]"}>{s.recMsg.text}</span>}
        {air === "error" && <span className="text-[#f2a0a0]">Live: {s.air.message}</span>}
        {s.saveMsg && <span className={s.saveMsg.ok ? "text-muted" : "text-[#f2a0a0]"}>{s.saveMsg.text} {new Date(s.saveMsg.t).toLocaleTimeString()}</span>}
        {s.previewErr && <span className="text-[#f2a0a0]">Preview not saved: {s.previewErr}</span>}
      </div>
    </div>
  );
}
