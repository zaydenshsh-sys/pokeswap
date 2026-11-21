import express from "express";
import type { Request, Response, NextFunction } from "express";
import { randomBytes } from "node:crypto";
import { and, asc, count, desc, eq, gte, ilike, isNull, lt, ne, or, sql, inArray } from "drizzle-orm";
import { getStore } from "@netlify/blobs";
import { db } from "../db/index.js";
import {
  users,
  sessions,
  listings,
  offers,
  favorites,
  reviews,
  channels,
  messages,
  reports,
  announcements,
  notifications,
  auditLog,
} from "../db/schema.js";
import {
  HttpError,
  fail,
  attachUser,
  requireUser,
  requireAdmin,
  publicUser,
  hashPassword,
  verifyPassword,
  createSession,
  clearCookie,
  destroySession,
  cleanUsername,
  cleanPassword,
  str,
  cents,
  intOr,
  publicSettings,
  setSetting,
  checkAdminCode,
  sha,
  audit,
  notify,
  type User,
} from "./lib.js";
import { broadcast, sendToUser, kickUser, onlineUsers, refreshUser } from "./realtime.js";

export const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);

const json = express.json({ limit: "200kb" });
app.use("/api", (req, res, next) => (req.headers["content-type"]?.startsWith("image/") ? next() : json(req, res, next)));
app.use("/api", attachUser);

const author = {
  id: users.id,
  username: users.username,
  displayName: users.displayName,
  isAdmin: users.isAdmin,
  avatarDex: users.avatarDex,
};

const TYPES = ["normal", "fire", "water", "grass", "electric", "ice", "fighting", "poison", "ground", "flying", "psychic", "bug", "rock", "ghost", "dragon", "dark", "steel", "fairy"];
const today = () => new Date().toISOString().slice(0, 10);

// Simple in-memory throttle for login and admin code guesses (a cache, not storage).
const attempts = new Map<string, { n: number; at: number }>();
function throttle(key: string, max = 8, windowMs = 10 * 60_000) {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || now - a.at > windowMs) {
    attempts.set(key, { n: 1, at: now });
    return;
  }
  a.n++;
  if (a.n > max) fail(429, "Too many tries. Take a break and try again in a few minutes.");
}

function pushNotify(userId: number, body: string, link = "") {
  return notify(userId, body, link).then(() => sendToUser(userId, { type: "notification", body, link }));
}

// ============ SETTINGS / ME ============
app.get("/api/settings", async (_req, res) => {
  res.json(await publicSettings());
});

app.get("/api/me", async (req, res) => {
  const settings = await publicSettings();
  if (!req.user) return res.json({ user: null, settings });
  const [{ unread }] = await db
    .select({ unread: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, req.user.id), eq(notifications.read, false)));
  res.json({ user: publicUser(req.user), unread, settings });
});

app.patch("/api/me", async (req, res) => {
  const me = requireUser(req);
  const patch: Partial<User> = {};
  if (req.body.displayName !== undefined) {
    patch.displayName = str(req.body.displayName, 30);
    if (!patch.displayName) fail(400, "Display name can't be empty.");
  }
  if (req.body.bio !== undefined) patch.bio = str(req.body.bio, 280);
  if (req.body.avatarDex !== undefined) {
    const d = intOr(req.body.avatarDex, 1);
    if (d < 1 || d > 1025) fail(400, "Pick a Pokédex number between 1 and 1025.");
    patch.avatarDex = d;
  }
  if (req.body.favoriteType !== undefined) {
    if (!TYPES.includes(req.body.favoriteType)) fail(400, "Unknown type.");
    patch.favoriteType = req.body.favoriteType;
  }
  const [u] = await db.update(users).set(patch).where(eq(users.id, me.id)).returning();
  refreshUser(u);
  res.json({ user: publicUser(u) });
});

app.post("/api/me/password", async (req, res) => {
  const me = requireUser(req);
  if (!verifyPassword(String(req.body.current ?? ""), me.passwordHash)) fail(400, "Current password is wrong.");
  const next = cleanPassword(req.body.next);
  await db.update(users).set({ passwordHash: hashPassword(next) }).where(eq(users.id, me.id));
  res.json({ ok: true });
});

// ============ AUTH ============
app.post("/api/auth/signup", async (req, res) => {
  const s = await publicSettings();
  if (!s.signupsOpen) fail(403, "Sign-ups are closed right now. Ask an admin to make you an account.");
  throttle(`signup:${req.ip}`, 10, 60 * 60_000);
  const username = cleanUsername(req.body.username);
  const password = cleanPassword(req.body.password);
  const displayName = str(req.body.displayName, 30) || username;
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.username, username));
  if (existing.length) fail(409, "That username is taken.");
  const [u] = await db
    .insert(users)
    .values({ username, displayName, passwordHash: hashPassword(password), avatarDex: 1 + Math.floor(Math.random() * 151) })
    .returning();
  await createSession(res, u.id);
  await audit(u.id, "signup", `@${username} joined`);
  res.status(201).json({ user: publicUser(u) });
});

async function loginWithPassword(req: Request) {
  const username = cleanUsername(req.body.username);
  throttle(`login:${username}:${req.ip}`);
  const [u] = await db.select().from(users).where(eq(users.username, username));
  if (!u || !verifyPassword(String(req.body.password ?? ""), u.passwordHash)) fail(401, "Wrong username or password.");
  if (u.banned) fail(403, `This account is banned${u.banReason ? `: ${u.banReason}` : "."}`);
  return u;
}

app.post("/api/auth/login", async (req, res) => {
  const u = await loginWithPassword(req);
  await createSession(res, u.id);
  res.json({ user: publicUser(u) });
});

app.post("/api/auth/logout", async (req, res) => {
  await destroySession(req.headers.cookie);
  clearCookie(res);
  res.json({ ok: true });
});

// Admin sign-in: account + the secret admin code. Promotes the account to admin.
app.post("/api/admin/login", async (req, res) => {
  throttle(`admincode:${req.ip}`, 6);
  const u = await loginWithPassword(req);
  if (!(await checkAdminCode(String(req.body.code ?? "")))) fail(401, "That admin code is wrong.");
  let user = u;
  if (!u.isAdmin) {
    [user] = await db.update(users).set({ isAdmin: true }).where(eq(users.id, u.id)).returning();
    await audit(u.id, "admin.unlock", `@${u.username} unlocked admin with the code`);
  }
  await createSession(res, user.id);
  res.json({ user: publicUser(user) });
});

