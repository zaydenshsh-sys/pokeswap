import { pgTable, serial, text, timestamp, integer, boolean, date, index, primaryKey } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial().primaryKey(),
  username: text().notNull().unique(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  banned: boolean().notNull().default(false),
  banReason: text("ban_reason"),
  mutedUntil: timestamp("muted_until"),
  bio: text().notNull().default(""),
  avatarDex: integer("avatar_dex").notNull().default(1),
  favoriteType: text("favorite_type").notNull().default("grass"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastSeen: timestamp("last_seen").notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  token: text().primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
});

export const listings = pgTable(
  "listings",
  {
    id: serial().primaryKey(),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    category: text().notNull(), // pokemon | snack
    kind: text().notNull(), // sell | buy | trade
    title: text().notNull(),
    description: text().notNull().default(""),
    priceCents: integer("price_cents"),
    tradeFor: text("trade_for").notNull().default(""),
    condition: text().notNull().default(""),
    quantity: integer().notNull().default(1),
    expiresOn: date("expires_on"),
    meetSpot: text("meet_spot").notNull().default(""),
    pokemonDex: integer("pokemon_dex"),
    imageKey: text("image_key"),
    status: text().notNull().default("open"), // open | pending | done | closed
    featured: boolean().notNull().default(false),
    views: integer().notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("listings_category_idx").on(t.category, t.status), index("listings_user_idx").on(t.userId)]
);

export const offers = pgTable("offers", {
  id: serial().primaryKey(),
  listingId: integer("listing_id").notNull().references(() => listings.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  message: text().notNull().default(""),
  offerCents: integer("offer_cents"),
  offerItems: text("offer_items").notNull().default(""),
  status: text().notNull().default("pending"), // pending | accepted | declined | withdrawn
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const favorites = pgTable(
  "favorites",
  {
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    listingId: integer("listing_id").notNull().references(() => listings.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.listingId] })]
);

export const reviews = pgTable("reviews", {
  id: serial().primaryKey(),
  reviewerId: integer("reviewer_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  targetId: integer("target_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  listingId: integer("listing_id").references(() => listings.id, { onDelete: "set null" }),
  stars: integer().notNull(),
  comment: text().notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const channels = pgTable("channels", {
  id: serial().primaryKey(),
  slug: text().notNull().unique(),
  name: text().notNull(),
  description: text().notNull().default(""),
  emoji: text().notNull().default("💬"),
  adminOnly: boolean("admin_only").notNull().default(false),
  locked: boolean().notNull().default(false),
  slowModeSeconds: integer("slow_mode_seconds").notNull().default(0),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const messages = pgTable(
  "messages",
  {
    id: serial().primaryKey(),
    channelId: integer("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    body: text().notNull(),
    listingId: integer("listing_id"),
    pinned: boolean().notNull().default(false),
    deleted: boolean().notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("messages_channel_idx").on(t.channelId, t.id)]
);

export const reports = pgTable("reports", {
  id: serial().primaryKey(),
  reporterId: integer("reporter_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  targetType: text("target_type").notNull(), // listing | message | user
  targetId: integer("target_id").notNull(),
  reason: text().notNull(),
  status: text().notNull().default("open"), // open | resolved | dismissed
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const announcements = pgTable("announcements", {
  id: serial().primaryKey(),
  body: text().notNull(),
  tone: text().notNull().default("info"), // info | hype | warning
  active: boolean().notNull().default(true),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const notifications = pgTable(
  "notifications",
  {
    id: serial().primaryKey(),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    body: text().notNull(),
    link: text().notNull().default(""),
    read: boolean().notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.read)]
);

export const settings = pgTable("settings", {
  key: text().primaryKey(),
  value: text().notNull(),
});

export const auditLog = pgTable("audit_log", {
  id: serial().primaryKey(),
  actorId: integer("actor_id").references(() => users.id, { onDelete: "set null" }),
  action: text().notNull(),
  detail: text().notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
