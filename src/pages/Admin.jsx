import { useEffect, useState } from "react";
import { api, money, timeAgo, expiryLabel } from "../api.js";
import { useApp, useRoute, Avatar, AdminTag, Modal, Toggle, Empty, ErrorNote, Trainer } from "../ui.jsx";
import { onRealtime } from "../realtime.js";

const TABS = [
  ["overview", "📊 Overview"],
  ["accounts", "👥 Accounts"],
  ["listings", "🏷️ Listings"],
  ["chat", "💬 Chat"],
  ["reports", "🚩 Reports"],
  ["announcements", "📣 Announce"],
  ["settings", "⚙️ Settings"],
  ["log", "📜 Log"],
];

export default function Admin({ tab, online }) {
  const { me, setMe, toast } = useApp();
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");

  if (!me.isAdmin) {
    return (
      <div className="page admin-gate">
        <div className="gate-card">
          <div className="gate-icon">🛡️</div>
          <h1>Admin panel</h1>
          <p className="muted">Enter the secret admin code to unlock admin powers and get the <AdminTag small /> tag on your account.</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setErr("");
              try {
                const d = await api("/api/admin/unlock", { method: "POST", body: { code } });
                setMe(d.user);
                toast("Welcome, admin ★");
              } catch (e) {
                setErr(e.message);
              }
            }}
          >
            <input type="password" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Admin code" autoFocus required autoComplete="off" />
            <ErrorNote error={err} />
            <button className="btn btn-primary btn-block">Unlock</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="page admin">
      <header className="admin-head">
        <div>
          <p className="eyebrow">Control room</p>
          <h1>Admin panel <AdminTag /></h1>
        </div>
      </header>
      <nav className="admin-tabs">
        {TABS.map(([k, l]) => (
          <a key={k} href={`#/admin/${k}`} className={tab === k ? "on" : ""}>{l}</a>
        ))}
      </nav>
      {tab === "overview" && <Overview online={online} />}
      {tab === "accounts" && <Accounts />}
      {tab === "listings" && <AdminListings />}
      {tab === "chat" && <AdminChat />}
      {tab === "reports" && <Reports />}
      {tab === "announcements" && <Announcements />}
      {tab === "settings" && <SiteSettings />}
      {tab === "log" && <AuditLog />}
    </div>
  );
}

