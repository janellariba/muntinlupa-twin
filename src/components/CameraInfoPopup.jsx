// CameraInfoPopup.jsx
// Twin page (read only): popup above a camera mark with the LATEST SAVED snapshot from the database,
// what was detected, the bearing and how long ago. The webcam itself is only opened on the admin
// device, because a camera index means a webcam plugged into that device.
import { useEffect } from "react";
import { agoText } from "../lib/useTwinStatus";

export default function CameraInfoPopup({ cam, onClose }) {
  const d = cam.lastDet;
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div role="dialog" aria-label={`${cam.name} latest snapshot`}
      className={`panel w-64 overflow-hidden p-0 text-left shadow-2xl sm:w-72 2xl:w-80 ${cam.detectingNow ? "!border-red-500" : ""}`}
      onPointerDown={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate font-display text-base font-semibold uppercase leading-tight tracking-wide">{cam.name}</div>
          <div className="truncate text-[0.68rem] text-muted">{cam.detectingNow ? "Detecting now" : "Latest saved snapshot"}</div>
        </div>
        <button className="chip shrink-0 px-2 py-0.5 text-base leading-none" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="relative aspect-video bg-black">
        {d?.snapshotUrl ? (
          <img src={d.snapshotUrl} alt={`${cam.name}: ${d.className} ${Math.round(d.confidence * 100)}%`} className="h-full w-full object-contain" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center p-3 text-center text-xs text-muted">
            {d ? "Snapshot picture not available." : "No fire or smoke saved for this camera yet."}
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
            {d.className} {Math.round(d.confidence * 100)}% · {d.bearing != null ? `bearing ${d.bearing.toFixed(1)}°${d.fromSmoke ? " (smoke)" : ""}` : "no bearing (NOT MEASURED)"} · {agoText(cam.lastDetAgeS)}
          </span>
        )}
        <span className="truncate">{cam.lat.toFixed(5)}, {cam.lon.toFixed(5)}{cam.barangay ? ` · ${cam.barangay}` : ""}</span>
      </div>
    </div>
  );
}
