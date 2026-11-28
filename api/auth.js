// /api/auth
//   GET    -> { admin: true|false }   is this browser signed in to the admin console?
//   POST   { password } -> sign in (sets the HttpOnly session cookie)
//   DELETE -> sign out
import { handler, readJson, send } from "./_lib/http.js";
import { passwordMatches, sessionCookie, clearCookie, isAdmin } from "./_lib/auth.js";

export default handler({
  GET: async (req, res) => send(res, 200, { admin: isAdmin(req) }),
  POST: async (req, res) => {
    const { password } = await readJson(req, 10_000);
    if (!passwordMatches(password)) {
      await new Promise((r) => setTimeout(r, 1000)); // slow down password guessing
      return send(res, 401, { error: "Wrong password." });
    }
    send(res, 200, { admin: true }, { "Set-Cookie": sessionCookie(req) });
  },
  DELETE: async (req, res) => send(res, 200, { admin: false }, { "Set-Cookie": clearCookie(req) }),
});
