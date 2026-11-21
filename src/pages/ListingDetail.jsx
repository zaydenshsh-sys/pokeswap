import { useEffect, useState } from "react";
import { api, money, expiryLabel, imageUrl, timeAgo } from "../api.js";
import { useApp, Trainer, PokeArt, Modal, ErrorNote, Empty, AdminTag } from "../ui.jsx";
import { KindBadge, StatusBadge } from "./ListingCard.jsx";

export function ReportButton({ type, id, label = "🚩 Report" }) {
  const { toast } = useApp();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <>
      <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>{label}</button>
      {open && (
        <Modal title="Report to admins" onClose={() => setOpen(false)}>
          <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What's wrong? (scam, rude, fake, etc.)" />
          <button
            className="btn btn-primary btn-block"
            onClick={async () => {
              try {
                await api("/api/reports", { method: "POST", body: { targetType: type, targetId: id, reason } });
                toast("Thanks, admins will take a look.");
                setOpen(false);
              } catch (e) {
                toast(e.message, "warn");
              }
            }}
          >
            Send report
          </button>
        </Modal>
      )}
    </>
  );
}

export function ReviewModal({ target, listingId, onClose }) {
  const { toast } = useApp();
  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState("");
  return (
    <Modal title={`Review ${target.displayName}`} onClose={onClose}>
      <div className="stars-pick">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} className={n <= stars ? "on" : ""} onClick={() => setStars(n)}>★</button>
        ))}
      </div>
      <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="How was the deal?" maxLength={300} />
      <button
        className="btn btn-primary btn-block"
        onClick={async () => {
          try {
            await api(`/api/users/${target.id}/reviews`, { method: "POST", body: { stars, comment, listingId } });
            toast("Review posted ⭐");
            onClose();
          } catch (e) {
            toast(e.message, "warn");
          }
        }}
      >
        Post review
      </button>
    </Modal>
  );
}

