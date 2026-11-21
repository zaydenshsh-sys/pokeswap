import { useEffect, useState } from "react";
import { api, money, timeAgo } from "../api.js";
import { useApp, Trainer, Empty } from "../ui.jsx";
import ListingCard from "./ListingCard.jsx";

export default function Deals() {
  const { toast } = useApp();
  const [tab, setTab] = useState("received");
  const [offers, setOffers] = useState(null);
  const [mine, setMine] = useState(null);
  const [saved, setSaved] = useState(null);

  const load = () => {
    api("/api/offers").then(setOffers);
    api("/api/listings?mine=1&status=all&showExpired=1").then((d) => setMine(d.listings));
    api("/api/listings?favorites=1&status=all").then((d) => setSaved(d.listings));
  };
  useEffect(load, []);

  async function act(o, action) {
    try {
      await api(`/api/offers/${o.id}/${action}`, { method: "POST" });
      toast(action === "accept" ? "Accepted! Time to meet up 🤝" : "Done");
      load();
    } catch (e) {
      toast(e.message, "warn");
    }
  }

  const pendingIn = offers?.received.filter((o) => o.status === "pending").length || 0;

  return (
    <div className="page">
      <p className="eyebrow">Your trading desk</p>
      <h1>My deals 🤝</h1>
      <div className="seg tabs">
        <button className={tab === "received" ? "on" : ""} onClick={() => setTab("received")}>Offers to me {pendingIn > 0 && <b className="pill">{pendingIn}</b>}</button>
        <button className={tab === "sent" ? "on" : ""} onClick={() => setTab("sent")}>My offers</button>
        <button className={tab === "listings" ? "on" : ""} onClick={() => setTab("listings")}>My listings</button>
        <button className={tab === "saved" ? "on" : ""} onClick={() => setTab("saved")}>♥ Saved</button>
      </div>

      {tab === "received" &&
        (!offers ? <div className="ball-spin" /> : offers.received.length === 0 ? (
          <Empty icon="📬" title="No offers yet">Offers on your listings show up here.</Empty>
        ) : (
          <ul className="offer-list">
            {offers.received.map((o) => (
              <li key={o.id} className={`offer o-${o.status}`}>
                <Trainer user={o.author} size={34} />
                <div className="offer-body">
                  <a href={`#/listing/${o.listing.id}`} className="offer-listing">on "{o.listing.title}"</a>
                  <div>
                    {o.offerCents !== null && <b className="price">{money(o.offerCents)}</b>}
                    {o.offerItems && <span className="items">🔄 {o.offerItems}</span>}
                  </div>
                  {o.message && <p>"{o.message}"</p>}
                  <small className="muted">{timeAgo(o.createdAt)}</small>
                </div>
                <span className={`ostatus ${o.status}`}>{o.status}</span>
                <div className="offer-actions">
                  {o.status === "pending" && (
                    <>
                      <button className="btn btn-sm btn-primary" onClick={() => act(o, "accept")}>Accept</button>
                      <button className="btn btn-sm" onClick={() => act(o, "decline")}>Decline</button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ))}

      {tab === "sent" &&
        (!offers ? <div className="ball-spin" /> : offers.sent.length === 0 ? (
          <Empty icon="📤" title="You haven't made any offers">Browse <a href="#/pokemon">Pokémon</a> or <a href="#/snacks">snacks</a>.</Empty>
        ) : (
          <ul className="offer-list">
            {offers.sent.map((o) => (
              <li key={o.id} className={`offer o-${o.status}`}>
                <Trainer user={o.seller} size={34} />
                <div className="offer-body">
                  <a href={`#/listing/${o.listing.id}`} className="offer-listing">"{o.listing.title}"</a>
                  <div>
                    {o.offerCents !== null && <b className="price">{money(o.offerCents)}</b>}
                    {o.offerItems && <span className="items">🔄 {o.offerItems}</span>}
                  </div>
                  <small className="muted">{timeAgo(o.createdAt)}</small>
                </div>
                <span className={`ostatus ${o.status}`}>{o.status}</span>
                <div className="offer-actions">
                  {o.status === "pending" && <button className="btn btn-sm" onClick={() => act(o, "withdraw")}>Withdraw</button>}
                </div>
              </li>
            ))}
          </ul>
        ))}

      {tab === "listings" &&
        (!mine ? <div className="ball-spin" /> : mine.length === 0 ? (
          <Empty icon="🏷️" title="No listings yet"><a href="#/new?cat=pokemon">Post your first one</a></Empty>
        ) : (
          <div className="grid">{mine.map((l, i) => <ListingCard key={l.id} l={l} i={i} />)}</div>
        ))}

      {tab === "saved" &&
        (!saved ? <div className="ball-spin" /> : saved.length === 0 ? (
          <Empty icon="♡" title="Nothing saved">Tap ♡ on a listing to save it here.</Empty>
        ) : (
          <div className="grid">{saved.map((l, i) => <ListingCard key={l.id} l={l} i={i} onFav={load} />)}</div>
        ))}
    </div>
  );
}
