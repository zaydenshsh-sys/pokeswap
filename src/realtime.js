// WebSocket client with automatic reconnection + backoff.
const listeners = new Set();
let ws = null;
let attempt = 0;
let stopped = true;
let timer = null;
let status = "offline";
const statusListeners = new Set();

function setStatus(s) {
  status = s;
  statusListeners.forEach((fn) => fn(s));
}

function connect() {
  if (stopped) return;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  setStatus("connecting");
  ws.onopen = () => {
    attempt = 0;
    setStatus("live");
    listeners.forEach((fn) => fn({ type: "reconnected" }));
  };
  ws.onmessage = (e) => {
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    listeners.forEach((fn) => fn(msg));
  };
  ws.onclose = () => {
    ws = null;
    setStatus("offline");
    if (stopped) return;
    const delay = Math.min(15000, 500 * 2 ** attempt++) + Math.random() * 400;
    timer = setTimeout(connect, delay);
  };
  ws.onerror = () => ws?.close();
}

export function startRealtime() {
  if (!stopped) return;
  stopped = false;
  connect();
}
export function stopRealtime() {
  stopped = true;
  clearTimeout(timer);
  ws?.close();
}
export function onRealtime(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function onStatus(fn) {
  statusListeners.add(fn);
  fn(status);
  return () => statusListeners.delete(fn);
}
export function sendRealtime(data) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}
