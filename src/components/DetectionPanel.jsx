// DetectionPanel.jsx
// "Detection & triangulation" card: load the fire/smoke model, switch detection on/off, and see each
// open camera's detection, its bearing, and the triangulation result.
import { H2 } from "./Panels";
import { DETECTION, TRIANGULATION, LOGGING } from "../lib/detectionConfig";

export default function DetectionPanel({ model, onLoadFile, onForget, detectOn, onToggleDetect, live, openCount, saveMsg }) {
  const { observations = [], result, estimate } = live || {};
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

      {/* Per-camera status */}
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

      {/* Triangulation result */}
      {result && (
        <div className={`mt-2 rounded-md border p-2 text-xs ${result.status === "ok" ? "border-red-500" : "border-line"}`} aria-live="polite">
          {result.status === "ok" ? (
            <>
              <div className="font-display text-sm font-semibold uppercase tracking-wide text-red-400">Fire estimate{estimate.anySmoke ? " (uses smoke)" : ""}</div>
              <div className="mt-0.5 font-mono tabular-nums">{estimate.lat.toFixed(6)}, {estimate.lon.toFixed(6)}</div>
              <div className="mt-0.5 text-muted">
                ±{Math.round(estimate.ellipse.major)} m × {Math.round(estimate.ellipse.minor)} m (95%) · {result.nRays} bearings · widest angle {result.maxRayAngleDeg.toFixed(0)}°
                {result.residualRmsDeg != null ? ` · lines miss by ${result.residualRmsDeg.toFixed(1)}° RMS` : ""}
              </div>
            </>
          ) : (
            <><b className="uppercase">Rejected:</b> <span className="text-muted">{result.reason}</span></>
          )}
        </div>
      )}

      {saveMsg && <p className={`mt-1.5 text-[0.68rem] ${saveMsg.ok ? "text-muted" : "text-[#f2a0a0]"}`}>{saveMsg.text}</p>}
      <p className="mt-2 text-[0.65rem] leading-snug text-muted">
        Saved to the database while detecting: 1 snapshot per camera every {LOGGING.snapshotIntervalS} s, the estimate when it appears then every {LOGGING.estimateIntervalS} s (approved 2026-11-28).
      </p>
      <p className="mt-1 text-[0.65rem] leading-snug text-muted">
        TEMPORARY values (approved 2026-11-27): confidence {DETECTION.confThreshold} · {DETECTION.runsPerSecond} runs/s per camera ·
        {" "}{DETECTION.combineWindowS} s window · min angle {TRIANGULATION.minRayAngleDeg}° · max range {TRIANGULATION.maxRangeM / 1000} km ·
        bearing error {TRIANGULATION.bearingSigmaDeg}° · pinhole bearing model. Assumes one fire at a time.
      </p>
    </div>
  );
}
