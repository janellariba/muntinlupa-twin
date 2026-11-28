// api.js: the browser side of the /api functions. Errors carry the server's readable message.
async function call(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Cannot reach the server. Check the internet connection.");
  }
  let json = {};
  try { json = await res.json(); } catch { /* empty or non-JSON reply */ }
  if (!res.ok) {
    const e = new Error(json.error || `Server error (HTTP ${res.status}).`);
    e.status = res.status;
    throw e;
  }
  return json;
}
const enc = encodeURIComponent;

export const api = {
  status: () => call("GET", "/api/events"),                  // cameras + latest snapshots + latest estimate
  session: () => call("GET", "/api/auth"),
  login: (password) => call("POST", "/api/auth", { password }),
  logout: () => call("DELETE", "/api/auth"),
  addCamera: (c) => call("POST", "/api/cameras", c),
  updateCamera: (id, c) => call("PUT", `/api/cameras?id=${enc(id)}`, c),
  removeCamera: (id) => call("DELETE", `/api/cameras?id=${enc(id)}`),
  saveDetection: (d) => call("POST", "/api/events", { type: "detection", ...d }),
  saveEstimate: (e) => call("POST", "/api/events", { type: "estimate", ...e }),
  recordings: () => call("GET", "/api/recordings"),
  logRecording: (r) => call("POST", "/api/recordings", r),
};