app.post("/api/admin/unlock", async (req, res) => {
  const me = requireUser(req);
  throttle(`admincode:${req.ip}`, 6);
  if (!(await checkAdminCode(String(req.body.code ?? "")))) fail(401, "That admin code is wrong.");
  const [u] = await db.update(users).set({ isAdmin: true }).where(eq(users.id, me.id)).returning();
  if (!me.isAdmin) await audit(me.id, "admin.unlock", `@${me.username} unlocked admin with the code`);
  refreshUser(u);
  res.json({ user: publicUser(u) });
});

// ============ USERS / PROFILES ============
const userStats = {
  listingCount: sql<number>`(select count(*)::int from ${listings} l where l.user_id = ${users.id} and l.status in ('open','pending'))`,
  dealCount: sql<number>`(select count(*)::int from ${listings} l where l.user_id = ${users.id} and l.status = 'done')`,
  rating: sql<number | null>`(select round(avg(r.stars)::numeric, 1)::float from ${reviews} r where r.target_id = ${users.id})`,
  reviewCount: sql<number>`(select count(*)::int from ${reviews} r where r.target_id = ${users.id})`,
};

app.get("/api/users", async (req, res) => {
  requireUser(req);
  const q = str(req.query.q, 40);
  const role = str(req.query.role, 10);
  const conds = [];
  if (q) conds.push(or(ilike(users.username, `%${q}%`), ilike(users.displayName, `%${q}%`)));
  if (role === "admin") conds.push(eq(users.isAdmin, true));
  const rows = await db
    .select({ user: users, ...userStats })
    .from(users)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(users.isAdmin), asc(users.username))
    .limit(200);
  const online = new Set(onlineUsers().map((u) => u.id));
  res.json({
    users: rows.map((r) => ({ ...publicUser(r.user), ...stripUser(r), online: online.has(r.user.id) })),
  });
});

function stripUser<T extends { user: unknown }>(r: T) {
  const { user, ...rest } = r;
  return rest;
}

app.get("/api/users/:username", async (req, res) => {
  const me = requireUser(req);
  const [row] = await db
    .select({ user: users, ...userStats })
    .from(users)
    .where(eq(users.username, String(req.params.username).toLowerCase()));
  if (!row) fail(404, "No trainer with that username.");
  const u = row.user;
  const userListings = await listingQuery(me.id, [eq(listings.userId, u.id)], 60);
  const userReviews = await db
    .select({ review: reviews, author })
    .from(reviews)
    .innerJoin(users, eq(reviews.reviewerId, users.id))
    .where(eq(reviews.targetId, u.id))
    .orderBy(desc(reviews.createdAt))
    .limit(30);
  const online = onlineUsers().some((o) => o.id === u.id);
  res.json({
    user: { ...publicUser(u), ...stripUser(row), online },
    listings: userListings,
    reviews: userReviews.map((r) => ({ ...r.review, author: r.author })),
  });
});

app.post("/api/users/:id/reviews", async (req, res) => {
  const me = requireUser(req);
  const targetId = intOr(req.params.id, 0);
  if (targetId === me.id) fail(400, "You can't review yourself.");
  const stars = intOr(req.body.stars, 0);
  if (stars < 1 || stars > 5) fail(400, "Stars must be 1–5.");
  const [target] = await db.select().from(users).where(eq(users.id, targetId));
  if (!target) fail(404, "User not found.");
  const recent = await db
    .select({ id: reviews.id })
    .from(reviews)
    .where(and(eq(reviews.reviewerId, me.id), eq(reviews.targetId, targetId), gte(reviews.createdAt, new Date(Date.now() - 864e5))));
  if (recent.length) fail(429, "You already reviewed this trainer today.");
  const [r] = await db
    .insert(reviews)
    .values({ reviewerId: me.id, targetId, stars, comment: str(req.body.comment, 300), listingId: req.body.listingId ? intOr(req.body.listingId, 0) || null : null })
    .returning();
  await pushNotify(targetId, `${me.displayName} left you a ${stars}★ review`, `#/u/${target.username}`);
  res.status(201).json({ review: r });
});

