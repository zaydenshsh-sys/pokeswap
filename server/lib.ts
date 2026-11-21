import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { eq, and, gt } from "drizzle-orm";
import { db } from "../db/index.js";
import { users, sessions, settings, auditLog, notifications } from "../db/schema.js";

export type User = typeof users.$inferSelect;

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export function fail(status: number, message: string): never {
  throw new HttpError(status, message);
}

// ---------- passwords ----------
export function hashPassword(pw: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pw, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}
export function verifyPassword(pw: string, stored: string) {
  const [, salt, hash] = stored.split("$");
  if (!salt || !hash) return false;
  const test = scryptSync(pw, salt, 64);
  const real = Buffer.from(hash, "hex");
  return real.length === test.length && timingSafeEqual(real, test);
}
export function sha(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
export function safeEqual(a: string, b: string) {
  return timingSafeEqual(Buffer.from(sha(a)), Buffer.from(sha(b)));
}

// ---------- settings ----------
export const DEFAULT_SETTINGS: Record<string, string> = {
  siteName: "PokéSwap Club",
  tagline: "Trade, buy & sell Pokémon and snacks with the crew. Deals happen at school.",
  welcomeMessage: "Welcome to the club! Be cool, be fair, no scams.",
  signupsOpen: "true",
  pokemonMarketOpen: "true",
  snackMarketOpen: "true",
  chatOpen: "true",
  meetSpots: JSON.stringify(["Lunch tables", "Library", "Front steps", "Bus line", "Gym bleachers", "Homeroom"]),
  maxPriceCents: "10000",
};
let settingsCache: { at: number; data: Record<string, string> } | null = null;

export async function getSettings() {
  if (settingsCache && Date.now() - settingsCache.at < 5000) return settingsCache.data;
  const rows = await db.select().from(settings);
  const data = { ...DEFAULT_SETTINGS };
  for (const r of rows) data[r.key] = r.value;
  settingsCache = { at: Date.now(), data };
  return data;
}
export async function setSetting(key: string, value: string) {
  await db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
  settingsCache = null;
}
export async function publicSettings() {
  const s = await getSettings();
  let meetSpots: string[] = [];
  try {
    meetSpots = JSON.parse(s.meetSpots || "[]");
  } catch {}
  return {
    siteName: s.siteName,
    tagline: s.tagline,
    welcomeMessage: s.welcomeMessage,
    signupsOpen: s.signupsOpen === "true",
    pokemonMarketOpen: s.pokemonMarketOpen === "true",
    snackMarketOpen: s.snackMarketOpen === "true",
    chatOpen: s.chatOpen === "true",
    meetSpots,
    maxPriceCents: Number(s.maxPriceCents) || 10000,
  };
}
export async function checkAdminCode(code: string) {
  const s = await getSettings();
  if (s.adminCodeHash) return safeEqual(sha(code.trim()), s.adminCodeHash);
  return safeEqual(code.trim(), process.env.ADMIN_CODE || "bulba");
}

// ---------- sessions ----------
const COOKIE = "psid";
const SESSION_DAYS = 30;

export async function createSession(res: Response, userId: number) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5);
  await db.insert(sessions).values({ token: sha(token), userId, expiresAt });
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${process.env.NETLIFY_DEV ? "" : "; Secure"}`
  );
}
export function clearCookie(res: Response) {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}
export function readToken(cookieHeader?: string) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return v.join("=") || null;
  }
  return null;
}
export async function userFromCookie(cookieHeader?: string): Promise<User | null> {
  const token = readToken(cookieHeader);
  if (!token) return null;
  const rows = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.token, sha(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const user = rows[0]?.user;
  if (!user || user.banned) return null;
  return user;
}
export async function destroySession(cookieHeader?: string) {
  const token = readToken(cookieHeader);
  if (token) await db.delete(sessions).where(eq(sessions.token, sha(token)));
}

declare global {
  namespace Express {
    interface Request {
      user?: User | null;
    }
  }
}

const seenAt = new Map<number, number>();
export async function attachUser(req: Request, _res: Response, next: NextFunction) {
  req.user = await userFromCookie(req.headers.cookie);
  if (req.user) {
    const last = seenAt.get(req.user.id) || 0;
    if (Date.now() - last > 60_000) {
      seenAt.set(req.user.id, Date.now());
      await db.update(users).set({ lastSeen: new Date() }).where(eq(users.id, req.user.id));
    }
  }
  next();
}
export function requireUser(req: Request): User {
  if (!req.user) fail(401, "Please log in first.");
  return req.user;
}
export function requireAdmin(req: Request): User {
  const u = requireUser(req);
  if (!u.isAdmin) fail(403, "Admins only. Unlock the admin panel with the admin code.");
  return u;
}

export function publicUser(u: User) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    isAdmin: u.isAdmin,
    avatarDex: u.avatarDex,
    favoriteType: u.favoriteType,
    bio: u.bio,
    banned: u.banned,
    mutedUntil: u.mutedUntil,
    createdAt: u.createdAt,
    lastSeen: u.lastSeen,
  };
}

export async function audit(actorId: number | null, action: string, detail = "") {
  await db.insert(auditLog).values({ actorId, action, detail });
}
export async function notify(userId: number, body: string, link = "") {
  await db.insert(notifications).values({ userId, body, link });
}

// ---------- validation ----------
export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
export function cleanUsername(v: unknown) {
  const u = String(v ?? "").trim().toLowerCase();
  if (!USERNAME_RE.test(u)) fail(400, "Username must be 3–20 characters: letters, numbers or underscores.");
  return u;
}
export function cleanPassword(v: unknown) {
  const p = String(v ?? "");
  if (p.length < 4 || p.length > 100) fail(400, "Password must be at least 4 characters.");
  return p;
}
export function str(v: unknown, max: number, fallback = "") {
  if (v === undefined || v === null) return fallback;
  return String(v).trim().slice(0, max);
}
export function cents(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 0) fail(400, "Price must be a positive number.");
  return n;
}
export function intOr(v: unknown, fallback: number) {
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : fallback;
}
