import { Hono } from "hono";
import { apiKeyAuth } from "../../auth/middleware";
import { listActiveEnvironmentsResponse } from "../../services/environment";

const app = new Hono();

/** GET /web/environments — List active environments */
app.get("/environments", apiKeyAuth, async (c) => {
  const envs = listActiveEnvironmentsResponse();
  return c.json(envs, 200);
});

export default app;