export default function ListingDetail({ id }) {
  const { me, toast } = useApp();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [offer, setOffer] = useState({ amount: "", items: "", message: "" });
  const [offerErr, setOfferErr] = useState("");
  const [review, setReview] = useState(null);

  const load = () =>
    api(`/api/listings/${id}`)
      .then(setData)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, [id]);

  if (error) return <div className="page"><Empty icon="💨" title="Listing not found">{error}</Empty></div>;
  if (!data) return <div className="page"><div className="ball-spin" /></div>;

  const { listing: l, offers } = data;
  const mine = l.userId === me.id;
  const canManage = mine || me.isAdmin;
  const exp = l.category === "snack" ? expiryLabel(l.expiresOn) : null;
  const myAccepted = offers.find((o) => o.userId === me.id && o.status === "accepted");

  async function patch(body, msg) {
    try {
      await api(`/api/listings/${l.id}`, { method: "PATCH", body });
      toast(msg);
      load();
    } catch (e) {
      toast(e.message, "warn");
    }
  }
  async function del() {
    if (!confirm("Delete this listing for good?")) return;
    await api(`/api/listings/${l.id}`, { method: "DELETE" });
    toast("Listing deleted");
    location.hash = l.category === "snack" ? "#/snacks" : "#/pokemon";
  }
  async function offerAction(o, action) {
    try {
      await api(`/api/offers/${o.id}/${action}`, { method: "POST" });
      toast(action === "accept" ? "Offer accepted! Go meet up 🤝" : action === "decline" ? "Offer declined" : "Offer withdrawn");
      load();
    } catch (e) {
      toast(e.message, "warn");
    }
  }
  async function sendOffer(e) {
    e.preventDefault();
    setOfferErr("");
    try {
      await api(`/api/listings/${l.id}/offers`, {
        method: "POST",
        body: { offerCents: offer.amount === "" ? null : Math.round(Number(offer.amount) * 100), offerItems: offer.items, message: offer.message },
      });
      setOffer({ amount: "", items: "", message: "" });
      toast("Offer sent!");
      load();
    } catch (err) {
      setOfferErr(err.message);
    }
  }
  async function share() {
    const slug = l.category === "snack" ? "snack-shack" : "pokemon-trades";
    try {
      await api(`/api/channels/${slug}/messages`, { method: "POST", body: { body: `Check out my listing: ${l.title}`, listingId: l.id } });
      toast("Shared to chat");
      location.hash = `#/chat/${slug}`;
    } catch (e) {
      toast(e.message, "warn");
    }
  }
  async function fav() {
    const d = await api(`/api/listings/${l.id}/favorite`, { method: "POST" });
    setData({ ...data, listing: { ...l, isFavorite: d.favorite } });
  }

  return (
    <div className={`page detail ${l.category}`}>
      <a className="back" href={l.category === "snack" ? "#/snacks" : "#/pokemon"}>← Back to {l.category === "snack" ? "snacks" : "Pokémon"}</a>
      <div className="detail-grid">
        <div className="detail-media">
          {l.imageKey ? <img src={imageUrl(l.imageKey)} alt="" /> : l.pokemonDex ? <PokeArt dex={l.pokemonDex} /> : <span className="placeholder">{l.category === "snack" ? "🍬" : "🃏"}</span>}
          {l.imageKey && l.pokemonDex && <PokeArt dex={l.pokemonDex} className="mini-art" />}
        </div>

        <div className="detail-info">
          <div className="tags">
            <KindBadge kind={l.kind} />
            <StatusBadge status={l.status} />
            {l.featured && <span className="feat">★ Featured</span>}
          </div>
          <h1>{l.title}</h1>
          <div className="price-row">
            {l.priceCents !== null ? <span className="price big">{money(l.priceCents)}</span> : <span className="price big trade">{l.kind === "trade" ? "Swap only" : "Make an offer"}</span>}
            {l.quantity > 1 && <span className="qty">×{l.quantity} available</span>}
          </div>
          {exp && <div className={`expiry big ${exp.tone}`}>⏳ {exp.text} · {l.expiresOn}</div>}

          <dl className="facts">
            {l.tradeFor && (<><dt>Wants</dt><dd>{l.tradeFor}</dd></>)}
            {l.condition && (<><dt>Condition</dt><dd>{l.condition}</dd></>)}
            <dt>Meet-up</dt><dd>📍 {l.meetSpot || "Anywhere at school"}</dd>
            <dt>Posted</dt><dd>{timeAgo(l.createdAt)} · {l.views} views · {l.favCount} saves</dd>
          </dl>
          {l.description && <p className="desc">{l.description}</p>}

          <div className="seller-box">
            <Trainer user={l.seller} size={44} />
            <a className="btn btn-sm" href={`#/u/${l.seller.username}`}>View profile</a>
          </div>

          <div className="actions">
            <button className={`btn btn-sm ${l.isFavorite ? "btn-on" : ""}`} onClick={fav}>{l.isFavorite ? "♥ Saved" : "♡ Save"}</button>
            {mine && <button className="btn btn-sm" onClick={share}>💬 Share to chat</button>}
            {!mine && <ReportButton type="listing" id={l.id} />}
            {myAccepted && l.status === "done" && (
              <button className="btn btn-sm" onClick={() => setReview(l.seller)}>⭐ Review seller</button>
            )}
          </div>

          {canManage && (
            <div className="manage">
              <h4>{mine ? "Manage your listing" : <>Admin controls <AdminTag small /></>}</h4>
              <div className="actions">
                <a className="btn btn-sm" href={`#/listing/${l.id}/edit`}>✏️ Edit</a>
                {l.status !== "done" && <button className="btn btn-sm" onClick={() => patch({ status: "done" }, "Marked as done ✅")}>✅ Mark done</button>}
                {l.status !== "open" && <button className="btn btn-sm" onClick={() => patch({ status: "open" }, "Re-opened")}>↺ Re-open</button>}
                {l.status === "open" && <button className="btn btn-sm" onClick={() => patch({ status: "closed" }, "Closed")}>Close</button>}
                {me.isAdmin && (
                  <button className="btn btn-sm" onClick={() => patch({ featured: !l.featured }, l.featured ? "Unfeatured" : "Featured ★")}>
                    {l.featured ? "Unfeature" : "★ Feature"}
                  </button>
                )}
                <button className="btn btn-sm btn-danger" onClick={del}>🗑 Delete</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <section className="offers">
        <h2>{canManage ? `Offers (${offers.length})` : "Your offers"}</h2>

        {!mine && ["open", "pending"].includes(l.status) && (
          <form className="offer-form" onSubmit={sendOffer}>
            <h3>{l.kind === "buy" ? "I have this!" : l.kind === "trade" ? "Propose a trade" : "Make an offer"}</h3>
            <div className="row3">
              <label className="field">
                <span>Cash ($)</span>
                <input type="number" min="0" step="0.01" value={offer.amount} onChange={(e) => setOffer({ ...offer, amount: e.target.value })} placeholder={l.priceCents ? (l.priceCents / 100).toString() : "0"} />
              </label>
              <label className="field">
                <span>Items to trade</span>
                <input value={offer.items} onChange={(e) => setOffer({ ...offer, items: e.target.value })} placeholder="Pikachu card + Skittles" maxLength={200} />
              </label>
            </div>
            <label className="field">
              <span>Message</span>
              <input value={offer.message} onChange={(e) => setOffer({ ...offer, message: e.target.value })} placeholder="Can meet at lunch tomorrow" maxLength={500} />
            </label>
            <ErrorNote error={offerErr} />
            <button className="btn btn-primary">Send offer</button>
          </form>
        )}

        {offers.length === 0 ? (
          <p className="muted">{canManage ? "No offers yet. Share it in chat to get eyes on it!" : "You haven't made an offer yet."}</p>
        ) : (
          <ul className="offer-list">
            {offers.map((o) => (
              <li key={o.id} className={`offer o-${o.status}`}>
                <Trainer user={o.author} size={34} />
                <div className="offer-body">
                  <div>
                    {o.offerCents !== null && <b className="price">{money(o.offerCents)}</b>}
                    {o.offerItems && <span className="items">🔄 {o.offerItems}</span>}
                  </div>
                  {o.message && <p>"{o.message}"</p>}
                  <small className="muted">{timeAgo(o.createdAt)}</small>
                </div>
                <span className={`ostatus ${o.status}`}>{o.status}</span>
                <div className="offer-actions">
                  {canManage && o.status === "pending" && (
                    <>
                      <button className="btn btn-sm btn-primary" onClick={() => offerAction(o, "accept")}>Accept</button>
                      <button className="btn btn-sm" onClick={() => offerAction(o, "decline")}>Decline</button>
                    </>
                  )}
                  {o.userId === me.id && o.status === "pending" && (
                    <button className="btn btn-sm" onClick={() => offerAction(o, "withdraw")}>Withdraw</button>
                  )}
                  {mine && o.status === "accepted" && l.status === "done" && (
                    <button className="btn btn-sm" onClick={() => setReview(o.author)}>⭐ Review</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {review && <ReviewModal target={review} listingId={l.id} onClose={() => setReview(null)} />}
    </div>
  );
}
