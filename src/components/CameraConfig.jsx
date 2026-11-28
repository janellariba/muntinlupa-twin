// CameraConfig.jsx
// "Camera config" card: add a camera by latitude, longitude and webcam index; list, edit,
// show and remove saved cameras. Cameras are saved in the database (admin console), so every device
// that opens the twin sees them.
import { useState } from "react";
import { H2 } from "./Panels";
import { MAX_INDEX } from "../lib/cameraConfig";
import { listCameras } from "../lib/webcam";

const EMPTY = { name: "", lat: "", lon: "", index: "", heading: "", fov: "" };
const field = "mt-1 w-full rounded-md border border-line bg-[#0f191d] px-2.5 py-1.5 text-sm text-ink placeholder:text-muted/60 focus:border-accent focus:outline-none";

export default function CameraConfig({ cameras, onSave, onRemove, onShow, validate, openIds = [], onOpenAll, onCloseAll, liveOff = [], onSetLive }) {
  const allIds = cameras.map((c) => c.id), anyOn = allIds.some((x) => !liveOff.includes(x)), anyOff = allIds.some((x) => liveOff.includes(x));
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");
  const [detected, setDetected] = useState(null); // null = not checked yet
  const [detectMsg, setDetectMsg] = useState("");

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    const res = validate(form, editingId);
    if (res.error) { setError(res.error); return; }
    setBusy(true);
    try {
      await onSave(res.cam, editingId);
      setForm(EMPTY); setEditingId(null); setError("");
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const remove = async (c) => {
    if (!window.confirm(`Remove camera "${c.name}"? Its saved snapshots and estimates are kept.`)) return;
    try { await onRemove(c.id); setError(""); } catch (err) { setError(err.message); }
  };

  const edit = (c) => {
    setEditingId(c.id);
    setForm({ name: c.name, lat: String(c.lat), lon: String(c.lon), index: String(c.index), heading: c.heading ?? "", fov: c.fov ?? "" });
    setError("");
  };

  const detect = async () => {
    setDetectMsg("Checking cameras…");
    try {
      const list = await listCameras();
      setDetected(list);
      setDetectMsg(list.length ? "" : "No camera found on this device.");
    } catch (e) {
      setDetected(null);
      setDetectMsg(e.message);
    }
  };

  return (
    <div>
      <H2>Camera config</H2>

      <form onSubmit={submit} className="grid gap-2" noValidate>
        <label className="block text-xs text-muted" htmlFor="cam-name">
          Name <span className="opacity-70">(optional)</span>
          <input id="cam-name" className={field} value={form.name} onChange={set("name")} placeholder="e.g. Tunasan rooftop" maxLength={40} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs text-muted" htmlFor="cam-lat">
            Latitude
            <input id="cam-lat" className={field} value={form.lat} onChange={set("lat")} inputMode="decimal" placeholder="14.xxxxxx" />
          </label>
          <label className="block text-xs text-muted" htmlFor="cam-lon">
            Longitude
            <input id="cam-lon" className={field} value={form.lon} onChange={set("lon")} inputMode="decimal" placeholder="121.xxxxxx" />
          </label>
        </div>
        <div className="grid grid-cols-[1fr_auto] items-end gap-2">
          <label className="block text-xs text-muted" htmlFor="cam-index">
            Camera index
            <input id="cam-index" className={field} value={form.index} onChange={set("index")} inputMode="numeric" placeholder={`0 to ${MAX_INDEX}`} />
          </label>
          <button type="button" className="chip" onClick={detect}>Detect cameras</button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs text-muted" htmlFor="cam-heading">
            Heading (°) <span className="opacity-70">measured</span>
            <input id="cam-heading" className={field} value={form.heading} onChange={set("heading")} inputMode="decimal" placeholder="0 = north" />
          </label>
          <label className="block text-xs text-muted" htmlFor="cam-fov">
            Field of view (°) <span className="opacity-70">measured</span>
            <input id="cam-fov" className={field} value={form.fov} onChange={set("fov")} inputMode="decimal" placeholder="horizontal" />
          </label>
        </div>
        <p className="-mt-1 text-[0.68rem] leading-snug text-muted">Leave empty until measured. Without both, the camera still detects but gives no bearing.</p>

        {detectMsg && <p className="text-xs text-muted">{detectMsg}</p>}
        {detected?.length > 0 && (
          <ul className="grid gap-1 rounded-md border border-line p-2 text-xs" aria-label="Cameras on this device">
            {detected.map((d) => (
              <li key={d.deviceId || d.index}>
                <button type="button" className="flex w-full gap-2 text-left hover:text-accent" onClick={() => setForm((f) => ({ ...f, index: String(d.index) }))}>
                  <b className="font-mono tabular-nums">{d.index}</b><span className="truncate">{d.label}</span>
                </button>
              </li>
            ))}
            <li className="text-muted">Click one to use its index.</li>
          </ul>
        )}

        {error && <p role="alert" className="text-xs text-[#f2a0a0]">{error}</p>}
        <div className="flex gap-1.5">
          <button type="submit" className="chip flex-1" aria-pressed="true" disabled={busy}>{busy ? "Saving…" : editingId ? "Save changes" : "Add camera"}</button>
          {editingId && <button type="button" className="chip" onClick={() => { setEditingId(null); setForm(EMPTY); setError(""); }}>Cancel</button>}
        </div>
      </form>

      <div className="mt-3">
        {cameras.length === 0 ? (
          <p className="text-xs text-muted">No cameras yet. Add one above and its mark appears on the map.</p>
        ) : (
          <>
          {onSetLive && (
            <div className="mb-1.5 flex gap-1.5">
              <button type="button" className="chip flex-1 py-1" onClick={() => onSetLive(allIds, false)} disabled={!anyOn}>■ Stop all cameras</button>
              <button type="button" className="chip flex-1 py-1" onClick={() => onSetLive(allIds, true)} disabled={!anyOff}>▶ Start all cameras</button>
            </div>
          )}
          {cameras.length > 1 && (
            <div className="mb-1.5 flex gap-1.5">
              <button type="button" className="chip flex-1 py-1" onClick={onOpenAll}>Show all</button>
              <button type="button" className="chip flex-1 py-1" onClick={onCloseAll} disabled={!openIds.length}>Close all</button>
            </div>
          )}
          <ul className="grid gap-1.5">
            {cameras.map((c) => (
              <li key={c.id} className="rounded-md border border-line p-2 text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <b className="truncate text-sm">{c.name}</b>
                  <span className="shrink-0 font-mono text-muted">index {c.index}{" "}
                    <span className={`ml-1 rounded px-1 text-[0.6rem] ${liveOff.includes(c.id) ? "border border-line" : "bg-red-600/90 text-white"}`}>{liveOff.includes(c.id) ? "STOPPED" : "ON"}</span>
                  </span>
                </div>
                <div className="mt-0.5 font-mono text-muted tabular-nums">{c.lat.toFixed(6)}, {c.lon.toFixed(6)}{c.barangay ? ` · ${c.barangay}` : ""}</div>
                <div className="mt-0.5 font-mono tabular-nums">
                  {c.heading != null && c.fov != null
                    ? <span className="text-muted">heading {c.heading}° · FOV {c.fov}°</span>
                    : <span className="rounded border border-line px-1 text-[0.65rem] text-muted">NOT MEASURED: no bearing</span>}
                </div>
                <div className="mt-1.5 flex gap-1.5">
                  <button type="button" className="chip flex-1 py-1" aria-pressed={openIds.includes(c.id)} onClick={() => onShow(c)}>Show</button>
                  {onSetLive && (
                    <button type="button" className="chip flex-1 py-1" onClick={() => onSetLive([c.id], liveOff.includes(c.id))}>
                      {liveOff.includes(c.id) ? "Start" : "Stop"}
                    </button>
                  )}
                  <button type="button" className="chip flex-1 py-1" onClick={() => edit(c)}>Edit</button>
                  <button type="button" className="chip flex-1 py-1" onClick={() => remove(c)}>Remove</button>
                </div>
              </li>
            ))}
          </ul>
          </>
        )}
        <p className="mt-2 text-[0.7rem] leading-snug text-muted">
          Saved in the database: the twin page on any device shows these cameras. While this console is open, each camera's webcam (that index on this laptop) streams live, detects and sends a picture every minute, even with its popup closed. Stop turns a camera fully off.
        </p>
      </div>
    </div>
  );
}
