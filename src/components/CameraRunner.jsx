// CameraRunner.jsx (admin console, one per camera, no visible UI)
// Starts automatically when a camera exists and the admin console is open:
//   1. opens the webcam at the camera's index
//   2. publishes it live to Cloudflare (retries every LIVE.heartbeatS if it drops)
// "Stop camera" (liveOn false) turns ALL of it off for that camera: webcam, live video, detection,
// previews and any recording (the recording file is still saved). "Start camera" turns it back on.
//   3. runs fire/smoke detection when a model is loaded, saving a snapshot every LOGGING.snapshotIntervalS
//      while it sees fire/smoke
//   4. uploads a preview picture every LIVE.previewIntervalS for viewers without the password
//   5. records on request (Record button in the popup), saved on this laptop
// State goes to cameraHub so popups and panels can show it.
import { useEffect, useRef, useState } from "react";
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

export default function CameraRunner({ cam, detecting, liveOn, onResult, folderRef, onRecorded }) {
  const videoRef = useRef(null);
  const camRef = useRef(cam); camRef.current = cam;
  const streamRef = useRef(null);
  const lastDet = useRef(null);       // last detection run { dets, W, H, ms, t }
  const lastSnap = useRef(0);
  const lastBearing = useRef(0);
  const recRef = useRef(null);
  const [stream, setStream] = useState(null);
  const id = cam.id;

  // 1. Webcam, open while the camera is started (detection, previews and recording use it).
  useEffect(() => {
    if (!liveOn) { hub.set(id, { status: "stopped", stream: null, det: null, message: "" }); return; }
    let s = null, cancelled = false;
    hub.set(id, { status: "opening", message: "" });
    openCamera(cam.index)
      .then((res) => {
        if (cancelled) { stopStream(res.stream); return; }
        s = res.stream; streamRef.current = s;
        if (videoRef.current) videoRef.current.srcObject = s;
        hub.set(id, { status: "live", label: res.label, stream: s });
        setStream(s);
      })
      .catch((e) => !cancelled && hub.set(id, { status: "error", message: e.message }));
    return () => {
      cancelled = true;
      recRef.current?.stop(); // the file is still saved
      streamRef.current = null;
      setStream(null);
      stopStream(s);
      if (videoRef.current) videoRef.current.srcObject = null;
      hub.set(id, { status: "off", stream: null });
    };
  }, [id, cam.index, liveOn]);

  // 2. Live video to Cloudflare while the camera is started, retrying if it drops.
  useEffect(() => {
    if (!stream || !liveOn) { hub.set(id, { air: { status: liveOn ? "off" : "stopped" } }); return; }
    let cancelled = false, pub = null, retry = null;
    const goLive = async () => {
      if (cancelled || !stream) return;
      hub.set(id, (s) => ({ air: { status: "connecting", since: s.air?.since } }));
      try {
        pub = await publish(id, stream, () => { pub = null; hub.set(id, { air: { status: "error", message: "Connection dropped, reconnecting…" } }); schedule(); });
        if (cancelled) { pub.close(); return; }
        hub.set(id, { air: { status: "on", since: Date.now(), sessionId: pub.sessionId } });
      } catch (e) {
        if (cancelled) return;
        hub.set(id, { air: { status: "error", message: e.message } });
        schedule();
      }
    };
    const schedule = () => { clearTimeout(retry); if (!cancelled) retry = setTimeout(goLive, LIVE.heartbeatS * 1000); };
    goLive();
    return () => {
      cancelled = true;
      clearTimeout(retry);
      pub?.close(); // also tells the server this camera is no longer live
    };
  }, [id, stream, liveOn]);
  useEffect(() => () => hub.remove(id), [id]);

  // 3. Detection loop (one run at a time, at most DETECTION.runsPerSecond) + snapshots.
  useEffect(() => {
    if (!detecting || !stream) { lastDet.current = null; hub.set(id, { det: null, detError: "" }); onResult?.(id, null); return; }
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
          sendBearing(r);
        })
        .catch((e) => alive && hub.set(id, { detError: e.message || String(e) }))
        .finally(() => { busy = false; });
    }, 1000 / DETECTION.runsPerSecond);
    return () => { alive = false; clearInterval(t); onResult?.(id, null); };
  }, [detecting, stream, id, onResult]); // eslint-disable-line react-hooks/exhaustive-deps

  // Bearing to the server (combined with other laptops' cameras there). Only when heading + FOV are measured.
  function sendBearing(r) {
    const box = pickBox(r.dets), c = camRef.current;
    if (!box || c.heading == null || c.fov == null || Date.now() - lastBearing.current < LOGGING.bearingIntervalS * 1000) return;
    lastBearing.current = Date.now();
    api.saveBearing({ cameraId: c.id, bearing: pixelToBearing(box.cx, r.W, c.heading, c.fov), className: box.name, confidence: box.conf, fromSmoke: box.fromSmoke })
      .then(() => hub.set(id, { bearingErr: "" }))
      .catch((e) => hub.set(id, { bearingErr: e.message }));
  }

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
    if (!stream) return;
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
  }, [id, stream]);

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
