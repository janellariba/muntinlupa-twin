// auth.js: two shared passwords, set in Vercel environment variables.
//   ADMIN_PASSWORD  -> admin console (/admin): camera config, detection, recording, publishing streams.
//   VIEWER_PASSWORD -> live camera video on the twin page. (Admins can always watch.)
// After login the browser gets an HttpOnly cookie signed with a key derived from that password, valid
// SESSION_HOURS. Changing a password in Vercel logs out everyone who used it.
import crypto from "node:crypto";
import { HttpError } from "./http.js";

export const SESSION_HOURS = 12; // stay signed in for one working day
const ROLES = {
  admin: { cookie: "twin_admin", env: "ADMIN_PASSWORD" },
  viewer: { cookie: "twin_viewer", env: "VIEWER_PASSWORD" },
};

function key(role) {
  const pw = process.env[ROLES[role].env];
  if (!pw) throw new HttpError(500, `${ROLES[role].env} is not set in the Vercel environment variables.`);
  return crypto.createHash("sha256").update(`twin-${role}-cookie:${pw}`).digest();
}
const sign = (role, payload) => crypto.createHmac("sha256", key(role)).update(payload).digest("base64url");

export function passwordMatches(given, role = "admin") {
  const real = process.env[ROLES[role].env];
  const a = crypto.createHash("sha256").update(String(given ?? "")).digest();
  const b = crypto.createHash("sha256").update(real ?? "").digest();
  return Boolean(real) && crypto.timingSafeEqual(a, b); // constant-time compare
}

const secure = (req) => (req.headers["x-forwarded-proto"] || "").includes("https") ? "; Secure" : "";

export function sessionCookie(req, role = "admin") {
  const exp = Date.now() + SESSION_HOURS * 3600_000;
  const payload = `${role}.${exp}`;
  return `${ROLES[role].cookie}=${payload}.${sign(role, payload)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}${secure(req)}`;
}
export const clearCookie = (req, role = "admin") => `${ROLES[role].cookie}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure(req)}`;

function hasRole(req, role) {
  const m = (req.headers.cookie || "").match(new RegExp(`${ROLES[role].cookie}=([^;]+)`));
  if (!m) return false;
  const parts = m[1].split(".");
  if (parts.length !== 3) return false;
  const [who, exp, sig] = parts, payload = `${who}.${exp}`;
  if (who !== role) return false;
  let expected;
  try { expected = sign(role, payload); } catch { return false; }
  const ok = sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  return ok && Number(exp) > Date.now();
}

export const isAdmin = (req) => hasRole(req, "admin");
export const isViewer = (req) => hasRole(req, "viewer") || hasRole(req, "admin");

export function requireAdmin(req) {
  if (!isAdmin(req)) throw new HttpError(401, "Admin login required.");
}
export function requireViewer(req) {
  if (!isViewer(req)) throw new HttpError(401, "Viewer password required for live video.");
}
