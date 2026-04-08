/**
 * Remote Control — SSE Connection Manager
 */
import { isLoggedIn } from "./api.js";

let currentEventSource = null;
let currentSSESessionId = null;
let onEventCallback = null;

export function connectSSE(sessionId, onEvent) {
  disconnectSSE();
  currentSSESessionId = sessionId;
  onEventCallback = onEvent;

  const token = isLoggedIn() ? localStorage.getItem("rcs_token") : "";
  const url = `/web/sessions/${sessionId}/events?token=${encodeURIComponent(token)}`;
  const es = new EventSource(url);
  currentEventSource = es;

  es.addEventListener("message", (e) => {
    try {
      const data = JSON.parse(e.data);
      onEventCallback?.(data);
    } catch {
      // ignore parse errors
    }
  });

  es.addEventListener("error", () => {
    // EventSource auto-reconnects
  });
}

export function disconnectSSE() {
  if (currentEventSource) {
    currentEventSource.close();
    currentEventSource = null;
    currentSSESessionId = null;
  }
}

export function getCurrentSSESessionId() {
  return currentSSESessionId;
}