// ============ LISTINGS ============
async function listingQuery(meId: number, conds: any[], limit = 100, order: any[] = [desc(listings.featured), desc(listings.createdAt)]) {
  const rows = await db
    .select({
      listing: listings,
      seller: author,
      offerCount: sql<number>`(select count(*)::int from ${offers} o where o.listing_id = ${listings.id} and o.status = 'pending')`,
      favCount: sql<number>`(select count(*)::int from ${favorites} f where f.listing_id = ${listings.id})`,
      isFavorite: sql<boolean>`exists(select 1 from ${favorites} f where f.listing_id = ${listings.id} and f.user_id = ${meId})`,
    })
    .from(listings)
    .innerJoin(users, eq(listings.userId, users.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(...order)
    .limit(limit);
  return rows.map((r) => ({ ...r.listing, seller: r.seller, offerCount: r.offerCount, favCount: r.favCount, isFavorite: r.isFavorite }));
}

app.get("/api/listings", async (req, res) => {
  const me = requireUser(req);
  const conds: any[] = [];
  const category = str(req.query.category, 10);
  const kind = str(req.query.kind, 10);
  const q = str(req.query.q, 60);
  const status = str(req.query.status, 10) || "active";
  if (category) conds.push(eq(listings.category, category));
  if (kind) conds.push(eq(listings.kind, kind));
  if (q) conds.push(or(ilike(listings.title, `%${q}%`), ilike(listings.description, `%${q}%`), ilike(listings.tradeFor, `%${q}%`)));
  if (status === "active") conds.push(inArray(listings.status, ["open", "pending"]));
  else if (status !== "all") conds.push(eq(listings.status, status));
  if (req.query.mine === "1") conds.push(eq(listings.userId, me.id));
  if (req.query.favorites === "1")
    conds.push(sql`exists(select 1 from ${favorites} f where f.listing_id = ${listings.id} and f.user_id = ${me.id})`);
  if (req.query.showExpired !== "1") conds.push(or(isNull(listings.expiresOn), gte(listings.expiresOn, today())));
  if (req.query.expiringSoon === "1") {
    const soon = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
    conds.push(sql`${listings.expiresOn} is not null and ${listings.expiresOn} <= ${soon}`);
  }
  const sort = str(req.query.sort, 12);
  const order =
    sort === "price_low"
      ? [sql`${listings.priceCents} asc nulls last`]
      : sort === "price_high"
        ? [sql`${listings.priceCents} desc nulls last`]
        : sort === "expiring"
          ? [sql`${listings.expiresOn} asc nulls last`]
          : sort === "popular"
            ? [desc(listings.views)]
            : [desc(listings.featured), desc(listings.createdAt)];
  res.json({ listings: await listingQuery(me.id, conds, 120, order) });
});

app.get("/api/listings/:id", async (req, res) => {
  const me = requireUser(req);
  const id = intOr(req.params.id, 0);
  await db.update(listings).set({ views: sql`${listings.views} + 1` }).where(and(eq(listings.id, id), ne(listings.userId, me.id)));
  const [listing] = await listingQuery(me.id, [eq(listings.id, id)], 1);
  if (!listing) fail(404, "Listing not found.");
  const canSeeAll = listing.userId === me.id || me.isAdmin;
  const offerRows = await db
    .select({ offer: offers, author })
    .from(offers)
    .innerJoin(users, eq(offers.userId, users.id))
    .where(canSeeAll ? eq(offers.listingId, id) : and(eq(offers.listingId, id), eq(offers.userId, me.id)))
    .orderBy(desc(offers.createdAt));
  res.json({ listing, offers: offerRows.map((o) => ({ ...o.offer, author: o.author })) });
});

async function validateListing(body: any, isNew: boolean, existing?: typeof listings.$inferSelect) {
  const s = await publicSettings();
  const v: Partial<typeof listings.$inferInsert> = {};
  const category = isNew ? str(body.category, 10) : existing!.category;
  if (isNew) {
    if (!["pokemon", "snack"].includes(category)) fail(400, "Pick Pokémon or Snack.");
    if (category === "pokemon" && !s.pokemonMarketOpen) fail(403, "The Pokémon market is closed by an admin right now.");
    if (category === "snack" && !s.snackMarketOpen) fail(403, "The snack market is closed by an admin right now.");
    v.category = category;
  }
  if (isNew || body.kind !== undefined) {
    const kind = str(body.kind, 10);
    if (!["sell", "buy", "trade"].includes(kind)) fail(400, "Pick sell, buy or trade.");
    v.kind = kind;
  }
  if (isNew || body.title !== undefined) {
    v.title = str(body.title, 80);
    if (!v.title) fail(400, "Give it a title.");
  }
  if (body.description !== undefined) v.description = str(body.description, 1000);
  if (body.priceCents !== undefined) {
    v.priceCents = cents(body.priceCents);
    if (v.priceCents !== null && v.priceCents > s.maxPriceCents)
      fail(400, `Max price is $${(s.maxPriceCents / 100).toFixed(2)} (set by admins).`);
  }
  if (body.tradeFor !== undefined) v.tradeFor = str(body.tradeFor, 200);
  if (body.condition !== undefined) v.condition = str(body.condition, 30);
  if (body.quantity !== undefined) v.quantity = Math.max(1, Math.min(999, intOr(body.quantity, 1)));
  if (body.meetSpot !== undefined) v.meetSpot = str(body.meetSpot, 60);
  if (body.pokemonDex !== undefined) {
    const d = body.pokemonDex === null || body.pokemonDex === "" ? null : intOr(body.pokemonDex, 0);
    if (d !== null && (d < 1 || d > 1025)) fail(400, "Pokédex number must be 1–1025.");
    v.pokemonDex = d;
  }
  if (body.imageKey !== undefined) v.imageKey = body.imageKey ? str(body.imageKey, 80) : null;
  if (body.expiresOn !== undefined) {
    const e = body.expiresOn ? str(body.expiresOn, 10) : null;
    if (e && !/^\d{4}-\d{2}-\d{2}$/.test(e)) fail(400, "Expiration date looks wrong.");
    v.expiresOn = e;
  }
  if (category === "snack" && isNew && !v.expiresOn) fail(400, "Snacks need an expiration date.");
  if (category === "snack" && isNew && v.expiresOn! < today()) fail(400, "That snack is already expired!");
  return v;
}

app.post("/api/listings", async (req, res) => {
  const me = requireUser(req);
  const v = await validateListing(req.body, true);
  const openCount = await db
    .select({ n: count() })
    .from(listings)
    .where(and(eq(listings.userId, me.id), inArray(listings.status, ["open", "pending"])));
  if (openCount[0].n >= 40 && !me.isAdmin) fail(400, "You have 40 active listings. Close some first.");
  const [l] = await db
    .insert(listings)
    .values({ ...(v as any), userId: me.id })
    .returning();
  broadcast({ type: "listing", action: "new", listing: { id: l.id, title: l.title, category: l.category, kind: l.kind }, by: me.displayName });
  res.status(201).json({ listing: l });
});

app.patch("/api/listings/:id", async (req, res) => {
  const me = requireUser(req);
  const id = intOr(req.params.id, 0);
  const [existing] = await db.select().from(listings).where(eq(listings.id, id));
  if (!existing) fail(404, "Listing not found.");
  if (existing.userId !== me.id && !me.isAdmin) fail(403, "That's not your listing.");
  const v = await validateListing(req.body, false, existing);
  if (req.body.status !== undefined) {
    if (!["open", "pending", "done", "closed"].includes(req.body.status)) fail(400, "Bad status.");
    v.status = req.body.status;
  }
  if (req.body.featured !== undefined) {
    if (!me.isAdmin) fail(403, "Only admins can feature listings.");
    v.featured = !!req.body.featured;
  }
  const [l] = await db
    .update(listings)
    .set({ ...(v as any), updatedAt: new Date() })
    .where(eq(listings.id, id))
    .returning();
  if (existing.userId !== me.id) {
    await audit(me.id, "listing.edit", `Edited "${existing.title}" (#${id}) by user ${existing.userId}`);
    await pushNotify(existing.userId, `An admin updated your listing "${existing.title}"`, `#/listing/${id}`);
  }
  if (v.status === "done" && existing.status !== "done") {
    const accepted = await db.select().from(offers).where(and(eq(offers.listingId, id), eq(offers.status, "accepted")));
    for (const o of accepted) await pushNotify(o.userId, `Deal for "${existing.title}" marked complete. Leave a review!`, `#/listing/${id}`);
  }
  broadcast({ type: "listing", action: "update", listing: { id: l.id } });
  res.json({ listing: l });
});

app.delete("/api/listings/:id", async (req, res) => {
  const me = requireUser(req);
  const id = intOr(req.params.id, 0);
  const [existing] = await db.select().from(listings).where(eq(listings.id, id));
  if (!existing) fail(404, "Listing not found.");
  if (existing.userId !== me.id && !me.isAdmin) fail(403, "That's not your listing.");
  await db.delete(listings).where(eq(listings.id, id));
  if (existing.imageKey) await images().delete(existing.imageKey).catch(() => {});
  if (existing.userId !== me.id) {
    await audit(me.id, "listing.delete", `Removed "${existing.title}" (#${id})`);
    await pushNotify(existing.userId, `An admin removed your listing "${existing.title}"`);
  }
  broadcast({ type: "listing", action: "delete", listing: { id } });
  res.json({ ok: true });
});

app.post("/api/listings/:id/favorite", async (req, res) => {
  const me = requireUser(req);
  const id = intOr(req.params.id, 0);
  const del = await db.delete(favorites).where(and(eq(favorites.userId, me.id), eq(favorites.listingId, id))).returning();
  if (del.length) return res.json({ favorite: false });
  await db.insert(favorites).values({ userId: me.id, listingId: id });
  res.json({ favorite: true });
});

// ============ OFFERS ============
app.post("/api/listings/:id/offers", async (req, res) => {
  const me = requireUser(req);
  const id = intOr(req.params.id, 0);
  const [l] = await db.select().from(listings).where(eq(listings.id, id));
  if (!l) fail(404, "Listing not found.");
  if (l.userId === me.id) fail(400, "You can't make an offer on your own listing.");
  if (!["open", "pending"].includes(l.status)) fail(400, "This listing is no longer taking offers.");
  const offerCents = cents(req.body.offerCents);
  const offerItems = str(req.body.offerItems, 200);
  const message = str(req.body.message, 500);
  if (offerCents === null && !offerItems && !message) fail(400, "Add an offer amount, items, or a message.");
  const pending = await db
    .select({ id: offers.id })
    .from(offers)
    .where(and(eq(offers.listingId, id), eq(offers.userId, me.id), eq(offers.status, "pending")));
  if (pending.length) fail(400, "You already have a pending offer here. Withdraw it to make a new one.");
  const [o] = await db.insert(offers).values({ listingId: id, userId: me.id, offerCents, offerItems, message }).returning();
  await pushNotify(l.userId, `${me.displayName} made an offer on "${l.title}"`, `#/listing/${id}`);
  res.status(201).json({ offer: o });
});

app.post("/api/offers/:id/:action", async (req, res) => {
  const me = requireUser(req);
  const action = req.params.action;
  const [row] = await db
    .select({ offer: offers, listing: listings })
    .from(offers)
    .innerJoin(listings, eq(offers.listingId, listings.id))
    .where(eq(offers.id, intOr(req.params.id, 0)));
  if (!row) fail(404, "Offer not found.");
  const { offer, listing } = row;
  const isOwner = listing.userId === me.id || me.isAdmin;
  if (action === "withdraw") {
    if (offer.userId !== me.id) fail(403, "Not your offer.");
    await db.update(offers).set({ status: "withdrawn" }).where(eq(offers.id, offer.id));
  } else if (action === "accept" || action === "decline") {
    if (!isOwner) fail(403, "Only the seller can do that.");
    if (offer.status !== "pending") fail(400, "That offer isn't pending.");
    await db.update(offers).set({ status: action === "accept" ? "accepted" : "declined" }).where(eq(offers.id, offer.id));
    if (action === "accept") {
      await db.update(listings).set({ status: "pending", updatedAt: new Date() }).where(eq(listings.id, listing.id));
      await pushNotify(
        offer.userId,
        `🎉 Your offer on "${listing.title}" was accepted! Meet up${listing.meetSpot ? ` at ${listing.meetSpot}` : " at school"}.`,
        `#/listing/${listing.id}`
      );
    } else {
      await pushNotify(offer.userId, `Your offer on "${listing.title}" was declined.`, `#/listing/${listing.id}`);
    }
  } else fail(400, "Unknown action.");
  res.json({ ok: true });
});

app.get("/api/offers", async (req, res) => {
  const me = requireUser(req);
  const sent = await db
    .select({ offer: offers, listing: { id: listings.id, title: listings.title, category: listings.category, status: listings.status, kind: listings.kind }, seller: author })
    .from(offers)
    .innerJoin(listings, eq(offers.listingId, listings.id))
    .innerJoin(users, eq(listings.userId, users.id))
    .where(eq(offers.userId, me.id))
    .orderBy(desc(offers.createdAt))
    .limit(100);
  const received = await db
    .select({ offer: offers, listing: { id: listings.id, title: listings.title, category: listings.category, status: listings.status, kind: listings.kind }, author })
    .from(offers)
    .innerJoin(listings, eq(offers.listingId, listings.id))
    .innerJoin(users, eq(offers.userId, users.id))
    .where(eq(listings.userId, me.id))
    .orderBy(desc(offers.createdAt))
    .limit(100);
  res.json({
    sent: sent.map((r) => ({ ...r.offer, listing: r.listing, seller: r.seller })),
    received: received.map((r) => ({ ...r.offer, listing: r.listing, author: r.author })),
  });
});

// ============ IMAGES ============
const images = () => getStore({ name: "listing-images", consistency: "strong" });

app.post("/api/uploads", express.raw({ type: "image/*", limit: "3mb" }), async (req, res) => {
  const me = requireUser(req);
  const type = String(req.headers["content-type"]);
  if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(type)) fail(400, "Upload a JPG, PNG, WEBP or GIF.");
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) fail(400, "Empty upload.");
  const key = `${me.id}-${randomBytes(10).toString("hex")}`;
  const body = req.body as Buffer;
  await images().set(key, body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer, {
    metadata: { type, userId: me.id },
  });
  res.status(201).json({ key });
});

