// /api/health: setup check you can open in a browser. Shows which parts work, never the secret values.
import { send, explain } from "./_lib/http.js";
import { q } from "./_lib/db.js";
import { createClient } from "@supabase/supabase-js";

export default async function health(req, res) {
  const env = Object.fromEntries(["DATABASE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ADMIN_PASSWORD", "VIEWER_PASSWORD", "CF_REALTIME_APP_ID", "CF_REALTIME_APP_SECRET"]
    .map((k) => [k, process.env[k] ? "set" : "MISSING"]));
  const out = { env, database: "not checked", tables: "not checked", storage: "not checked" };
  try {
    await q("select 1");
    out.database = "OK";
    const { rows } = await q("select table_name from information_schema.tables where table_schema='public' and table_name like 'twin_%'");
    const need = ["twin_cameras", "twin_detections", "twin_fire_estimates", "twin_recordings"];
    const missing = need.filter((t) => !rows.some((r) => r.table_name === t));
    const cols = (await q("select 1 from information_schema.columns where table_name='twin_cameras' and column_name='device_name'")).rowCount;
    out.tables = missing.length ? `MISSING ${missing.join(", ")}: run db/schema.sql in the Supabase SQL Editor`
      : !cols ? "OLD: run the updated db/schema.sql again (live video columns)" : "OK";
  } catch (e) { out.database = `FAILED: ${explain(e)}`; }
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing");
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { error } = await sb.storage.from("twin-snapshots").list("", { limit: 1 });
    out.storage = error ? `FAILED: ${error.message}${/not found/i.test(error.message) ? " (run db/schema.sql, it creates the bucket)" : ""}` : "OK";
  } catch (e) { out.storage = `FAILED: ${e.message}`; }
  out.allOk = out.database === "OK" && out.tables === "OK" && out.storage === "OK" && !Object.values(env).includes("MISSING");
  send(res, 200, out);
}
