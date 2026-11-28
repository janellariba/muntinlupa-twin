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
      send(res, 500, { error: "Server error. Check the Vercel function logs." });
    }
  };
}