function Overview({ online }) {
  const { toast } = useApp();
  const [d, setD] = useState(null);
  const [msg, setMsg] = useState("");
  const load = () => api("/api/admin/overview").then(setD);
  useEffect(() => {
    load();
  }, []);
  if (!d) return <div className="ball-spin" />;
  const s = d.stats;
  const tiles = [
    ["Trainers", s.users, "#/admin/accounts"],
    ["Admins", s.admins, "#/admin/accounts"],
    ["Online", online.length, "#/chat/general"],
    ["Active listings", s.activeListings, "#/admin/listings"],
    ["Deals done", s.deals, "#/admin/listings"],
    ["Pending offers", s.pendingOffers, null],
    ["Messages (24h)", s.messages24h, "#/admin/chat"],
    ["Open reports", s.openReports, "#/admin/reports"],
    ["Expired snacks", s.expiredSnacks, "#/admin/listings"],
    ["Banned", s.banned, "#/admin/accounts"],
  ];
  return (
    <div className="admin-body">
      <div className="admin-stats">
        {tiles.map(([l, n, href], i) => {
          const Tag = href ? "a" : "div";
          return (
            <Tag key={l} href={href || undefined} className={`astat ${l === "Open reports" && n > 0 ? "alert" : ""}`} style={{ "--i": i }}>
              <b>{n}</b>
              <small>{l}</small>
            </Tag>
          );
        })}
      </div>
      <div className="admin-cols">
        <div className="panel">
          <h3>⚡ Quick actions</h3>
          <div className="actions">
            <a className="btn btn-sm" href="#/admin/accounts?new=1">+ Create account</a>
            <a className="btn btn-sm" href="#/admin/announcements">📣 Post announcement</a>
            <button
              className="btn btn-sm"
              onClick={async () => {
                const r = await api("/api/admin/snacks/purge-expired", { method: "POST" });
                toast(`Closed ${r.closed} expired snack listing${r.closed === 1 ? "" : "s"}`);
                load();
              }}
            >
              💀 Close expired snacks
            </button>
            <a className="btn btn-sm" href="#/admin/settings">⚙️ Site settings</a>
          </div>
          <h3>📨 Notify everyone</h3>
          <form
            className="inline-form"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const r = await api("/api/admin/broadcast", { method: "POST", body: { body: msg } });
                toast(`Sent to ${r.sent} trainers`);
                setMsg("");
              } catch (e) {
                toast(e.message, "warn");
              }
            }}
          >
            <input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="e.g. Trading day is Friday at lunch!" maxLength={200} />
            <button className="btn btn-primary">Send</button>
          </form>
        </div>
        <div className="panel">
          <h3>🟢 Online now</h3>
          {online.length === 0 ? <p className="muted">Nobody else right now.</p> : (
            <div className="online-list">
              {online.map((u) => (
                <a key={u.id} href={`#/u/${u.username}`}>
                  <Avatar dex={u.avatarDex} size={26} online /> {u.displayName} {u.isAdmin && <AdminTag small />}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Accounts() {
  const { me, toast } = useApp();
  const route = useRoute();
  const [q, setQ] = useState(route.query.get("u") || "");
  const [users, setUsers] = useState(null);
  const [creating, setCreating] = useState(route.query.get("new") === "1");
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState("all");
  const load = () => api(`/api/admin/users?q=${encodeURIComponent(q)}`).then((d) => setUsers(d.users));
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [q]);

  async function patch(u, body, msg) {
    try {
      await api(`/api/admin/users/${u.id}`, { method: "PATCH", body });
      toast(msg);
      load();
    } catch (e) {
      toast(e.message, "warn");
    }
  }

  const shown = (users || []).filter((u) =>
    filter === "admins" ? u.isAdmin : filter === "banned" ? u.banned : filter === "muted" ? u.mutedUntil && new Date(u.mutedUntil) > new Date() : true
  );

  return (
    <div className="admin-body">
      <div className="filters">
        <input className="search" placeholder="Look up an account…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="seg">
          {[["all", "All"], ["admins", "Admins"], ["banned", "Banned"], ["muted", "Muted"]].map(([v, l]) => (
            <button key={v} className={filter === v ? "on" : ""} onClick={() => setFilter(v)}>{l}</button>
          ))}
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>+ Create account</button>
      </div>
      {!users ? <div className="ball-spin" /> : shown.length === 0 ? <Empty icon="👻" title="No accounts match" /> : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Trainer</th>
                <th>Status</th>
                <th>Listings</th>
                <th>Deals</th>
                <th>Joined</th>
                <th>Seen</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => {
                const muted = u.mutedUntil && new Date(u.mutedUntil) > new Date();
                return (
                  <tr key={u.id} className={u.banned ? "row-banned" : ""}>
                    <td>
                      <div className="cell-user">
                        <Avatar dex={u.avatarDex} size={34} online={u.online} />
                        <div>
                          <b>{u.displayName}</b> {u.isAdmin && <AdminTag small />}
                          <small className="muted">@{u.username}</small>
                        </div>
                      </div>
                    </td>
                    <td>
                      {u.banned ? <span className="tag t-red" title={u.banReason || ""}>⛔ Banned</span> : muted ? <span className="tag t-amber">🔇 Muted</span> : <span className="tag t-green">OK</span>}
                    </td>
                    <td>{u.listingCount}</td>
                    <td>{u.dealCount}</td>
                    <td className="muted small">{new Date(u.createdAt).toLocaleDateString()}</td>
                    <td className="muted small">{u.online ? "🟢 now" : timeAgo(u.lastSeen)}</td>
                    <td>
                      <div className="row-actions">
                        <button className="btn btn-sm" onClick={() => setEditing(u)}>Manage</button>
                        {u.id !== me.id && (
                          <button className="btn btn-sm" onClick={() => patch(u, { isAdmin: !u.isAdmin }, u.isAdmin ? "Admin removed" : "Made admin ★")}>
                            {u.isAdmin ? "− Admin" : "+ Admin"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {creating && <CreateAccount onClose={() => setCreating(false)} onDone={load} />}
      {editing && <ManageAccount user={editing} onClose={() => setEditing(null)} onDone={load} />}
    </div>
  );
}

function CreateAccount({ onClose, onDone }) {
  const { toast } = useApp();
  const [f, setF] = useState({ username: "", password: "", displayName: "", isAdmin: false });
  const [err, setErr] = useState("");
  return (
    <Modal title="Create an account" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setErr("");
          try {
            await api("/api/admin/users", { method: "POST", body: f });
            toast(`Created @${f.username.toLowerCase()} 🎉`);
            onDone();
            onClose();
          } catch (e) {
            setErr(e.message);
          }
        }}
      >
        <label className="field">
          <span>Username</span>
          <input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} required placeholder="misty_w" autoFocus />
        </label>
        <label className="field">
          <span>Password</span>
          <div className="pw-row">
            <input value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required minLength={4} />
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                const words = ["pika", "bulba", "squirt", "char", "eevee", "snorlax", "togepi", "mew"];
                setF({ ...f, password: words[Math.floor(Math.random() * words.length)] + Math.floor(100 + Math.random() * 900) });
              }}
            >
              🎲 Random
            </button>
          </div>
        </label>
        <label className="field">
          <span>Display name <small>(optional)</small></span>
          <input value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} maxLength={30} />
        </label>
        <Toggle checked={f.isAdmin} onChange={(v) => setF({ ...f, isAdmin: v })} label="Make them an admin" hint="They'll get the ★ ADMIN tag and full panel access." />
        <ErrorNote error={err} />
        <button className="btn btn-primary btn-block">Create account</button>
        <p className="muted small">Share the username + password with your friend. They can change the password later.</p>
      </form>
    </Modal>
  );
}

function ManageAccount({ user: u, onClose, onDone }) {
  const { me, toast } = useApp();
  const [f, setF] = useState({ displayName: u.displayName, username: u.username, bio: u.bio, password: "", banReason: u.banReason || "" });
  async function patch(body, msg, close = false) {
    try {
      await api(`/api/admin/users/${u.id}`, { method: "PATCH", body });
      toast(msg);
      onDone();
      if (close) onClose();
    } catch (e) {
      toast(e.message, "warn");
    }
  }
  const muted = u.mutedUntil && new Date(u.mutedUntil) > new Date();
  return (
    <Modal title={`Manage @${u.username}`} onClose={onClose} wide>
      <div className="manage-grid">
        <div>
          <label className="field">
            <span>Display name</span>
            <input value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} maxLength={30} />
          </label>
          <label className="field">
            <span>Username</span>
            <input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
          </label>
          <label className="field">
            <span>Bio</span>
            <textarea rows={2} value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} maxLength={280} />
          </label>
          <button className="btn" onClick={() => patch({ displayName: f.displayName, username: f.username, bio: f.bio }, "Saved")}>Save details</button>

          <label className="field">
            <span>Reset password</span>
            <div className="pw-row">
              <input value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder="New password" />
              <button className="btn btn-sm" disabled={f.password.length < 4} onClick={() => patch({ password: f.password }, "Password reset 🔐")}>Reset</button>
            </div>
          </label>
        </div>
        <div className="stack">
          <div className="panel">
            <h4>Role</h4>
            <Toggle
              checked={u.isAdmin}
              onChange={(v) => patch({ isAdmin: v }, v ? "Made admin ★" : "Admin removed", true)}
              label="Admin"
              hint="Admin tag + full control"
            />
          </div>
          <div className="panel">
            <h4>Chat mute {muted && <span className="tag t-amber">until {new Date(u.mutedUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>}</h4>
            <div className="actions">
              {[[10, "10m"], [60, "1h"], [1440, "1 day"], [10080, "1 week"]].map(([m, l]) => (
                <button key={m} className="btn btn-sm" onClick={() => patch({ muteMinutes: m }, `Muted ${l}`, true)}>{l}</button>
              ))}
              {muted && <button className="btn btn-sm" onClick={() => patch({ muteMinutes: 0 }, "Unmuted", true)}>Unmute</button>}
            </div>
          </div>
          {u.id !== me.id && (
            <div className="panel danger-zone">
              <h4>Danger zone</h4>
              {u.banned ? (
                <button className="btn" onClick={() => patch({ banned: false }, "Unbanned", true)}>✅ Unban</button>
              ) : (
                <>
                  <input value={f.banReason} onChange={(e) => setF({ ...f, banReason: e.target.value })} placeholder="Ban reason (shown to them)" />
                  <button className="btn btn-danger" onClick={() => patch({ banned: true, banReason: f.banReason }, "Banned ⛔", true)}>⛔ Ban account</button>
                </>
              )}
              <button
                className="btn btn-danger"
                onClick={async () => {
                  if (!confirm(`Delete @${u.username} and all their listings & messages? This can't be undone.`)) return;
                  await api(`/api/admin/users/${u.id}`, { method: "DELETE" });
                  toast("Account deleted");
                  onDone();
                  onClose();
                }}
              >
                🗑 Delete account
              </button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function AdminListings() {
  const { toast } = useApp();
  const [items, setItems] = useState(null);
  const [cat, setCat] = useState("");
  const [status, setStatus] = useState("active");
  const [q, setQ] = useState("");
  const [expired, setExpired] = useState(true);
  const load = () => {
    const p = new URLSearchParams({ status });
    if (cat) p.set("category", cat);
    if (q) p.set("q", q);
    if (expired) p.set("showExpired", "1");
    api(`/api/listings?${p}`).then((d) => setItems(d.listings));
  };
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [cat, status, q, expired]);

  async function patch(l, body, msg) {
    try {
      await api(`/api/listings/${l.id}`, { method: "PATCH", body });
      toast(msg);
      load();
    } catch (e) {
      toast(e.message, "warn");
    }
  }
  async function del(l) {
    if (!confirm(`Remove "${l.title}"?`)) return;
    await api(`/api/listings/${l.id}`, { method: "DELETE" });
    toast("Removed");
    load();
  }

  return (
    <div className="admin-body">
      <div className="filters">
        <input className="search" placeholder="Search listings…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="seg">
          {[["", "All"], ["pokemon", "⚡ Pokémon"], ["snack", "🍫 Snacks"]].map(([v, l]) => (
            <button key={v} className={cat === v ? "on" : ""} onClick={() => setCat(v)}>{l}</button>
          ))}
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="active">Active</option>
          <option value="done">Done</option>
          <option value="closed">Closed</option>
          <option value="all">All</option>
        </select>
        <button className={`chip ${expired ? "on" : ""}`} onClick={() => setExpired(!expired)}>Include expired</button>
      </div>
      {!items ? <div className="ball-spin" /> : items.length === 0 ? <Empty icon="🏷️" title="No listings" /> : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Listing</th><th>Seller</th><th>Type</th><th>Price</th><th>Status</th><th>Expiry</th><th></th></tr>
            </thead>
            <tbody>
              {items.map((l) => {
                const exp = l.category === "snack" ? expiryLabel(l.expiresOn) : null;
                return (
                  <tr key={l.id}>
                    <td><a href={`#/listing/${l.id}`}><b>{l.featured && "★ "}{l.title}</b></a><small className="muted"> {l.category === "snack" ? "🍫" : "⚡"} · {l.views} views · {l.offerCount} offers</small></td>
                    <td><Trainer user={l.seller} size={22} /></td>
                    <td>{l.kind}</td>
                    <td>{money(l.priceCents) || "–"}</td>
                    <td>
                      <select value={l.status} onChange={(e) => patch(l, { status: e.target.value }, "Status changed")}>
                        <option value="open">open</option>
                        <option value="pending">pending</option>
                        <option value="done">done</option>
                        <option value="closed">closed</option>
                      </select>
                    </td>
                    <td>{exp ? <span className={`expiry ${exp.tone}`}>{exp.text}</span> : "–"}</td>
                    <td>
                      <div className="row-actions">
                        <button className="btn btn-sm" onClick={() => patch(l, { featured: !l.featured }, l.featured ? "Unfeatured" : "Featured ★")}>{l.featured ? "Unfeature" : "★"}</button>
                        <a className="btn btn-sm" href={`#/listing/${l.id}/edit`}>Edit</a>
                        <button className="btn btn-sm btn-danger" onClick={() => del(l)}>🗑</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AdminChat() {
  const { toast } = useApp();
  const [channels, setChannels] = useState(null);
  const [n, setN] = useState({ name: "", emoji: "💬", description: "", adminOnly: false });
  const load = () => api("/api/channels").then((d) => setChannels(d.channels));
  useEffect(() => {
    load();
    return onRealtime((m) => m.type === "channels" && load());
  }, []);
  async function patch(c, body, msg) {
    try {
      await api(`/api/admin/channels/${c.id}`, { method: "PATCH", body });
      toast(msg);
      load();
    } catch (e) {
      toast(e.message, "warn");
    }
  }
  return (
    <div className="admin-body admin-cols">
      <div className="stack">
        {!channels ? <div className="ball-spin" /> : channels.map((c) => (
          <div key={c.id} className="panel chan-admin">
            <div className="chan-admin-head">
              <h3>{c.emoji} {c.name} <small className="muted">#{c.slug}</small></h3>
              <a className="btn btn-sm" href={`#/chat/${c.slug}`}>Open</a>
            </div>
            <div className="toggles">
              <Toggle checked={c.locked} onChange={(v) => patch(c, { locked: v }, v ? "Locked 🔒" : "Unlocked")} label="Locked" hint="Nobody but admins can post" />
              <Toggle checked={c.adminOnly} onChange={(v) => patch(c, { adminOnly: v }, "Updated")} label="Admins-only posting" />
            </div>
            <div className="field">
              <span>Slow mode</span>
              <div className="chips">
                {[0, 5, 15, 30, 60, 300].map((s) => (
                  <button key={s} className={`chip ${c.slowModeSeconds === s ? "on" : ""}`} onClick={() => patch(c, { slowModeSeconds: s }, s ? `Slow mode ${s}s` : "Slow mode off")}>
                    {s === 0 ? "Off" : s < 60 ? `${s}s` : `${s / 60}m`}
                  </button>
                ))}
              </div>
            </div>
            <div className="actions">
              <button
                className="btn btn-sm"
                onClick={() => {
                  const name = prompt("Channel name", c.name);
                  if (name) patch(c, { name }, "Renamed");
                }}
              >
                Rename
              </button>
              <button
                className="btn btn-sm"
                onClick={async () => {
                  if (!confirm(`Delete ALL messages in #${c.slug}?`)) return;
                  await api(`/api/admin/channels/${c.id}/clear`, { method: "POST" });
                  toast("Channel cleared");
                }}
              >
                🧹 Clear messages
              </button>
              {c.slug !== "general" && (
                <button
                  className="btn btn-sm btn-danger"
                  onClick={async () => {
                    if (!confirm(`Delete #${c.slug}?`)) return;
                    await api(`/api/admin/channels/${c.id}`, { method: "DELETE" });
                    toast("Channel deleted");
                    load();
                  }}
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <form
        className="panel"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api("/api/admin/channels", { method: "POST", body: n });
            toast("Channel created");
            setN({ name: "", emoji: "💬", description: "", adminOnly: false });
            load();
          } catch (e) {
            toast(e.message, "warn");
          }
        }}
      >
        <h3>+ New channel</h3>
        <div className="row2">
          <label className="field" style={{ maxWidth: 90 }}>
            <span>Emoji</span>
            <input value={n.emoji} onChange={(e) => setN({ ...n, emoji: e.target.value })} maxLength={4} />
          </label>
          <label className="field">
            <span>Name</span>
            <input value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} required maxLength={30} placeholder="Card Battles" />
          </label>
        </div>
        <label className="field">
          <span>Description</span>
          <input value={n.description} onChange={(e) => setN({ ...n, description: e.target.value })} maxLength={120} />
        </label>
        <Toggle checked={n.adminOnly} onChange={(v) => setN({ ...n, adminOnly: v })} label="Admins-only posting" />
        <button className="btn btn-primary btn-block">Create channel</button>
      </form>
    </div>
  );
}

function Reports() {
  const { toast } = useApp();
  const [items, setItems] = useState(null);
  const load = () => api("/api/admin/reports").then((d) => setItems(d.reports));
  useEffect(() => {
    load();
    return onRealtime((m) => m.type === "report" && load());
  }, []);
  async function set(r, status) {
    await api(`/api/admin/reports/${r.id}`, { method: "PATCH", body: { status } });
    toast(`Report ${status}`);
    load();
  }
  async function removeTarget(r) {
    if (r.targetType === "listing") await api(`/api/listings/${r.targetId}`, { method: "DELETE" }).catch(() => {});
    if (r.targetType === "message") await api(`/api/messages/${r.targetId}`, { method: "DELETE" }).catch(() => {});
    await set(r, "resolved");
  }
  if (!items) return <div className="ball-spin" />;
  if (items.length === 0) return <Empty icon="😇" title="No reports">Everyone's behaving.</Empty>;
  return (
    <div className="admin-body">
      <ul className="reports">
        {items.map((r) => (
          <li key={r.id} className={`report r-${r.status}`}>
            <div className="report-top">
              <span className="tag">{r.targetType}</span>
              <span className={`tag ${r.status === "open" ? "t-red" : "t-green"}`}>{r.status}</span>
              <small className="muted">by {r.reporter.displayName} · {timeAgo(r.createdAt)}</small>
            </div>
            <p className="report-reason">"{r.reason}"</p>
            <p className="report-target">{r.link ? <a href={r.link}>{r.preview}</a> : r.preview}</p>
            {r.status === "open" && (
              <div className="actions">
                {r.targetType !== "user" && <button className="btn btn-sm btn-danger" onClick={() => removeTarget(r)}>Remove {r.targetType}</button>}
                <button className="btn btn-sm" onClick={() => set(r, "resolved")}>Mark resolved</button>
                <button className="btn btn-sm btn-ghost" onClick={() => set(r, "dismissed")}>Dismiss</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Announcements() {
  const { toast } = useApp();
  const [items, setItems] = useState(null);
  const [body, setBody] = useState("");
  const [tone, setTone] = useState("info");
  const load = () => api("/api/admin/announcements").then((d) => setItems(d.announcements));
  useEffect(() => {
    load();
  }, []);
  return (
    <div className="admin-body admin-cols">
      <form
        className="panel"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api("/api/admin/announcements", { method: "POST", body: { body, tone } });
            setBody("");
            toast("Announcement is live 📣");
            load();
          } catch (e) {
            toast(e.message, "warn");
          }
        }}
      >
        <h3>New banner announcement</h3>
        <p className="muted small">Shows as a banner at the top of every page.</p>
        <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={300} placeholder="Big trade day Friday at the lunch tables!" required />
        <div className="seg">
          {[["info", "📣 Info"], ["hype", "🎉 Hype"], ["warning", "⚠️ Warning"]].map(([v, l]) => (
            <button type="button" key={v} className={tone === v ? "on" : ""} onClick={() => setTone(v)}>{l}</button>
          ))}
        </div>
        <div className={`announce ${tone} preview`}><span>{tone === "warning" ? "⚠️" : tone === "hype" ? "🎉" : "📣"}</span><p>{body || "Preview…"}</p></div>
        <button className="btn btn-primary btn-block">Post announcement</button>
      </form>
      <div className="stack">
        {!items ? <div className="ball-spin" /> : items.length === 0 ? <Empty icon="📣" title="No announcements yet" /> : items.map((a) => (
          <div key={a.id} className={`announce ${a.tone} ${a.active ? "" : "off"}`}>
            <span>{a.tone === "warning" ? "⚠️" : a.tone === "hype" ? "🎉" : "📣"}</span>
            <p>{a.body}<br /><small className="muted">{timeAgo(a.createdAt)}</small></p>
            <div className="row-actions">
              <button className="btn btn-sm" onClick={async () => { await api(`/api/admin/announcements/${a.id}`, { method: "PATCH", body: { active: !a.active } }); load(); }}>
                {a.active ? "Hide" : "Show"}
              </button>
              <button className="btn btn-sm btn-danger" onClick={async () => { await api(`/api/admin/announcements/${a.id}`, { method: "DELETE" }); load(); }}>🗑</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SiteSettings() {
  const { toast, refreshMe } = useApp();
  const [s, setS] = useState(null);
  const [spot, setSpot] = useState("");
  const [code, setCode] = useState("");
  useEffect(() => {
    api("/api/admin/settings").then((d) => setS({ ...d.settings, maxPrice: d.settings.maxPriceCents / 100 }));
  }, []);
  async function save(body, msg = "Saved") {
    try {
      const d = await api("/api/admin/settings", { method: "PATCH", body });
      setS({ ...d.settings, maxPrice: d.settings.maxPriceCents / 100 });
      toast(msg);
      refreshMe();
    } catch (e) {
      toast(e.message, "warn");
    }
  }
  if (!s) return <div className="ball-spin" />;
  return (
    <div className="admin-body admin-cols">
      <div className="stack">
        <div className="panel">
          <h3>🔀 Switches</h3>
          <Toggle checked={s.signupsOpen} onChange={(v) => save({ signupsOpen: v })} label="Open sign-ups" hint="When off, only admins can create accounts." />
          <Toggle checked={s.pokemonMarketOpen} onChange={(v) => save({ pokemonMarketOpen: v })} label="Pokémon market open" hint="Allow new Pokémon listings." />
          <Toggle checked={s.snackMarketOpen} onChange={(v) => save({ snackMarketOpen: v })} label="Snack market open" hint="Allow new snack listings." />
          <Toggle checked={s.chatOpen} onChange={(v) => save({ chatOpen: v })} label="Live chat on" hint="When off, only admins can talk." />
        </div>
        <div className="panel">
          <h3>🔑 Admin code</h3>
          <p className="muted small">Change the secret code people use to unlock the admin panel. Existing admins stay admins.</p>
          <form className="inline-form" onSubmit={(e) => { e.preventDefault(); save({ newAdminCode: code }, "Admin code changed 🔑"); setCode(""); }}>
            <input type="password" value={code} onChange={(e) => setCode(e.target.value)} placeholder="New admin code" minLength={4} required autoComplete="off" />
            <button className="btn">Change</button>
          </form>
        </div>
      </div>
      <div className="stack">
        <form className="panel" onSubmit={(e) => { e.preventDefault(); save({ siteName: s.siteName, tagline: s.tagline, welcomeMessage: s.welcomeMessage, maxPriceCents: Math.round(Number(s.maxPrice) * 100) }); }}>
          <h3>🎨 Club info</h3>
          <label className="field"><span>Club name</span><input value={s.siteName} onChange={(e) => setS({ ...s, siteName: e.target.value })} maxLength={40} /></label>
          <label className="field"><span>Tagline (login page)</span><input value={s.tagline} onChange={(e) => setS({ ...s, tagline: e.target.value })} maxLength={200} /></label>
          <label className="field"><span>Welcome message (home page)</span><input value={s.welcomeMessage} onChange={(e) => setS({ ...s, welcomeMessage: e.target.value })} maxLength={200} /></label>
          <label className="field"><span>Max price per listing ($)</span><input type="number" min="1" step="1" value={s.maxPrice} onChange={(e) => setS({ ...s, maxPrice: e.target.value })} /></label>
          <button className="btn btn-primary">Save club info</button>
        </form>
        <div className="panel">
          <h3>📍 Meet-up spots</h3>
          <div className="chips">
            {s.meetSpots.map((m) => (
              <span key={m} className="chip on">
                {m} <button className="x" onClick={() => save({ meetSpots: s.meetSpots.filter((x) => x !== m) }, "Removed")}>✕</button>
              </span>
            ))}
          </div>
          <form className="inline-form" onSubmit={(e) => { e.preventDefault(); if (spot.trim()) save({ meetSpots: [...s.meetSpots, spot.trim()] }, "Added"); setSpot(""); }}>
            <input value={spot} onChange={(e) => setSpot(e.target.value)} placeholder="Cafeteria line" maxLength={40} />
            <button className="btn">Add</button>
          </form>
        </div>
      </div>
    </div>
  );
}

function AuditLog() {
  const [items, setItems] = useState(null);
  useEffect(() => {
    api("/api/admin/audit").then((d) => setItems(d.entries));
  }, []);
  if (!items) return <div className="ball-spin" />;
  if (items.length === 0) return <Empty icon="📜" title="Nothing logged yet" />;
  return (
    <div className="admin-body">
      <ul className="audit">
        {items.map((e) => (
          <li key={e.id}>
            <time>{timeAgo(e.createdAt)}</time>
            <b>{e.actor?.displayName || "system"}</b>
            <span className="tag">{e.action}</span>
            <span>{e.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
