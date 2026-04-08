/**
 * Remote Control — API Client (UUID-based auth)
 */

const BASE = ""; // same origin

export function getUuid() {
  let uuid = localStorage.getItem("rcs_uuid");
  if (!uuid) {
    uuid = crypto.randomUUID();
    localStorage.setItem("rcs_uuid", uuid);
  }
  return uuid;
}

export function setUuid(uuid) {
  localStorage.setItem("rcs_uuid", uuid);
}

async function api(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  const uuid = getUuid();

  // Append uuid as query param for auth
  const sep = path.includes("?") ? "&" : "?";
  const url = `${BASE}${path}${sep}uuid=${encodeURIComponent(uuid)}`;

  const opts = { method, headers };
  if (body !== undefined) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const data = await res.json();

  if (!res.ok) {
    const err = data.error || { type: "unknown", message: res.statusText };
    throw new Error(err.message || err.type);
  }
  return data;
}

export function apiBind(sessionId) {
  return api("POST", "/web/bind", { sessionId });
}

export function apiFetchSessions() {
  return api("GET", "/web/sessions");
}

export function apiFetchAllSessions() {
  return api("GET", "/web/sessions/all");
}

export function apiFetchSession(id) {
  return api("GET", `/web/sessions/${id}`);
}

export function apiFetchSessionHistory(id) {
  return api("GET", `/web/sessions/${id}/history`);
}

export function apiFetchEnvironments() {
  return api("GET", "/web/environments");
}

export function apiSendEvent(sessionId, body) {
  return api("POST", `/web/sessions/${sessionId}/events`, body);
}

export function apiSendControl(sessionId, body) {
  return api("POST", `/web/sessions/${sessionId}/control`, body);
}

export function apiInterrupt(sessionId) {
  return api("POST", `/web/sessions/${sessionId}/interrupt`);
}

export function apiCreateSession(body) {
  return api("POST", "/web/sessions", body);
}
