import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useApp, useRoute, SkeletonGrid, Empty, ErrorNote } from "../ui.jsx";
import { onRealtime } from "../realtime.js";
import ListingCard from "./ListingCard.jsx";

export default function Market({ category }) {
  const { settings } = useApp();
  const route = useRoute();
  const isSnack = category === "snack";
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState(route.query.get("sort") || "new");
  const [status, setStatus] = useState("active");
  const [saved, setSaved] = useState(false);
  const [mine, setMine] = useState(false);
  const [showExpired, setShowExpired] = useState(false);
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");

  const load = () => {
    const p = new URLSearchParams({ category, status, sort });
    if (kind) p.set("kind", kind);
    if (q) p.set("q", q);
    if (saved) p.set("favorites", "1");
    if (mine) p.set("mine", "1");
    if (showExpired) p.set("showExpired", "1");
    api(`/api/listings?${p}`)
      .then((d) => {
        setItems(d.listings);
        setError("");
      })
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [kind, q, sort, status, saved, mine, showExpired]);
  useEffect(() => onRealtime((m) => (m.type === "listing" || m.type === "reconnected") && load()), [kind, q, sort, status, saved, mine, showExpired]);

  const closed = isSnack ? !settings?.snackMarketOpen : !settings?.pokemonMarketOpen;

  return (
    <div className={`page market ${isSnack ? "m-snack" : "m-poke"}`}>
      <header className="market-head">
        <div>
          <p className="eyebrow">{isSnack ? "Snack shack" : "Pokémon market"}</p>
          <h1>{isSnack ? "Snacks 🍫" : "Pokémon ⚡"}</h1>
          <p className="lede">
            {isSnack
              ? "Every snack has an expiration date. Expired snacks are hidden automatically."
              : "Cards, plushies, figures, whatever. Trade, buy or sell, then meet up at school."}
          </p>
        </div>
        <a className="btn btn-primary" href={`#/new?cat=${category}`}>+ List a {isSnack ? "snack" : "Pokémon"}</a>
      </header>

      {closed && <div className="error-note">🔒 An admin closed this market for now. You can browse but not post.</div>}

      <div className="filters">
        <div className="seg">
          {[["", "All"], ["sell", "Selling"], ["buy", "Buying"], ["trade", "Trading"]].map(([v, l]) => (
            <button key={v} className={kind === v ? "on" : ""} onClick={() => setKind(v)}>{l}</button>
          ))}
        </div>
        <input className="search" placeholder={isSnack ? "Search snacks…" : "Search Pokémon, cards, wants…"} value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="new">Newest</option>
          <option value="price_low">Price: low → high</option>
          <option value="price_high">Price: high → low</option>
          <option value="popular">Most viewed</option>
          {isSnack && <option value="expiring">Expiring soonest</option>}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="active">Active</option>
          <option value="done">Completed</option>
          <option value="all">Everything</option>
        </select>
        <div className="chips">
          <button className={`chip ${saved ? "on" : ""}`} onClick={() => setSaved(!saved)}>♥ Saved</button>
          <button className={`chip ${mine ? "on" : ""}`} onClick={() => setMine(!mine)}>👤 Mine</button>
          {isSnack && (
            <button className={`chip ${showExpired ? "on" : ""}`} onClick={() => setShowExpired(!showExpired)}>💀 Show expired</button>
          )}
        </div>
      </div>

      <ErrorNote error={error} />
      {!items ? (
        <SkeletonGrid />
      ) : items.length === 0 ? (
        <Empty icon={isSnack ? "🍪" : "🃏"} title="Nothing here yet">
          Try different filters, or <a href={`#/new?cat=${category}`}>post the first one</a>.
        </Empty>
      ) : (
        <div className="grid">
          {items.map((l, i) => (
            <ListingCard key={l.id} l={l} i={i} onFav={(id, f) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, isFavorite: f } : x)))} />
          ))}
        </div>
      )}
    </div>
  );
}