app.get("/api/images/:key", async (req, res) => {
  const key = String(req.params.key).replace(/[^a-z0-9-]/gi, "");
  const result = await images().getWithMetadata(key, { type: "arrayBuffer" });
  if (!result) return res.status(404).end();
  res.setHeader("Content-Type", String(result.metadata?.type || "image/jpeg"));
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.end(Buffer.from(result.data));
});

// ============ CHAT ============
const DEFAULT_CHANNELS = [
  { slug: "general", name: "General", emoji: "💬", description: "Hang out and talk about anything.", sortOrder: 0 },
  { slug: "pokemon-trades", name: "Pokémon Trades", emoji: "⚡", description: "Haggle, hype and plan Pokémon trades.", sortOrder: 1 },
  { slug: "snack-shack", name: "Snack Shack", emoji: "🍫", description: "Snack deals, swaps and cravings.", sortOrder: 2 },
  { slug: "announcements", name: "Announcements", emoji: "📣", description: "Only admins can post here.", adminOnly: true, sortOrder: -1 },
];
let channelsSeeded = false;
async function ensureChannels() {
  if (channelsSeeded) return;
  await db.insert(channels).values(DEFAULT_CHANNELS).onConflictDoNothing({ target: channels.slug });
  channelsSeeded = true;
}

