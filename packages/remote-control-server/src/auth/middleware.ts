import type { Context, Next } from "hono";
import { validateApiKey } from "./api-key";
import { verifyWorkerJwt } from "./jwt";

/** Extract Bearer token from Authorization header or ?token= query param */
function extractBearerToken(c: Context): string | undefined {
  const authHeader = c.req.header("Authorization");
  const queryToken = c.req.query("token");
  return authHeader?.replace("Bearer ", "") || queryToken;
}

/** Bearer API Key authentication — the only auth method */
export async function apiKeyAuth(c: Context, next: Next) {
  const token = extractBearerToken(c);

  if (!validateApiKey(token)) {
    return c.json({ error: { type: "unauthorized", message: "Invalid or missing API key" } }, 401);
  }
  await next();
}

/**
 * Session ingress authentication — accepts both API key and worker JWT.
 *
 * Used for SSE stream, CCR worker events, and WebSocket ingress endpoints.
 * On JWT validation, stores the decoded payload in c.set("jwtPayload") for
 * downstream handlers to inspect session_id if needed.
 */
export async function sessionIngressAuth(c: Context, next: Next) {
  const token = extractBearerToken(c);

  if (!token) {
    return c.json({ error: { type: "unauthorized", message: "Missing auth token" } }, 401);
  }

  // Try API key first (backward compatible)
  if (validateApiKey(token)) {
    await next();
    return;
  }

  // Try JWT verification — validate session_id matches route param
  const payload = verifyWorkerJwt(token);
  if (payload) {
    const routeSessionId = c.req.param("id") || c.req.param("sessionId");
    if (routeSessionId && payload.session_id !== routeSessionId) {
      return c.json({ error: { type: "forbidden", message: "JWT session_id does not match target session" } }, 403);
    }
    c.set("jwtPayload", payload);
    await next();
    return;
  }

  return c.json({ error: { type: "unauthorized", message: "Invalid API key or JWT" } }, 401);
}

/** Accept CLI headers but don't validate them */
export async function acceptCliHeaders(c: Context, next: Next) {
  await next();
}
