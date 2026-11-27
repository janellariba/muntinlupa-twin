// CameraConfig.jsx
// "Camera config" card: add a camera by latitude, longitude and webcam index; list, edit,
// show and remove saved cameras. Cameras are saved in this browser.
import { useState } from "react";
import { H2 } from "./Panels";
import { MAX_INDEX } from "../lib/cameraConfig";
import { listCameras } from "../lib/webcam";

const EMPTY = { name: "", lat: "", lon: "", index: "" };
const field = "mt-1 w-full rounded-md border border-line bg-[#0f191d] px-2.5 py-1.5 text-sm text-ink placeholder:text-muted/60 focus:border-accent focus:outline-none";

export default function CameraConfig({ cameras, onSave, onRemove, onShow, validate, openIds = [], onOpenAll, onCloseAll }) {
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");
  const [detected, setDetected] = useState(null); // null = not checked yet
  const [detectMsg, setDetectMsg] = useState("");

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = (e) => {
    e.preventDefault();
    const res = validate(form, editingId);
    if (res.error) { setError(res.error); return; }
    onSave(res.cam);
    setForm(EMPTY); setEditingId(null); setError("");
  };

  const edit = (c) => {
    setEditingId(c.id);
    setForm({ name: c.name, lat: String(c.lat), lon: String(c.lon), index: String(c.index) });
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
          <button type="submit" className="chip flex-1" aria-pressed="true">{editingId ? "Save changes" : "Add camera"}</button>
          {editingId && <button type="button" className="chip" onClick={() => { setEditingId(null); setForm(EMPTY); setError(""); }}>Cancel</button>}
        </div>
      </form>

      <div className="mt-3">
        {cameras.length === 0 ? (
          <p className="text-xs text-muted">No cameras yet. Add one above and its mark appears on the map.</p>
        ) : (
          <>
          {cameras.length > 1 && (
            <div className="mb-1.5 flex gap-1.5">
              <button type="button" className="chip flex-1 py-1" onClick={onOpenAll}>Open all streams</button>
              <button type="button" className="chip flex-1 py-1" onClick={onCloseAll} disabled={!openIds.length}>Close all</button>
            </div>
          )}
          <ul className="grid gap-1.5">
            {cameras.map((c) => (
              <li key={c.id} className="rounded-md border border-line p-2 text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <b className="truncate text-sm">{c.name}</b>
                  <span className="shrink-0 font-mono text-muted">index {c.index}</span>
                </div>
                <div className="mt-0.5 font-mono text-muted tabular-nums">{c.lat.toFixed(6)}, {c.lon.toFixed(6)}{c.barangay ? ` · ${c.barangay}` : ""}</div>
                <div className="mt-1.5 flex gap-1.5">
                  <button type="button" className="chip flex-1 py-1" aria-pressed={openIds.includes(c.id)} onClick={() => onShow(c)}>Show</button>
                  <button type="button" className="chip flex-1 py-1" onClick={() => edit(c)}>Edit</button>
                  <button type="button" className="chip flex-1 py-1" onClick={() => onRemove(c.id)}>Remove</button>
                </div>
              </li>
            ))}
          </ul>
          </>
        )}
        <p className="mt-2 text-[0.7rem] leading-snug text-muted">
          Saved in this browser only. The stream opens the webcam with that index on the device viewing this page.
        </p>
      </div>
    </div>
  );
}