app.get("/api/channels", async (req, res) => {
  requireUser(req);
  await ensureChannels();
  const rows = await db.select().from(channels).orderBy(asc(channels.sortOrder), asc(channels.id));
  res.json({ channels: rows, online: onlineUsers() });
});

async function channelBySlug(slug: string) {
  await ensureChannels();
  const [c] = await db.select().from(channels).where(eq(channels.slug, slug));
  if (!c) fail(404, "Channel not found.");
  return c;
}

const messageSelect = { message: messages, author };
function shapeMessage(r: { message: typeof messages.$inferSelect; author: any }, slug: string) {
  return { ...r.message, body: r.message.deleted ? "" : r.message.body, author: r.author, channel: slug };
}

app.get("/api/channels/:slug/messages", async (req, res) => {
  requireUser(req);
  const c = await channelBySlug(String(req.params.slug));
  const conds: any[] = [eq(messages.channelId, c.id)];
  const after = intOr(req.query.after, 0);
  const before = intOr(req.query.before, 0);
  if (after) conds.push(sql`${messages.id} > ${after}`);
  if (before) conds.push(lt(messages.id, before));
  const rows = await db
    .select(messageSelect)
    .from(messages)
    .innerJoin(users, eq(messages.userId, users.id))
    .where(and(...conds))
    .orderBy(desc(messages.id))
    .limit(60);
  const pinned = await db
    .select(messageSelect)
    .from(messages)
    .innerJoin(users, eq(messages.userId, users.id))
    .where(and(eq(messages.channelId, c.id), eq(messages.pinned, true), eq(messages.deleted, false)))
    .orderBy(desc(messages.id))
    .limit(5);
  res.json({
    channel: c,
    messages: rows.reverse().map((r) => shapeMessage(r, c.slug)),
    pinned: pinned.map((r) => shapeMessage(r, c.slug)),
  });
});

const lastPost = new Map<string, number>();
app.post("/api/channels/:slug/messages", async (req, res) => {
  const me = requireUser(req);
  const s = await publicSettings();
  const c = await channelBySlug(String(req.params.slug));
  if (!me.isAdmin) {
    if (!s.chatOpen) fail(403, "Chat is paused by an admin.");
    if (c.locked) fail(403, "This channel is locked.");
    if (c.adminOnly) fail(403, "Only admins can post here.");
    if (me.mutedUntil && me.mutedUntil > new Date())
      fail(403, `You're muted until ${me.mutedUntil.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}.`);
    const key = `${me.id}:${c.id}`;
    const wait = Math.max(c.slowModeSeconds, 1) * 1000;
    if (Date.now() - (lastPost.get(key) || 0) < wait)
      fail(429, c.slowModeSeconds > 1 ? `Slow mode is on: wait ${c.slowModeSeconds}s between messages.` : "Slow down a little!");
    lastPost.set(key, Date.now());
  }
  const body = str(req.body.body, 800);
  if (!body) fail(400, "Message is empty.");
  const listingId = req.body.listingId ? intOr(req.body.listingId, 0) || null : null;
  const [m] = await db.insert(messages).values({ channelId: c.id, userId: me.id, body, listingId }).returning();
  const shaped = shapeMessage({ message: m, author: { id: me.id, username: me.username, displayName: me.displayName, isAdmin: me.isAdmin, avatarDex: me.avatarDex } }, c.slug);
  broadcast({ type: "message", message: shaped });

  // @mentions → notifications
  const mentions = [...new Set([...body.matchAll(/@([a-z0-9_]{3,20})/gi)].map((x) => x[1].toLowerCase()))].slice(0, 5);
  if (mentions.length) {
    const found = await db.select({ id: users.id }).from(users).where(inArray(users.username, mentions));
    for (const f of found) if (f.id !== me.id) await pushNotify(f.id, `${me.displayName} mentioned you in #${c.name}`, `#/chat/${c.slug}`);
  }
  res.status(201).json({ message: shaped });
});

app.delete("/api/messages/:id", async (req, res) => {
  const me = requireUser(req);
  const [m] = await db.select().from(messages).where(eq(messages.id, intOr(req.params.id, 0)));
  if (!m) fail(404, "Message not found.");
  if (m.userId !== me.id && !me.isAdmin) fail(403, "You can only delete your own messages.");
  await db.update(messages).set({ deleted: true, pinned: false }).where(eq(messages.id, m.id));
  if (m.userId !== me.id) await audit(me.id, "chat.delete", `Deleted message #${m.id}: "${m.body.slice(0, 60)}"`);
  broadcast({ type: "message_deleted", id: m.id });
  res.json({ ok: true });
});

