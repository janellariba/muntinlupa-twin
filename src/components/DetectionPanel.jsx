// DetectionPanel.jsx
// "Detection & triangulation" card: load the fire/smoke model, switch detection on/off, and see each
// open camera's detection, its bearing, and the triangulation result.
import { H2 } from "./Panels";
import { DETECTION, TRIANGULATION, LOGGING } from "../lib/detectionConfig";

export default function DetectionPanel({ model, onLoadFile, onForget, detectOn, onToggleDetect, live, openCount, combined, estimate, estimateActive, deviceName }) {
  const { observations = [] } = live || {};
  const cmb = combined, ce = cmb?.estimate;
  return (
    <div>
      <H2>Detection & triangulation</H2>

      {/* Model */}
      {model.status === "ready" ? (
        <div className="rounded-md border border-line p-2 text-xs">
          <div className="flex items-baseline justify-between gap-2">
            <b className="truncate text-sm">{model.info.name}</b>
            <span className="shrink-0 rounded border border-line px-1 font-mono text-[0.65rem] uppercase">{model.info.provider === "webgpu" ? "GPU" : "CPU"}</span>
          </div>
          <div className="mt-0.5 text-muted">
            classes: {Object.values(model.info.names).join(", ")} · {model.info.imgsz} px · {model.info.sizeMB.toFixed(1)} MB
          </div>
          {model.info.provider !== "webgpu" && (
            <p className="mt-1 text-[0.68rem] text-muted">Running on the CPU (this browser has no WebGPU). Detection is slower; use Chrome or Edge on a PC with a graphics card for best speed.</p>
          )}
          <div className="mt-2 flex gap-1.5">
            <label className="chip flex flex-1 items-center justify-center gap-2 py-1">
              <input type="checkbox" className="size-4 accent-[#f2a33a]" checked={detectOn} onChange={onToggleDetect} /> Run detection
            </label>
            <button type="button" className="chip py-1" onClick={onForget}>Remove model</button>
          </div>
        </div>
      ) : (
        <div className="text-xs">
          <label className="chip flex cursor-pointer items-center justify-center py-2" aria-busy={model.status === "loading"}>
            {model.status === "loading" ? "Loading model…" : "Load model (.onnx)"}
            <input type="file" accept=".onnx" className="sr-only" onChange={onLoadFile} disabled={model.status === "loading"} />
          </label>
          {model.status === "error" && <p role="alert" className="mt-1.5 text-[#f2a0a0]">{model.error}</p>}
          <p className="mt-1.5 text-[0.68rem] leading-snug text-muted">
            Your fire/smoke YOLO model exported to ONNX (<code className="font-mono">yolo export model=best.pt format=onnx imgsz=640 opset=12</code>).
            It stays on this device; the browser remembers it.
          </p>
        </div>
      )}

      {/* Per-camera status (cameras on THIS laptop, live) */}
      {model.status === "ready" && detectOn && (
        <div className="mt-3 text-xs">
          {openCount === 0 ? (
            <p className="text-muted">No cameras yet. Add one in Camera config: it starts streaming and detecting automatically.</p>
          ) : observations.length === 0 ? (
            <p className="text-muted">Detecting on {openCount} camera{openCount > 1 ? "s" : ""}. No fire or smoke in the last {DETECTION.combineWindowS} s.</p>
          ) : (
            <ul className="grid gap-1">
              {observations.map((o) => (
                <li key={o.cam.id} className="flex items-baseline justify-between gap-2 rounded-md border border-line px-2 py-1">
                  <span className="min-w-0 truncate">
                    <b>{o.cam.name}</b>{" "}
                    <span className={o.box.fromSmoke ? "text-muted" : "text-red-400"}>{o.box.name} {Math.round(o.box.conf * 100)}%</span>
                  </span>
                  <span className="shrink-0 font-mono tabular-nums text-muted">
                    {o.bearing != null ? `${o.bearing.toFixed(1)}°${o.box.fromSmoke ? " (smoke)" : ""}` : "NOT MEASURED"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Combined on the server: bearings from cameras on ALL laptops */}
      <div className="mt-3 text-xs">
        <div className="font-display text-sm font-semibold uppercase tracking-wide text-muted">All devices (server)</div>
        {!cmb || cmb.status === "none" ? (
          <p className="mt-1 text-muted">No camera on any laptop sees fire or smoke right now (last {DETECTION.combineWindowS} s).</p>
        ) : (
          <>
            <ul className="mt-1 grid gap-1">
              {cmb.bearings.map((b) => (
                <li key={b.cameraId} className="flex items-baseline justify-between gap-2 rounded-md border border-line px-2 py-1">
                  <span className="min-w-0 truncate"><b>{b.name}</b> <span className="text-muted">{b.device ?? "?"}</span></span>
                  <span className="shrink-0 font-mono tabular-nums text-muted">{b.bearing.toFixed(1)}°{b.fromSmoke ? " (smoke)" : ""} · {Math.round(b.ageS)} s</span>
                </li>
              ))}
            </ul>
            <div className={`mt-2 rounded-md border p-2 ${cmb.status === "ok" ? "border-red-500" : "border-line"}`} aria-live="polite">
              {cmb.status === "ok" ? (
                <>
                  <div className="font-display text-sm font-semibold uppercase tracking-wide text-red-400">Fire estimate{ce.usesSmoke ? " (uses smoke)" : ""}</div>
                  <div className="mt-0.5 font-mono tabular-nums">{ce.lat.toFixed(6)}, {ce.lon.toFixed(6)}</div>
                  <div className="mt-0.5 text-muted">
                    ±{Math.round(ce.ellipse.major)} m × {Math.round(ce.ellipse.minor)} m (95%) · {cmb.nRays} bearings · widest angle {cmb.maxRayAngleDeg.toFixed(0)}°
                    {cmb.residualRmsDeg != null ? ` · lines miss by ${cmb.residualRmsDeg.toFixed(1)}° RMS` : ""}
                  </div>
                </>
              ) : (
                <><b className="uppercase">Rejected:</b> <span className="text-muted">{cmb.reason}</span></>
              )}
            </div>
          </>
        )}
        {estimate && (
          <p className="mt-1.5 text-[0.68rem] text-muted">
            Last saved estimate: {new Date(estimate.estimatedAt).toLocaleTimeString()} ({estimate.nRays} bearings){estimateActive ? ", active" : ""}.
          </p>
        )}
      </div>

      <p className="mt-2 text-[0.65rem] leading-snug text-muted">
        While detecting: bearing to the server every {LOGGING.bearingIntervalS} s, 1 snapshot per camera every {LOGGING.snapshotIntervalS} s. The server combines all laptops' bearings and saves the estimate when it appears, then every {LOGGING.estimateIntervalS} s (approved 2026-11-28).
      </p>
      <p className="mt-1 text-[0.65rem] leading-snug text-muted">
        TEMPORARY values (approved 2026-11-27): confidence {DETECTION.confThreshold} · {DETECTION.runsPerSecond} runs/s per camera ·
        {" "}{DETECTION.combineWindowS} s window · min angle {TRIANGULATION.minRayAngleDeg}° · max range {TRIANGULATION.maxRangeM / 1000} km ·
        bearing error {TRIANGULATION.bearingSigmaDeg}° · pinhole bearing model. Assumes one fire at a time.
      </p>
    </div>
  );
}
