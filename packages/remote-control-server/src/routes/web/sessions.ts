import { Hono } from "hono";
import { apiKeyAuth } from "../../auth/middleware";
import { listSessionSummaries, getSession, createSession } from "../../services/session";
import { createWorkItem } from "../../services/work-dispatch";
import { createSSEStream } from "../../transport/sse-writer";

const app = new Hono();

/** POST /web/sessions — Create a session from web UI */
app.post("/sessions", apiKeyAuth, async (c) => {
  const body = await c.req.json();
  const session = createSession({
    environment_id: body.environment_id || null,
    title: body.title || "New Session",
    source: "web",
    permission_mode: body.permission_mode || "default",
  });

  // Dispatch work to environment if specified
  if (body.environment_id) {
    await createWorkItem(body.environment_id, session.id);
  }

  return c.json(session, 200);
});

/** GET /web/sessions — List all sessions (summary only) */
app.get("/sessions", apiKeyAuth, async (c) => {
  const sessions = listSessionSummaries();
  return c.json(sessions, 200);
});

/** GET /web/sessions/:id — Session detail */
app.get("/sessions/:id", apiKeyAuth, async (c) => {
  const session = getSession(c.req.param("id"));
  if (!session) {
    return c.json({ error: { type: "not_found", message: "Session not found" } }, 404);
  }
  return c.json(session, 200);
});

/** SSE /web/sessions/:id/events — Real-time event stream */
app.get("/sessions/:id/events", apiKeyAuth, async (c) => {
  const sessionId = c.req.param("id");
  const session = getSession(sessionId);
  if (!session) {
    return c.json({ error: { type: "not_found", message: "Session not found" } }, 404);
  }

  const lastEventId = c.req.header("Last-Event-ID");
  const fromSeqNum = lastEventId ? parseInt(lastEventId) : 0;
  return createSSEStream(c, sessionId, fromSeqNum);
});

export default app;