app.post("/api/messages/:id/pin", async (req, res) => {
  const me = requireAdmin(req);
  const [m] = await db.select().from(messages).where(eq(messages.id, intOr(req.params.id, 0)));
  if (!m) fail(404, "Message not found.");
  const [u] = await db.update(messages).set({ pinned: !m.pinned }).where(eq(messages.id, m.id)).returning();
  await audit(me.id, u.pinned ? "chat.pin" : "chat.unpin", `Message #${m.id}`);
  broadcast({ type: "message_pinned", id: m.id, pinned: u.pinned });
  res.json({ pinned: u.pinned });
});

// ============ REPORTS / NOTIFICATIONS / ANNOUNCEMENTS ============
app.post("/api/reports", async (req, res) => {
  const me = requireUser(req);
  const targetType = str(req.body.targetType, 10);
  if (!["listing", "message", "user"].includes(targetType)) fail(400, "Bad report type.");
  const reason = str(req.body.reason, 300);
  if (!reason) fail(400, "Say what's wrong.");
  await db.insert(reports).values({ reporterId: me.id, targetType, targetId: intOr(req.body.targetId, 0), reason });
  const admins = await db.select({ id: users.id }).from(users).where(eq(users.isAdmin, true));
  for (const a of admins) sendToUser(a.id, { type: "report" });
  res.status(201).json({ ok: true });
});

app.get("/api/notifications", async (req, res) => {
  const me = requireUser(req);
  const rows = await db.select().from(notifications).where(eq(notifications.userId, me.id)).orderBy(desc(notifications.createdAt)).limit(50);
  res.json({ notifications: rows });
});
app.post("/api/notifications/read", async (req, res) => {
  const me = requireUser(req);
  await db.update(notifications).set({ read: true }).where(eq(notifications.userId, me.id));
  res.json({ ok: true });
});

app.get("/api/announcements", async (_req, res) => {
  const rows = await db.select().from(announcements).where(eq(announcements.active, true)).orderBy(desc(announcements.createdAt)).limit(3);
  res.json({ announcements: rows });
});

app.get("/api/home", async (req, res) => {
  const me = requireUser(req);
  const [stats] = await db
    .select({
      trainers: sql<number>`(select count(*)::int from ${users})`,
      pokemon: sql<number>`(select count(*)::int from ${listings} where category='pokemon' and status in ('open','pending'))`,
      snacks: sql<number>`(select count(*)::int from ${listings} where category='snack' and status in ('open','pending') and (expires_on is null or expires_on >= ${today()}))`,
      deals: sql<number>`(select count(*)::int from ${listings} where status='done')`,
    })
    .from(sql`(select 1) as x`);
  const fresh = await listingQuery(me.id, [inArray(listings.status, ["open", "pending"]), or(isNull(listings.expiresOn), gte(listings.expiresOn, today()))], 8);
  const soon = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
  const expiring = await listingQuery(
    me.id,
    [eq(listings.category, "snack"), inArray(listings.status, ["open", "pending"]), gte(listings.expiresOn, today()), sql`${listings.expiresOn} <= ${soon}`],
    6,
    [asc(listings.expiresOn)]
  );
  res.json({ stats: { ...stats, online: onlineUsers().length }, fresh, expiring, online: onlineUsers() });
});

// ============ ADMIN ============
app.get("/api/admin/overview", async (req, res) => {
  requireAdmin(req);
  const [stats] = await db
    .select({
      users: sql<number>`(select count(*)::int from ${users})`,
      admins: sql<number>`(select count(*)::int from ${users} where is_admin)`,
      banned: sql<number>`(select count(*)::int from ${users} where banned)`,
      activeListings: sql<number>`(select count(*)::int from ${listings} where status in ('open','pending'))`,
      deals: sql<number>`(select count(*)::int from ${listings} where status='done')`,
      expiredSnacks: sql<number>`(select count(*)::int from ${listings} where category='snack' and expires_on < ${today()} and status in ('open','pending'))`,
      messages24h: sql<number>`(select count(*)::int from ${messages} where created_at > now() - interval '1 day')`,
      openReports: sql<number>`(select count(*)::int from ${reports} where status='open')`,
      pendingOffers: sql<number>`(select count(*)::int from ${offers} where status='pending')`,
    })
    .from(sql`(select 1) as x`);
  res.json({ stats: { ...stats, online: onlineUsers().length }, online: onlineUsers() });
});

app.get("/api/admin/users", async (req, res) => {
  requireAdmin(req);
  const q = str(req.query.q, 40);
  const rows = await db
    .select({ user: users, ...userStats })
    .from(users)
    .where(q ? or(ilike(users.username, `%${q}%`), ilike(users.displayName, `%${q}%`)) : undefined)
    .orderBy(desc(users.createdAt))
    .limit(500);
  const online = new Set(onlineUsers().map((u) => u.id));
  res.json({ users: rows.map((r) => ({ ...publicUser(r.user), ...stripUser(r), banReason: r.user.banReason, online: online.has(r.user.id) })) });
});

app.post("/api/admin/users", async (req, res) => {
  const me = requireAdmin(req);
  const username = cleanUsername(req.body.username);
  const password = cleanPassword(req.body.password);
  const displayName = str(req.body.displayName, 30) || username;
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.username, username));
  if (existing.length) fail(409, "That username is taken.");
  const [u] = await db
    .insert(users)
    .values({
      username,
      displayName,
      passwordHash: hashPassword(password),
      isAdmin: !!req.body.isAdmin,
      createdBy: me.id,
      avatarDex: 1 + Math.floor(Math.random() * 151),
    })
    .returning();
  await audit(me.id, "user.create", `Created @${username}${u.isAdmin ? " (admin)" : ""}`);
  await notify(u.id, `Welcome to the club, ${displayName}! ${me.displayName} made your account.`);
  res.status(201).json({ user: publicUser(u) });
});

