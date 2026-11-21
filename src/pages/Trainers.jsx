import { useEffect, useState } from "react";
import { api, timeAgo } from "../api.js";
import { Avatar, AdminTag, Empty, TYPE_COLORS } from "../ui.jsx";

export function Stars({ value }) {
  if (value === null || value === undefined) return <span className="muted small">No reviews</span>;
  return (
    <span className="stars" title={`${value} / 5`}>
      {"★".repeat(Math.round(value))}
      <i>{"★".repeat(5 - Math.round(value))}</i> <small>{value}</small>
    </span>
  );
}

export default function Trainers() {
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [users, setUsers] = useState(null);
  useEffect(() => {
    const t = setTimeout(() => {
      const p = new URLSearchParams();
      if (q) p.set("q", q);
      if (role) p.set("role", role);
      api(`/api/users?${p}`).then((d) => setUsers(d.users));
    }, 200);
    return () => clearTimeout(t);
  }, [q, role]);

  return (
    <div className="page">
      <p className="eyebrow">Account lookup</p>
      <h1>Trainers 🔎</h1>
      <div className="filters">
        <input className="search" placeholder="Search by username or name…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <div className="seg">
          <button className={role === "" ? "on" : ""} onClick={() => setRole("")}>Everyone</button>
          <button className={role === "admin" ? "on" : ""} onClick={() => setRole("admin")}>★ Admins</button>
        </div>
      </div>
      {!users ? (
        <div className="ball-spin" />
      ) : users.length === 0 ? (
        <Empty icon="👻" title="No trainers found" />
      ) : (
        <div className="trainer-grid">
          {users.map((u, i) => (
            <a key={u.id} href={`#/u/${u.username}`} className={`trainer-card ${u.isAdmin ? "is-admin" : ""}`} style={{ "--i": i, "--tc": TYPE_COLORS[u.favoriteType] }}>
              <Avatar dex={u.avatarDex} size={64} online={u.online} />
              <div>
                <h3>{u.displayName} {u.isAdmin && <AdminTag small />}</h3>
                <p className="muted small">@{u.username}{u.banned && " · ⛔ banned"}</p>
                <div className="tc-stats">
                  <span>{u.listingCount} active</span>
                  <span>{u.dealCount} deals</span>
                  <Stars value={u.rating} />
                </div>
                <p className="muted small">{u.online ? "🟢 Online now" : `Seen ${timeAgo(u.lastSeen)}`}</p>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
