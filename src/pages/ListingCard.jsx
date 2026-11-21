import { money, expiryLabel, imageUrl, timeAgo, api } from "../api.js";
import { Trainer, PokeArt } from "../ui.jsx";

export const KIND = {
  sell: { label: "Selling", cls: "k-sell" },
  buy: { label: "Buying", cls: "k-buy" },
  trade: { label: "Trading", cls: "k-trade" },
};

export function KindBadge({ kind }) {
  const k = KIND[kind] || KIND.sell;
  return <span className={`kind ${k.cls}`}>{k.label}</span>;
}

export function StatusBadge({ status }) {
  if (status === "open") return null;
  const map = { pending: "🤝 Deal pending", done: "✅ Done", closed: "Closed" };
  return <span className={`status s-${status}`}>{map[status]}</span>;
}

export default function ListingCard({ l, i = 0, onFav }) {
  const exp = l.category === "snack" ? expiryLabel(l.expiresOn) : null;
  async function fav(e) {
    e.preventDefault();
    e.stopPropagation();
    const d = await api(`/api/listings/${l.id}/favorite`, { method: "POST" });
    onFav?.(l.id, d.favorite);
  }
  return (
    <a href={`#/listing/${l.id}`} className={`card listing ${l.category} ${l.featured ? "featured" : ""} ${exp?.tone === "dead" ? "expired" : ""}`} style={{ "--i": i }}>
      <div className="card-media">
        {l.imageKey ? (
          <img src={imageUrl(l.imageKey)} alt="" loading="lazy" className="photo" />
        ) : l.pokemonDex ? (
          <PokeArt dex={l.pokemonDex} className="art" />
        ) : (
          <span className="placeholder">{l.category === "snack" ? "🍬" : "🃏"}</span>
        )}
        <div className="media-tags">
          <KindBadge kind={l.kind} />
          {l.featured && <span className="feat">★ Featured</span>}
        </div>
        <button className={`fav ${l.isFavorite ? "on" : ""}`} onClick={fav} aria-label="Save">
          {l.isFavorite ? "♥" : "♡"}
        </button>
      </div>
      <div className="card-body">
        <h3>{l.title}</h3>
        <div className="card-row">
          {l.priceCents !== null ? <span className="price">{money(l.priceCents)}</span> : l.kind === "trade" ? <span className="price trade">Swap</span> : <span className="price muted">Offers</span>}
          {l.quantity > 1 && <span className="qty">×{l.quantity}</span>}
          <StatusBadge status={l.status} />
        </div>
        {l.tradeFor && <p className="wants">Wants: {l.tradeFor}</p>}
        {exp && <span className={`expiry ${exp.tone}`}>⏳ {exp.text}</span>}
        <div className="card-foot">
          <Trainer user={l.seller} size={22} />
          <span className="muted small">
            {l.meetSpot ? `📍 ${l.meetSpot}` : timeAgo(l.createdAt)}
          </span>
        </div>
        {l.offerCount > 0 && <span className="offer-count">{l.offerCount} offer{l.offerCount > 1 ? "s" : ""}</span>}
      </div>
    </a>
  );
}
