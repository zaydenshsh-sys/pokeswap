import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { userFromCookie, type User } from "./lib.js";

type Client = { ws: WebSocket; user: User; alive: boolean };
const clients = new Set<Client>();

function send(ws: WebSocket, data: unknown) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

export function broadcast(data: unknown) {
  const json = JSON.stringify(data);
  for (const c of clients) if (c.ws.readyState === WebSocket.OPEN) c.ws.send(json);
}
export function sendToUser(userId: number, data: unknown) {
  for (const c of clients) if (c.user.id === userId) send(c.ws, data);
}
export function kickUser(userId: number, reason: string) {
  for (const c of clients)
    if (c.user.id === userId) {
      send(c.ws, { type: "kicked", reason });
      c.ws.close();
    }
}
export function onlineUsers() {
  const seen = new Map<number, { id: number; username: string; displayName: string; isAdmin: boolean; avatarDex: number }>();
  for (const c of clients)
    seen.set(c.user.id, {
      id: c.user.id,
      username: c.user.username,
      displayName: c.user.displayName,
      isAdmin: c.user.isAdmin,
      avatarDex: c.user.avatarDex,
    });
  return [...seen.values()];
}
export function refreshUser(user: User) {
  for (const c of clients) if (c.user.id === user.id) c.user = user;
  broadcastPresence();
}
function broadcastPresence() {
  broadcast({ type: "presence", online: onlineUsers() });
}

let heartbeat: NodeJS.Timeout | null = null;

export function attachRealtime(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (req, socket, head) => {
    if (!req.url?.startsWith("/ws")) return socket.destroy();
    const user = await userFromCookie(req.headers.cookie).catch(() => null);
    if (!user) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const client: Client = { ws, user, alive: true };
      clients.add(client);
      send(ws, { type: "hello", online: onlineUsers() });
      broadcastPresence();

      ws.on("pong", () => (client.alive = true));
      ws.on("message", (raw) => {
        let msg: any;
        try {
          msg = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (msg?.type === "typing" && typeof msg.channel === "string") {
          const json = JSON.stringify({
            type: "typing",
            channel: msg.channel.slice(0, 40),
            user: { id: client.user.id, displayName: client.user.displayName },
          });
          for (const c of clients) if (c !== client && c.ws.readyState === WebSocket.OPEN) c.ws.send(json);
        }
        if (msg?.type === "ping") send(ws, { type: "pong" });
      });
      ws.on("close", () => {
        clients.delete(client);
        broadcastPresence();
      });
      ws.on("error", () => ws.close());

      // Keep connections healthy while sockets are open. Stops when nobody is connected.
      if (!heartbeat) {
        heartbeat = setInterval(() => {
          for (const c of clients) {
            if (!c.alive) {
              c.ws.terminate();
              clients.delete(c);
              continue;
            }
            c.alive = false;
            c.ws.ping();
          }
          if (clients.size === 0 && heartbeat) {
            clearInterval(heartbeat);
            heartbeat = null;
          }
        }, 30_000);
      }
    });
  });

  return wss;
}