app.patch("/api/admin/users/:id", async (req, res) => {
  const me = requireAdmin(req);
  const id = intOr(req.params.id, 0);
  const [target] = await db.select().from(users).where(eq(users.id, id));
  if (!target) fail(404, "User not found.");
  const patch: Partial<User> = {};
  const changes: string[] = [];
  if (req.body.isAdmin !== undefined) {
    if (id === me.id && !req.body.isAdmin) {
      const [{ n }] = await db.select({ n: count() }).from(users).where(eq(users.isAdmin, true));
      if (n <= 1) fail(400, "You're the last admin, so you can't remove your own admin tag.");
    }
    patch.isAdmin = !!req.body.isAdmin;
    changes.push(patch.isAdmin ? "made admin" : "removed admin");
  }
  if (req.body.banned !== undefined) {
    if (id === me.id) fail(400, "You can't ban yourself.");
    patch.banned = !!req.body.banned;
    patch.banReason = patch.banned ? str(req.body.banReason, 200) || null : null;
    changes.push(patch.banned ? `banned${patch.banReason ? ` (${patch.banReason})` : ""}` : "unbanned");
  }
  if (req.body.muteMinutes !== undefined) {
    const mins = intOr(req.body.muteMinutes, 0);
    patch.mutedUntil = mins > 0 ? new Date(Date.now() + mins * 60_000) : null;
    changes.push(mins > 0 ? `muted ${mins}m` : "unmuted");
  }
  if (req.body.displayName !== undefined) {
    patch.displayName = str(req.body.displayName, 30) || target.displayName;
    changes.push(`renamed to ${patch.displayName}`);
  }
  if (req.body.bio !== undefined) {
    patch.bio = str(req.body.bio, 280);
    changes.push("edited bio");
  }
  if (req.body.password !== undefined) {
    patch.passwordHash = hashPassword(cleanPassword(req.body.password));
    changes.push("reset password");
  }
  if (req.body.username !== undefined) {
    const nu = cleanUsername(req.body.username);
    if (nu !== target.username) {
      const ex = await db.select({ id: users.id }).from(users).where(eq(users.username, nu));
      if (ex.length) fail(409, "That username is taken.");
      patch.username = nu;
      changes.push(`username → @${nu}`);
    }
  }
  const [u] = await db.update(users).set(patch).where(eq(users.id, id)).returning();
  if (patch.banned) {
    await db.delete(sessions).where(eq(sessions.userId, id));
    kickUser(id, patch.banReason || "You were banned by an admin.");
  } else if (patch.passwordHash && id !== me.id) {
    await db.delete(sessions).where(eq(sessions.userId, id));
  } else refreshUser(u);
  if (patch.mutedUntil) await pushNotify(id, `You were muted in chat for ${intOr(req.body.muteMinutes, 0)} minutes.`);
  if (patch.isAdmin === true && !target.isAdmin) await pushNotify(id, `⭐ You're now an admin! Check the Admin panel.`, "#/admin");
  await audit(me.id, "user.update", `@${target.username}: ${changes.join(", ")}`);
  res.json({ user: publicUser(u) });
});

app.delete("/api/admin/users/:id", async (req, res) => {
  const me = requireAdmin(req);
  const id = intOr(req.params.id, 0);
  if (id === me.id) fail(400, "You can't delete your own account here.");
  const [target] = await db.select().from(users).where(eq(users.id, id));
  if (!target) fail(404, "User not found.");
  kickUser(id, "Your account was deleted.");
  await db.update(auditLog).set({ actorId: null }).where(eq(auditLog.actorId, id));
  await db.delete(users).where(eq(users.id, id));
  await audit(me.id, "user.delete", `Deleted @${target.username}`);
  res.json({ ok: true });
});

app.get("/api/admin/reports", async (req, res) => {
  requireAdmin(req);
  const rows = await db
    .select({ report: reports, reporter: author })
    .from(reports)
    .innerJoin(users, eq(reports.reporterId, users.id))
    .orderBy(sql`case when ${reports.status} = 'open' then 0 else 1 end`, desc(reports.createdAt))
    .limit(100);
  // Attach a short preview of what was reported.
  const out = [];
  for (const r of rows) {
    let preview = "";
    let link = "";
    if (r.report.targetType === "listing") {
      const [l] = await db.select({ title: listings.title }).from(listings).where(eq(listings.id, r.report.targetId));
      preview = l ? l.title : "(deleted listing)";
      link = `#/listing/${r.report.targetId}`;
    } else if (r.report.targetType === "message") {
      const [m] = await db
        .select({ body: messages.body, deleted: messages.deleted, username: users.username })
        .from(messages)
        .innerJoin(users, eq(messages.userId, users.id))
        .where(eq(messages.id, r.report.targetId));
      preview = m ? (m.deleted ? "(deleted)" : `@${m.username}: ${m.body.slice(0, 120)}`) : "(gone)";
    } else {
      const [u] = await db.select({ username: users.username }).from(users).where(eq(users.id, r.report.targetId));
      preview = u ? `@${u.username}` : "(deleted user)";
      link = u ? `#/u/${u.username}` : "";
    }
    out.push({ ...r.report, reporter: r.reporter, preview, link });
  }
  res.json({ reports: out });
});

app.patch("/api/admin/reports/:id", async (req, res) => {
  const me = requireAdmin(req);
  const status = str(req.body.status, 12);
  if (!["open", "resolved", "dismissed"].includes(status)) fail(400, "Bad status.");
  await db.update(reports).set({ status }).where(eq(reports.id, intOr(req.params.id, 0)));
  await audit(me.id, "report." + status, `Report #${req.params.id}`);
  res.json({ ok: true });
});

