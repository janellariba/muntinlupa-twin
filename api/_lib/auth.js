// auth.js: one shared admin password (ADMIN_PASSWORD env var).
// After login the browser gets an HttpOnly cookie signed with a key derived from the password, valid
// SESSION_HOURS. Changing ADMIN_PASSWORD in Vercel logs everyone out.
import crypto from "node:crypto";
import { HttpError } from "./http.js";

const COOKIE = "twin_admin";
export const SESSION_HOURS = 12; // admin stays signed in for one working day

function key() {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) throw new HttpError(500, "ADMIN_PASSWORD is not set in the Vercel environment variables.");
  return crypto.createHash("sha256").update(`twin-admin-cookie:${pw}`).digest();
}
const sign = (payload) => crypto.createHmac("sha256", key()).update(payload).digest("base64url");

export function passwordMatches(given) {
  const a = crypto.createHash("sha256").update(String(given ?? "")).digest();
  const b = crypto.createHash("sha256").update(process.env.ADMIN_PASSWORD ?? "").digest();
  return Boolean(process.env.ADMIN_PASSWORD) && crypto.timingSafeEqual(a, b); // constant-time compare
}

const secure = (req) => (req.headers["x-forwarded-proto"] || "").includes("https") ? "; Secure" : "";

export function sessionCookie(req) {
  const exp = Date.now() + SESSION_HOURS * 3600_000;
  const payload = `admin.${exp}`;
  return `${COOKIE}=${payload}.${sign(payload)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}${secure(req)}`;
}
export const clearCookie = (req) => `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure(req)}`;

export function isAdmin(req) {
  const m = (req.headers.cookie || "").match(new RegExp(`${COOKIE}=([^;]+)`));
  if (!m) return false;
  const parts = m[1].split(".");
  if (parts.length !== 3) return false;
  const [who, exp, sig] = parts, payload = `${who}.${exp}`;
  let expected;
  try { expected = sign(payload); } catch { return false; }
  const ok = sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  return ok && Number(exp) > Date.now();
}

export function requireAdmin(req) {
  if (!isAdmin(req)) throw new HttpError(401, "Admin login required.");
}
