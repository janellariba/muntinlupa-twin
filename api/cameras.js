// /api/cameras
//   GET                -> { cameras: [...] }           anyone (the twin page shows the marks)
//   POST   {camera}    -> { camera }                    admin: add
//   PUT    ?id= {camera} -> { camera }                  admin: edit
//   DELETE ?id=        -> { ok: true }                  admin: remove (its saved detections are kept)
// The admin console also checks that the point is inside Muntinlupa before saving.
import { handler, readJson, send, query, HttpError } from "./_lib/http.js";
import { requireAdmin } from "./_lib/auth.js";
import { q } from "./_lib/db.js";

const COLS = "id, name, lat, lon, cam_index, heading_deg, fov_deg, created_at, updated_at";
const out = (r) => ({ id: r.id, name: r.name, lat: r.lat, lon: r.lon, index: r.cam_index, heading: r.heading_deg, fov: r.fov_deg, updatedAt: r.updated_at });

function clean(b) {
  const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
  const c = { name: String(b.name ?? "").trim(), lat: num(b.lat), lon: num(b.lon), index: num(b.index), heading: num(b.heading), fov: num(b.fov) };
  if (!c.name || c.name.length > 40) throw new HttpError(400, "Name must be 1 to 40 characters.");
  if (!Number.isFinite(c.lat) || c.lat < -90 || c.lat > 90) throw new HttpError(400, "Latitude must be between -90 and 90.");
  if (!Number.isFinite(c.lon) || c.lon < -180 || c.lon > 180) throw new HttpError(400, "Longitude must be between -180 and 180.");
  if (!Number.isInteger(c.index) || c.index < 0 || c.index > 15) throw new HttpError(400, "Camera index must be a whole number from 0 to 15.");
  if (c.heading !== null && !(c.heading >= 0 && c.heading < 360)) throw new HttpError(400, "Heading must be from 0 to less than 360, or empty.");
  if (c.fov !== null && !(c.fov > 0 && c.fov <= 180)) throw new HttpError(400, "Field of view must be more than 0 and at most 180, or empty.");
  return c;
}

export default handler({
  GET: async (req, res) => {
    const { rows } = await q(`select ${COLS} from twin_cameras order by created_at`);
    send(res, 200, { cameras: rows.map(out) });
  },
  POST: async (req, res) => {
    requireAdmin(req);
    const c = clean(await readJson(req, 10_000));
    const { rows } = await q(
      `insert into twin_cameras (name, lat, lon, cam_index, heading_deg, fov_deg) values ($1,$2,$3,$4,$5,$6) returning ${COLS}`,
      [c.name, c.lat, c.lon, c.index, c.heading, c.fov]);
    send(res, 201, { camera: out(rows[0]) });
  },
  PUT: async (req, res) => {
    requireAdmin(req);
    const { id } = query(req);
    const c = clean(await readJson(req, 10_000));
    const { rows } = await q(
      `update twin_cameras set name=$2, lat=$3, lon=$4, cam_index=$5, heading_deg=$6, fov_deg=$7, updated_at=now() where id=$1 returning ${COLS}`,
      [id, c.name, c.lat, c.lon, c.index, c.heading, c.fov]);
    if (!rows.length) throw new HttpError(404, "Camera not found. It may have been removed on another device.");
    send(res, 200, { camera: out(rows[0]) });
  },
  DELETE: async (req, res) => {
    requireAdmin(req);
    const { id } = query(req);
    await q("delete from twin_cameras where id=$1", [id]);
    send(res, 200, { ok: true });
  },
});
