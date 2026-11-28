// storage.js: snapshot pictures in the private Supabase Storage bucket "twin-snapshots".
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (server-side only; never sent to browsers).
import { createClient } from "@supabase/supabase-js";
import { HttpError } from "./http.js";

export const BUCKET = "twin-snapshots";
const SIGNED_URL_S = 3600; // links to pictures work for 1 hour, then the page asks for fresh ones
let client = null;

function sb() {
  if (!client) {
    const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new HttpError(500, "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the Vercel environment variables.");
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return client;
}

export async function uploadJpeg(path, buffer, upsert = false) {
  const { error } = await sb().storage.from(BUCKET).upload(path, buffer, { contentType: "image/jpeg", upsert });
  if (error) throw new HttpError(502, `Could not save the snapshot: ${error.message}`);
  return path;
}

/** { path: signedUrl } for the given paths (one request). Missing pictures are left out. */
export async function signedUrls(paths) {
  const list = [...new Set(paths.filter(Boolean))];
  if (!list.length) return {};
  const { data, error } = await sb().storage.from(BUCKET).createSignedUrls(list, SIGNED_URL_S);
  if (error) { console.error("signed urls:", error.message); return {}; }
  return Object.fromEntries((data || []).filter((d) => d.signedUrl && !d.error).map((d) => [d.path, d.signedUrl]));
}
