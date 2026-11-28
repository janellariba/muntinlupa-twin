// AdminPanels.jsx: the admin login screen, the admin bar, the recordings card, the one-time
// "import cameras from this browser" card, and the read-only camera list shown on the twin page.
import { useEffect, useState } from "react";
import { H2 } from "./Panels";
import { api } from "../lib/api";
import { folderSupported, chooseFolder, savedFolder } from "../lib/recorder";
import { agoText } from "../lib/useTwinStatus";

const field = "mt-1 w-full rounded-md border border-line bg-[#0f191d] px-2.5 py-1.5 text-sm text-ink focus:border-accent focus:outline-none";

/* Checks the admin session; shows the password form until logged in. */
export function AdminGate({ children }) {
  const [state, setState] = useState("checking"); // checking | out | in | error
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.session().then((r) => setState(r.admin ? "in" : "out")).catch((e) => { setMsg(e.message); setState("out"); });
  }, []);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg("");
    try { await api.login(pw); setPw(""); setState("in"); }
    catch (err) { setMsg(err.message); }
    finally { setBusy(false); }
  };
  const logout = async () => { try { await api.logout(); } finally { setState("out"); } };
  if (state === "in") return children(logout);
  return (
    <div className="grid h-dvh place-items-center bg-bg p-4">
      <form onSubmit={submit} className="panel w-full max-w-sm p-5">
        <h1 className="font-display text-2xl font-bold uppercase tracking-wide">Muntinlupa <span className="text-accent">Twin</span> admin</h1>
        <p className="mt-1 text-xs text-muted">Camera config, detection, snapshots and recordings. The public twin is at <a className="underline" href="/">/</a>.</p>
        {state === "checking" ? <p className="mt-4 text-sm text-muted">Checking…</p> : (
          <>
            <label className="mt-4 block text-xs text-muted" htmlFor="admin-pw">Admin password
              <input id="admin-pw" type="password" autoComplete="current-password" className={field} value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
            </label>
            {msg && <p role="alert" className="mt-2 text-xs text-[#f2a0a0]">{msg}</p>}
            <button className="chip mt-3 w-full py-2" aria-pressed="true" disabled={busy || !pw}>{busy ? "Checking…" : "Log in"}</button>
          </>
        )}
      </form>
    </div>
  );
}

export function AdminBar({ onLogout, dbError }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="rounded border border-accent px-1.5 py-0.5 font-display text-xs font-semibold uppercase tracking-wider text-accent">Admin console</span>
        <span className="flex gap-1.5">
          <a className="chip py-1 text-xs" href="/" target="_blank" rel="noreferrer">Open twin</a>
          <button className="chip py-1 text-xs" onClick={onLogout}>Log out</button>
        </span>
      </div>
      {dbError && <p role="alert" className="mt-2 text-xs text-[#f2a0a0]">Database: {dbError}</p>}
    </div>
  );
}

/* Recordings folder + the last 50 recordings logged in the database. */
export function RecordingsPanel({ folder, onFolder, version }) {
  const [list, setList] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api.recordings().then((r) => { setList(r.recordings); setErr(""); }).catch((e) => setErr(e.message));
  }, [version]);
  const pick = async () => { try { onFolder(await chooseFolder()); } catch (e) { if (e.name !== "AbortError") setErr(e.message); } };
  return (
    <div>
      <H2>Recordings</H2>
      {folderSupported() ? (
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="min-w-0 truncate text-muted">Folder: <b className="text-ink">{folder ? folder.name : "not chosen"}</b></span>
          <button className="chip shrink-0 py-1" onClick={pick}>{folder ? "Change" : "Choose folder"}</button>
        </div>
      ) : (
        <p className="text-xs text-muted">This browser cannot write to a folder, so each recording downloads when you stop it (kept in memory until then). Chrome or Edge can write straight to a folder.</p>
      )}
      <p className="mt-1.5 text-[0.68rem] leading-snug text-muted">Use ● Record in a camera popup. Videos stay on this laptop; only the file name, camera and times are saved in the database.</p>
      {err && <p className="mt-1.5 text-xs text-[#f2a0a0]">{err}</p>}
      {list?.length > 0 && (
        <ul className="mt-2 grid max-h-48 gap-1 overflow-y-auto text-[0.7rem]">
          {list.map((r) => (
            <li key={r.id} className="rounded-md border border-line px-2 py-1">
              <div className="truncate font-mono">{r.fileName}</div>
              <div className="text-muted">{r.cameraName} · {new Date(r.startedAt).toLocaleString()} · {r.durationS < 60 ? `${Math.round(r.durationS)} s` : `${Math.round(r.durationS / 60)} min`}{r.sizeBytes ? ` · ${(r.sizeBytes / 1e6).toFixed(1)} MB` : ""}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
export { savedFolder };

/* Cameras added before the database existed live in this browser only: offer to copy them once. */
export function ImportCard({ local, onImport }) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  if (!local.length) return null;
  const run = async () => { setBusy(true); setMsg(await onImport()); setBusy(false); };
  return (
    <div className="rounded-md border border-accent p-2 text-xs">
      <p><b>{local.length} camera{local.length > 1 ? "s" : ""}</b> saved in this browser from before the database: {local.map((c) => c.name).join(", ")}.</p>
      <button className="chip mt-1.5 w-full py-1" onClick={run} disabled={busy}>{busy ? "Importing…" : "Import into the database"}</button>
      {msg && <p className="mt-1 text-[#f2a0a0]">{msg}</p>}
    </div>
  );
}

/* Twin page: cameras from the database, read only. */
export function CameraList({ cameras, onShow, openIds, error, loaded }) {
  return (
    <div>
      <H2>Cameras</H2>
      {error && <p role="alert" className="mb-1.5 text-xs text-[#f2a0a0]">Camera data unavailable: {error}</p>}
      {!loaded ? <p className="text-xs text-muted">Loading cameras…</p> : cameras.length === 0 ? (
        <p className="text-xs text-muted">No cameras yet. Cameras are added in the admin console.</p>
      ) : (
        <ul className="grid gap-1.5">
          {cameras.map((c) => (
            <li key={c.id}>
              <button className={`w-full rounded-md border p-2 text-left text-xs hover:border-accent ${c.detectingNow ? "border-red-500" : "border-line"}`}
                aria-pressed={openIds.includes(c.id)} onClick={() => onShow(c)}>
                <div className="flex items-baseline justify-between gap-2">
                  <b className="truncate text-sm">{c.name}</b>
                  {c.detectingNow
                    ? <span className="shrink-0 animate-pulse font-mono text-red-400">{c.lastDet.className} {Math.round(c.lastDet.confidence * 100)}%</span>
                    : <span className="shrink-0 text-muted">{c.lastDet ? `last ${c.lastDet.className} ${agoText(c.lastDetAgeS)}` : "no detections"}</span>}
                </div>
                <div className="mt-0.5 font-mono text-muted tabular-nums">{c.lat.toFixed(5)}, {c.lon.toFixed(5)}{c.barangay ? ` · ${c.barangay}` : ""}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
