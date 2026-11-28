// /api/recordings  (admin only)
//   GET  -> { recordings: [...] }  the latest 50 entries of the recording log
//   POST { cameraId, fileName, startedAt, endedAt, durationS, sizeBytes } -> log one recording
// The video files are saved on the admin laptop; only this log is stored in the database.
import { handler, readJson, send, HttpError } from "./_lib/http.js";
import { requireAdmin } from "./_lib/auth.js";
import { q } from "./_lib/db.js";

export default handler({
  GET: async (req, res) => {
    requireAdmin(req);
    const { rows } = await q(
      "select id, camera_id, camera_name, file_name, started_at, ended_at, duration_s, size_bytes, saved_on from twin_recordings order by started_at desc limit 50");
    send(res, 200, { recordings: rows.map((r) => ({
      id: r.id, cameraId: r.camera_id, cameraName: r.camera_name, fileName: r.file_name, startedAt: r.started_at,
      endedAt: r.ended_at, durationS: r.duration_s, sizeBytes: r.size_bytes === null ? null : Number(r.size_bytes), savedOn: r.saved_on,
    })) });
  },
  POST: async (req, res) => {
    requireAdmin(req);
    const b = await readJson(req, 10_000);
    const cam = (await q("select id, name from twin_cameras where id=$1", [b.cameraId])).rows[0];
    if (!cam) throw new HttpError(404, "Camera not found.");
    const started = new Date(b.startedAt), ended = new Date(b.endedAt);
    if (isNaN(started) || isNaN(ended) || ended < started) throw new HttpError(400, "Invalid start or end time.");
    const fileName = String(b.fileName ?? "").slice(0, 200);
    if (!fileName) throw new HttpError(400, "File name is required.");
    const { rows } = await q(
      `insert into twin_recordings (camera_id, camera_name, file_name, started_at, ended_at, duration_s, size_bytes)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [cam.id, cam.name, fileName, started, ended, Number(b.durationS) || (ended - started) / 1000, Number.isFinite(Number(b.sizeBytes)) ? Number(b.sizeBytes) : null]);
    send(res, 201, { id: rows[0].id });
  },
});
