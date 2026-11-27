// CameraPopup.jsx
// Small popup above a camera mark with the live webcam stream for that camera's index.
// The webcam is opened when the popup opens and released when it closes.
import { useEffect, useRef, useState } from "react";
import { openCamera, stopStream } from "../lib/webcam";

export default function CameraPopup({ cam, onClose }) {
  const videoRef = useRef(null);
  const [state, setState] = useState({ status: "opening" });

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

  return (
    <div role="dialog" aria-label={`${cam.name} camera stream`}
      className="panel w-64 overflow-hidden p-0 text-left shadow-2xl sm:w-72 2xl:w-80"
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
        {state.status === "live" && (
          <span className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[0.65rem]">
            <span className="mr-1 inline-block size-1.5 rounded-full bg-red-500 align-middle" />LIVE
          </span>
        )}
        {state.status !== "live" && (
          <div className="absolute inset-0 flex items-center justify-center p-3 text-center text-xs text-muted">
            {state.status === "opening" ? "Opening camera…" : state.message}
          </div>
        )}
      </div>
      <div className="px-3 py-1.5 font-mono text-[0.68rem] text-muted tabular-nums">
        {cam.lat.toFixed(6)}, {cam.lon.toFixed(6)}{cam.barangay ? ` · ${cam.barangay}` : ""}
      </div>
    </div>
  );
}
