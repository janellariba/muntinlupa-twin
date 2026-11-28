// http.js: small helpers shared by the API functions (plain Node request/response, no framework).
// Files in api/_lib are not deployed as endpoints (Vercel skips names starting with "_").

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

/** Read a JSON body (max `limit` bytes). Vercel may already have parsed it into req.body. */
export async function readJson(req, limit = 4_000_000) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  const chunks = []; let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, "Request too large.");
    chunks.push(c);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new HttpError(400, "Body is not valid JSON."); }
}

export function query(req) {
  return Object.fromEntries(new URL(req.url, "http://x").searchParams);
}

/** Wrap a handler: turns thrown errors into JSON responses and hides internal details. */
export function handler(methods) {
  return async (req, res) => {
    const fn = methods[req.method];
    if (!fn) return send(res, 405, { error: `Method ${req.method} not allowed.` }, { Allow: Object.keys(methods).join(", ") });
    try { await fn(req, res); }
    catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      if (e?.code === "23505") return send(res, 409, { error: "That name is already used by another camera." }); // unique violation
      if (e?.code === "23514") return send(res, 400, { error: "A value is out of range." });                     // check violation
      console.error(e);
      send(res, 500, { error: explain(e) });
    }
  };
}

/** A readable cause for common setup problems. Never includes passwords, keys or the connection string. */
export function explain(e) {
  const code = e?.code, msg = String(e?.message || "");
  if (code === "42703") return "Database is missing new columns: run the updated db/schema.sql again in the Supabase SQL Editor.";
  if (code === "42P01" || code === "3F000") return "Database tables are missing: run db/schema.sql in the Supabase SQL Editor.";
  if (code === "28P01" || code === "28000" || /password authentication failed/i.test(msg)) return "Database password is wrong: check the password inside DATABASE_URL (no [ ] brackets).";
  if (/tenant or user not found/i.test(msg)) return "DATABASE_URL user or host is wrong: copy the Shared pooler string from Supabase Connect again.";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "DATABASE_URL host not found: copy the Shared pooler string from Supabase Connect again.";
  if (code === "ECONNREFUSED" || code === "ETIMEDOUT" || /timeout/i.test(msg)) return "Cannot reach the database: use the Shared pooler string (port 6543), and check the Supabase project is not paused.";
  if (/certificate|SSL|TLS/i.test(msg)) return "Database TLS error: remove any ?sslmode=... from the end of DATABASE_URL.";
  if (e instanceof URIError || /invalid url|uri malformed|invalid connection/i.test(msg) || code === "ERR_INVALID_URL")
    return "DATABASE_URL is not a valid address: a password with symbols (@ # / ? : %) breaks it. Reset the database password to letters and numbers only.";
  if (code === "42501") return "Database permission denied: DATABASE_URL must use the postgres user from the Shared pooler string.";
  return `Server error${code ? ` (code ${code})` : ""}. Open /api/health for a setup check.`;
}
