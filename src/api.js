export async function api(path, { method = "GET", body, raw } = {}) {
  const opts = { method, headers: {}, credentials: "same-origin" };
  if (raw) {
    opts.body = raw;
    opts.headers["Content-Type"] = raw.type;
  } else if (body !== undefined) {
    opts.body = JSON.stringify(body);
    opts.headers["Content-Type"] = "application/json";
  }
  const res = await fetch(path, opts);
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const money = (c) => (c === null || c === undefined ? null : `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`);

export const sprite = (dex) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${dex}.png`;
export const artwork = (dex) =>
  `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${dex}.png`;
export const imageUrl = (key) => `/api/images/${key}`;

export function timeAgo(d) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(d).toLocaleDateString();
}

export function todayISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  const target = new Date(y, m - 1, d);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((target - now) / 864e5);
}

export function expiryLabel(dateStr) {
  const n = daysUntil(dateStr);
  if (n === null) return null;
  if (n < 0) return { text: `Expired ${-n}d ago`, tone: "dead" };
  if (n === 0) return { text: "Expires today!", tone: "hot" };
  if (n === 1) return { text: "Expires tomorrow", tone: "hot" };
  if (n <= 3) return { text: `Expires in ${n} days`, tone: "warm" };
  return { text: `Good till ${new Date(dateStr + "T00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}`, tone: "fresh" };
}

// Resize an image client-side so uploads stay small.
export async function shrinkImage(file, max = 1000) {
  if (file.type === "image/gif") return file;
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((r) => canvas.toBlob((b) => r(b), "image/jpeg", 0.82));
}

let speciesPromise = null;
export function loadSpecies() {
  if (speciesPromise) return speciesPromise;
  speciesPromise = (async () => {
    const cached = localStorage.getItem("species-v1");
    if (cached) return JSON.parse(cached);
    const res = await fetch("https://pokeapi.co/api/v2/pokemon-species?limit=1025");
    const data = await res.json();
    const list = data.results.map((r) => ({
      id: Number(r.url.split("/").filter(Boolean).pop()),
      name: r.name.replace(/-/g, " "),
    }));
    localStorage.setItem("species-v1", JSON.stringify(list));
    return list;
  })().catch(() => {
    speciesPromise = null;
    return [];
  });
  return speciesPromise;
}
