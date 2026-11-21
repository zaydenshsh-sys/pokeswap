import { createServer } from "node:http";
import { app } from "../../server/app.js";
import { attachRealtime } from "../../server/realtime.js";

const server = createServer(app);
attachRealtime(server);

export const config = {
  path: ["/api/*", "/ws"],
};

export default server;
