import { useEffect, useState } from "react";
import { api, timeAgo, artwork } from "../api.js";
import { useApp, Avatar, AdminTag, Empty, TYPE_COLORS } from "../ui.jsx";
import ListingCard from "./ListingCard.jsx";
import { Stars } from "./Trainers.jsx";
import { ReportButton, ReviewModal } from "./ListingDetail.jsx";
import { ModModal } from "./Chat.jsx";

export default function Profile({ username }) {
  const { me } = useApp();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("listings");
  const [review, setReview] = useState(false);
  const [mod, setMod] = useState(false);
  const load = () => api(`/api/users/${username}`).then(setData).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, [username]);

  if (error) return <div className="page"><Empty icon="👻" title="Trainer not found">{error}</Empty></div>;
  if (!data) return <div className="page"><div className="ball-spin" /></div>;
  const { user: u, listings, reviews } = data;
  const isMe = u.id === me.id;
  const active = listings.filter((l) => ["open", "pending"].includes(l.status));
  const done = listings.filter((l) => l.status === "done");

  return (
    <div className="page profile">
      <section className={`profile-hero ${u.isAdmin ? "is-admin" : ""}`} style={{ "--tc": TYPE_COLORS[u.favoriteType] }}>
        <img className="profile-art" src={artwork(u.avatarDex)} alt="" />
        <div className="profile-id">
          <Avatar dex={u.avatarDex} size={88} ring online={u.online} />
          <div>
            <h1>
              {u.displayName} {u.isAdmin && <AdminTag />}
            </h1>
            <p className="muted">@{u.username} · {u.favoriteType} type fan · joined {new Date(u.createdAt).toLocaleDateString()}</p>
            <p className="muted small">{u.online ? "🟢 Online now" : `Last seen ${timeAgo(u.lastSeen)}`}{u.banned && " · ⛔ Banned"}</p>
          </div>
        </div>
        {u.bio && <p className="bio">"{u.bio}"</p>}
        <div className="profile-stats">
          <div><b>{u.listingCount}</b><small>active listings</small></div>
          <div><b>{u.dealCount}</b><small>deals done</small></div>
          <div><b>{u.reviewCount}</b><small>reviews</small></div>
          <div><Stars value={u.rating} /><small>rating</small></div>
        </div>
        <div className="actions">
          {isMe ? (
            <a className="btn btn-sm" href="#/me">✏️ Edit profile</a>
          ) : (
            <>
              <button className="btn btn-sm" onClick={() => setReview(true)}>⭐ Leave review</button>
              <a className="btn btn-sm" href="#/chat/general" onClick={() => sessionStorage.setItem("draft", `@${u.username} `)}>💬 Ping in chat</a>
              <ReportButton type="user" id={u.id} />
              {me.isAdmin && <button className="btn btn-sm" onClick={() => setMod(true)}>🛡️ Moderate</button>}
              {me.isAdmin && <a className="btn btn-sm" href={`#/admin/accounts?u=${u.username}`}>Manage account</a>}
            </>
          )}
        </div>
      </section>

      <div className="seg tabs">
        <button className={tab === "listings" ? "on" : ""} onClick={() => setTab("listings")}>Active ({active.length})</button>
        <button className={tab === "done" ? "on" : ""} onClick={() => setTab("done")}>Completed ({done.length})</button>
        <button className={tab === "reviews" ? "on" : ""} onClick={() => setTab("reviews")}>Reviews ({reviews.length})</button>
      </div>

      {tab !== "reviews" ? (
        (tab === "listings" ? active : done).length === 0 ? (
          <Empty icon="📭" title="Nothing here" />
        ) : (
          <div className="grid">
            {(tab === "listings" ? active : done).map((l, i) => (
              <ListingCard key={l.id} l={l} i={i} />
            ))}
          </div>
        )
      ) : reviews.length === 0 ? (
        <Empty icon="⭐" title="No reviews yet" />
      ) : (
        <ul className="reviews">
          {reviews.map((r) => (
            <li key={r.id}>
              <Avatar dex={r.author.avatarDex} size={34} />
              <div>
                <b>{r.author.displayName}</b> {r.author.isAdmin && <AdminTag small />} <Stars value={r.stars} />
                {r.comment && <p>{r.comment}</p>}
                <small className="muted">{timeAgo(r.createdAt)}</small>
              </div>
            </li>
          ))}
        </ul>
      )}
      {review && <ReviewModal target={u} onClose={() => { setReview(false); load(); }} />}
      {mod && <ModModal user={u} onClose={() => { setMod(false); load(); }} />}
    </div>
  );
}
