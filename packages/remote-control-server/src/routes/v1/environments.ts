import { Hono } from "hono";
import { registerEnvironment, deregisterEnvironment, reconnectEnvironment, updatePollTime } from "../../services/environment";
import { apiKeyAuth, acceptCliHeaders } from "../../auth/middleware";

const app = new Hono();

/** POST /v1/environments/bridge — Register an environment */
app.post("/bridge", acceptCliHeaders, apiKeyAuth, async (c) => {
  const body = await c.req.json();
  const result = registerEnvironment(body);
  return c.json(result, 200);
});

/** DELETE /v1/environments/bridge/:id — Deregister */
app.delete("/bridge/:id", acceptCliHeaders, apiKeyAuth, async (c) => {
  const envId = c.req.param("id");
  deregisterEnvironment(envId);
  return c.json({ status: "ok" }, 200);
});

/** POST /v1/environments/:id/bridge/reconnect — Reconnect */
app.post("/:id/bridge/reconnect", acceptCliHeaders, apiKeyAuth, async (c) => {
  const envId = c.req.param("id");
  reconnectEnvironment(envId);
  const { reconnectWorkForEnvironment } = await import("../../services/work-dispatch");
  await reconnectWorkForEnvironment(envId);
  return c.json({ status: "ok" }, 200);
});

export default app;
