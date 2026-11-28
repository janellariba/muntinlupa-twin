// CameraRunner.jsx (admin console, one per camera, no visible UI)
// Starts automatically when a camera exists and the admin console is open:
//   1. opens the webcam at the camera's index
//   2. publishes it live to Cloudflare (retries every LIVE.heartbeatS if it drops)
//   3. runs fire/smoke detection when a model is loaded, saving a snapshot every LOGGING.snapshotIntervalS
//      while it sees fire/smoke
//   4. uploads a preview picture every LIVE.previewIntervalS for viewers without the password
//   5. records on request (Record button in the popup), saved on this laptop
// State goes to cameraHub so popups and panels can show it.
import { useEffect, useRef } from "react";
import { openCamera, stopStream } from "../lib/webcam";
import { detect } from "../lib/detector";
import { DETECTION, LOGGING, LIVE } from "../lib/detectionConfig";
import { pickBox } from "../lib/liveTriangulation";
import { pixelToBearing } from "../lib/triangulation";
import { annotatedJpeg } from "../lib/snapshot";
import { startRecording } from "../lib/recorder";
import { publish } from "../lib/live";
import { hub } from "../lib/cameraHub";
import { api } from "../lib/api";

export default function CameraRunner({ cam, detecting, onResult, folderRef, onRecorded }) {
  const videoRef = useRef(null);
  const camRef = useRef(cam); camRef.current = cam;
  const streamRef = useRef(null);
  const lastDet = useRef(null);       // last detection run { dets, W, H, ms, t }
  const lastSnap = useRef(0);
  const recRef = useRef(null);
  const id = cam.id;

  // 1 + 2. Webcam, then live publishing with automatic retry.
  useEffect(() => {
    let stream = null, cancelled = false, pub = null, retry = null;
    hub.set(id, { status: "opening", message: "", air: { status: "off" } });
    const goLive = async () => {
      if (cancelled || !stream) return;
      hub.set(id, (s) => ({ air: { status: "connecting", since: s.air?.since } }));
      try {
        pub = await publish(id, stream, () => { pub = null; hub.set(id, { air: { status: "error", message: "Connection dropped, reconnecting…" } }); schedule(); });
        if (cancelled) { pub.close(); return; }
        hub.set(id, { air: { status: "on", since: Date.now() } });
      } catch (e) {
        if (cancelled) return;
        hub.set(id, { air: { status: "error", message: e.message } });
        schedule();
      }
    };
    const schedule = () => { clearTimeout(retry); if (!cancelled) retry = setTimeout(goLive, LIVE.heartbeatS * 1000); };
    openCamera(cam.index)
      .then((res) => {
        if (cancelled) { stopStream(res.stream); return; }
        stream = res.stream; streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        hub.set(id, { status: "live", label: res.label, stream });
        goLive();
      })
      .catch((e) => !cancelled && hub.set(id, { status: "error", message: e.message }));
    return () => {
      cancelled = true;
      clearTimeout(retry);
      pub?.close();
      recRef.current?.stop(); // the file is still saved
      streamRef.current = null;
      stopStream(stream);
      hub.set(id, { status: "off", stream: null, air: { status: "off" } });
    };
  }, [id, cam.index]);
  useEffect(() => () => hub.remove(id), [id]);

  // 3. Detection loop (one run at a time, at most DETECTION.runsPerSecond) + snapshots.
  useEffect(() => {
    if (!detecting) { lastDet.current = null; hub.set(id, { det: null, detError: "" }); onResult?.(id, null); return; }
    let busy = false, alive = true;
    const t = setInterval(() => {
      const v = videoRef.current;
      if (busy || !v?.videoWidth) return;
      busy = true;
      detect(v)
        .then((r) => {
          if (!alive || !r) return;
          lastDet.current = { ...r, t: Date.now() };
          hub.set(id, { det: r, detError: "" });
          onResult?.(id, r);
          saveSnapshot(r);
        })
        .catch((e) => alive && hub.set(id, { detError: e.message || String(e) }))
        .finally(() => { busy = false; });
    }, 1000 / DETECTION.runsPerSecond);
    return () => { alive = false; clearInterval(t); onResult?.(id, null); };
  }, [detecting, id, onResult]); // eslint-disable-line react-hooks/exhaustive-deps

  function saveSnapshot(r) {
    const box = pickBox(r.dets);
    if (!box || Date.now() - lastSnap.current < LOGGING.snapshotIntervalS * 1000) return;
    lastSnap.current = Date.now();
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
      .then(() => hub.set(id, { saveMsg: { ok: true, text: "Snapshot saved", t: Date.now() } }))
      .catch((e) => hub.set(id, { saveMsg: { ok: false, text: `Snapshot not saved: ${e.message}`, t: Date.now() } }));
  }

  // 4. Preview picture for viewers without the password (first one a few seconds after the camera opens).
  useEffect(() => {
    const send = () => {
      const v = videoRef.current;
      if (!v?.videoWidth) return;
      const d = lastDet.current && Date.now() - lastDet.current.t < 2000 ? lastDet.current.dets : [];
      let jpeg;
      try { jpeg = annotatedJpeg(v, d, camRef.current.name); } catch { return; }
      api.savePreview(id, jpeg)
        .then(() => hub.set(id, { previewAt: Date.now(), previewErr: "" }))
        .catch((e) => hub.set(id, { previewErr: e.message }));
    };
    const first = setTimeout(send, 5000);
    const t = setInterval(send, LIVE.previewIntervalS * 1000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [id]);

  // 5. Recording, started/stopped from the popup.
  useEffect(() => {
    hub.setActions(id, {
      async toggleRecord() {
        if (recRef.current) { recRef.current.stop(); return; }
        if (!streamRef.current) return;
        hub.set(id, { recMsg: null });
        try {
          const r = await startRecording(streamRef.current, camRef.current.name, folderRef.current);
          recRef.current = r;
          hub.set(id, { rec: { startedAt: Date.now(), mode: r.mode } });
          r.done
            .then((meta) => api.logRecording({ cameraId: id, ...meta })
              .then(() => hub.set(id, { recMsg: { ok: true, text: `Saved ${meta.fileName}${meta.mode === "folder" ? " in your recordings folder" : " to Downloads"}` } }))
              .catch((e) => hub.set(id, { recMsg: { ok: false, text: `Video saved as ${meta.fileName}, but not logged: ${e.message}` } }))
              .finally(() => onRecorded?.()))
            .catch((e) => hub.set(id, { recMsg: { ok: false, text: e.message } }))
            .finally(() => { recRef.current = null; hub.set(id, { rec: null }); });
        } catch (e) { hub.set(id, { recMsg: { ok: false, text: e.message } }); }
      },
    });
  }, [id, folderRef, onRecorded]);

  // The video element must stay in the page (not display:none) so the browser keeps decoding frames.
  return (
    <video ref={videoRef} autoPlay muted playsInline aria-hidden="true"
      style={{ position: "fixed", left: 0, top: 0, width: 2, height: 2, opacity: 0, pointerEvents: "none" }} />
  );
}
