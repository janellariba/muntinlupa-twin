// /api/auth
//   GET    -> { admin, viewer }   is this browser signed in (admin console / live video)?
//   POST   { password, as: "admin" | "viewer" } -> sign in (sets an HttpOnly session cookie)
//   DELETE ?as=viewer|admin -> sign out
import { handler, readJson, send, query } from "./_lib/http.js";
import { passwordMatches, sessionCookie, clearCookie, isAdmin, isViewer } from "./_lib/auth.js";

const roleOf = (v) => (v === "viewer" ? "viewer" : "admin");

export default handler({
  GET: async (req, res) => send(res, 200, { admin: isAdmin(req), viewer: isViewer(req) }),
  POST: async (req, res) => {
    const b = await readJson(req, 10_000);
    const role = roleOf(b.as);
    if (!passwordMatches(b.password, role)) {
      await new Promise((r) => setTimeout(r, 1000)); // slow down password guessing
      return send(res, 401, { error: "Wrong password." });
    }
    send(res, 200, { [role]: true }, { "Set-Cookie": sessionCookie(req, role) });
  },
  DELETE: async (req, res) => {
    const role = roleOf(query(req).as);
    send(res, 200, { [role]: false }, { "Set-Cookie": clearCookie(req, role) });
  },
});