app.get("/api/admin/announcements", async (req, res) => {
  requireAdmin(req);
  res.json({ announcements: await db.select().from(announcements).orderBy(desc(announcements.createdAt)).limit(50) });
});
app.post("/api/admin/announcements", async (req, res) => {
  const me = requireAdmin(req);
  const body = str(req.body.body, 300);
  if (!body) fail(400, "Write something.");
  const tone = ["info", "hype", "warning"].includes(req.body.tone) ? req.body.tone : "info";
  const [a] = await db.insert(announcements).values({ body, tone, createdBy: me.id }).returning();
  await audit(me.id, "announcement.create", body.slice(0, 80));
  broadcast({ type: "announcement" });
  res.status(201).json({ announcement: a });
});
app.patch("/api/admin/announcements/:id", async (req, res) => {
  requireAdmin(req);
  await db.update(announcements).set({ active: !!req.body.active }).where(eq(announcements.id, intOr(req.params.id, 0)));
  broadcast({ type: "announcement" });
  res.json({ ok: true });
});
app.delete("/api/admin/announcements/:id", async (req, res) => {
  requireAdmin(req);
  await db.delete(announcements).where(eq(announcements.id, intOr(req.params.id, 0)));
  broadcast({ type: "announcement" });
  res.json({ ok: true });
});

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);
}
app.post("/api/admin/channels", async (req, res) => {
  const me = requireAdmin(req);
  const name = str(req.body.name, 30);
  const slug = slugify(name);
  if (!slug) fail(400, "Channel needs a name.");
  const [c] = await db
    .insert(channels)
    .values({ slug, name, emoji: str(req.body.emoji, 4) || "💬", description: str(req.body.description, 120), adminOnly: !!req.body.adminOnly, sortOrder: 10 })
    .onConflictDoNothing({ target: channels.slug })
    .returning();
  if (!c) fail(409, "A channel with that name exists.");
  await audit(me.id, "channel.create", `#${slug}`);
  broadcast({ type: "channels" });
  res.status(201).json({ channel: c });
});
app.patch("/api/admin/channels/:id", async (req, res) => {
  const me = requireAdmin(req);
  const patch: Partial<typeof channels.$inferInsert> = {};
  if (req.body.name !== undefined) patch.name = str(req.body.name, 30);
  if (req.body.description !== undefined) patch.description = str(req.body.description, 120);
  if (req.body.emoji !== undefined) patch.emoji = str(req.body.emoji, 4) || "💬";
  if (req.body.locked !== undefined) patch.locked = !!req.body.locked;
  if (req.body.adminOnly !== undefined) patch.adminOnly = !!req.body.adminOnly;
  if (req.body.slowModeSeconds !== undefined) patch.slowModeSeconds = Math.max(0, Math.min(600, intOr(req.body.slowModeSeconds, 0)));
  const [c] = await db.update(channels).set(patch).where(eq(channels.id, intOr(req.params.id, 0))).returning();
  await audit(me.id, "channel.update", `#${c?.slug}: ${Object.keys(patch).join(", ")}`);
  broadcast({ type: "channels" });
  res.json({ channel: c });
});
app.delete("/api/admin/channels/:id", async (req, res) => {
  const me = requireAdmin(req);
  const [c] = await db.select().from(channels).where(eq(channels.id, intOr(req.params.id, 0)));
  if (!c) fail(404, "Channel not found.");
  if (c.slug === "general") fail(400, "#general can't be deleted.");
  await db.delete(channels).where(eq(channels.id, c.id));
  await audit(me.id, "channel.delete", `#${c.slug}`);
  broadcast({ type: "channels" });
  res.json({ ok: true });
});
app.post("/api/admin/channels/:id/clear", async (req, res) => {
  const me = requireAdmin(req);
  const [c] = await db.select().from(channels).where(eq(channels.id, intOr(req.params.id, 0)));
  if (!c) fail(404, "Channel not found.");
  await db.delete(messages).where(eq(messages.channelId, c.id));
  await audit(me.id, "channel.clear", `Cleared #${c.slug}`);
  broadcast({ type: "channel_cleared", channel: c.slug });
  res.json({ ok: true });
});

app.get("/api/admin/settings", async (req, res) => {
  requireAdmin(req);
  res.json({ settings: await publicSettings() });
});
app.patch("/api/admin/settings", async (req, res) => {
  const me = requireAdmin(req);
  const b = req.body;
  const changed: string[] = [];
  for (const key of ["siteName", "tagline", "welcomeMessage"]) {
    if (b[key] !== undefined) {
      await setSetting(key, str(b[key], key === "siteName" ? 40 : 200));
      changed.push(key);
    }
  }
  for (const key of ["signupsOpen", "pokemonMarketOpen", "snackMarketOpen", "chatOpen"]) {
    if (b[key] !== undefined) {
      await setSetting(key, b[key] ? "true" : "false");
      changed.push(`${key}=${!!b[key]}`);
    }
  }
  if (Array.isArray(b.meetSpots)) {
    const spots = b.meetSpots.map((s: unknown) => str(s, 40)).filter(Boolean).slice(0, 20);
    await setSetting("meetSpots", JSON.stringify(spots));
    changed.push("meetSpots");
  }
  if (b.maxPriceCents !== undefined) {
    await setSetting("maxPriceCents", String(Math.max(100, cents(b.maxPriceCents) ?? 10000)));
    changed.push("maxPrice");
  }
  if (b.newAdminCode !== undefined) {
    const code = str(b.newAdminCode, 50);
    if (code.length < 4) fail(400, "Admin code must be at least 4 characters.");
    await setSetting("adminCodeHash", sha(code));
    changed.push("admin code");
  }
  await audit(me.id, "settings.update", changed.join(", "));
  broadcast({ type: "settings" });
  res.json({ settings: await publicSettings() });
});

app.post("/api/admin/snacks/purge-expired", async (req, res) => {
  const me = requireAdmin(req);
  const rows = await db
    .update(listings)
    .set({ status: "closed", updatedAt: new Date() })
    .where(and(eq(listings.category, "snack"), lt(listings.expiresOn, today()), inArray(listings.status, ["open", "pending"])))
    .returning({ id: listings.id, userId: listings.userId, title: listings.title });
  for (const r of rows) await notify(r.userId, `Your snack "${r.title}" expired and was closed by an admin.`);
  await audit(me.id, "snacks.purge", `Closed ${rows.length} expired snack listings`);
  res.json({ closed: rows.length });
});

app.get("/api/admin/audit", async (req, res) => {
  requireAdmin(req);
  const rows = await db
    .select({ entry: auditLog, actor: { username: users.username, displayName: users.displayName } })
    .from(auditLog)
    .leftJoin(users, eq(auditLog.actorId, users.id))
    .orderBy(desc(auditLog.createdAt))
    .limit(150);
  res.json({ entries: rows.map((r) => ({ ...r.entry, actor: r.actor })) });
});

app.post("/api/admin/broadcast", async (req, res) => {
  const me = requireAdmin(req);
  const body = str(req.body.body, 200);
  if (!body) fail(400, "Write something.");
  const all = await db.select({ id: users.id }).from(users).where(eq(users.banned, false));
  for (const u of all) await notify(u.id, `📣 ${body}`);
  broadcast({ type: "notification", body: `📣 ${body}`, link: "" });
  await audit(me.id, "broadcast", body);
  res.json({ sent: all.length });
});

// ============ ERRORS ============
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err?.type === "entity.too.large") return res.status(413).json({ error: "That file is too big." });
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server." });
});
