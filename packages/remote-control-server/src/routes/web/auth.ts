import { Hono } from "hono";
import { validateApiKey } from "../../auth/api-key";

const app = new Hono();

/** POST /web/auth/login — Verify API key, return it as token */
app.post("/auth/login", async (c) => {
  const body = await c.req.json();
  const apiKey = body.apiKey;

  if (!apiKey || !validateApiKey(apiKey)) {
    return c.json({ error: { type: "unauthorized", message: "Invalid API key" } }, 401);
  }

  return c.json({
    token: apiKey,
    expires_in: 86400,
  }, 200);
});

export default app;
