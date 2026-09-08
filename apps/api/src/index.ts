import "./loadEnv.js";
import { serve } from "@hono/node-server";
import { app } from "./app.js";

const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`RadiOn2 API listening on http://localhost:${info.port}`);
});
