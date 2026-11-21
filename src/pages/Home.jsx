import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useApp, Avatar, AdminTag, SkeletonGrid, Empty } from "../ui.jsx";
import { onRealtime } from "../realtime.js";
import ListingCard from "./ListingCard.jsx";

export default function Home({ online }) {
  const { me, settings } = useApp();
  const [data, setData] = useState(null);
  const load = () => api("/api/home").then(setData).catch(() => {});
  useEffect(() => {
    load();
    return onRealtime((m) => m.type === "listing" && load());
  }, []);

  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Hey" : "Evening";

  return (
    <div className="page home">
      <section className="hello">
        <div>
          <p className="eyebrow">{greet}, trainer</p>
          <h1>
            {me.displayName} {me.isAdmin && <AdminTag />}
          </h1>
          <p className="lede">{settings?.welcomeMessage}</p>
        </div>
        <Avatar dex={me.avatarDex} size={96} ring />
      </section>

      <section className="stats">
        {[
          ["Trainers", data?.stats.trainers, "👥"],
          ["Pokémon up", data?.stats.pokemon, "⚡"],
          ["Snacks up", data?.stats.snacks, "🍫"],
          ["Deals done", data?.stats.deals, "🤝"],
          ["Online now", online.length, "🟢"],
        ].map(([label, n, ico], i) => (
          <div className="stat" key={label} style={{ "--i": i }}>
            <span className="stat-ico">{ico}</span>
            <b>{n ?? "–"}</b>
            <small>{label}</small>
          </div>
        ))}
      </section>

      <section className="quick">
        <a className="quick-tile qt-poke" href="#/pokemon">
          <b>Pokémon market</b>
          <span>Trade, buy, sell</span>
        </a>
        <a className="quick-tile qt-snack" href="#/snacks">
          <b>Snack shack</b>
          <span>Check expiry dates</span>
        </a>
        <a className="quick-tile qt-chat" href="#/chat/general">
          <b>Live chat</b>
          <span>{online.length} online</span>
        </a>
        <a className="quick-tile qt-deals" href="#/deals">
          <b>My deals</b>
          <span>Offers & listings</span>
        </a>
        <a className="quick-tile qt-trainers" href="#/trainers">
          <b>Find trainers</b>
          <span>Look up accounts</span>
        </a>
        <a className="quick-tile qt-admin" href="#/admin">
          <b>{me.isAdmin ? "Admin panel" : "Admin login"}</b>
          <span>{me.isAdmin ? "Run the club" : "Have the code?"}</span>
        </a>
      </section>

      {data?.expiring?.length > 0 && (
        <section>
          <div className="sec-head">
            <h2>⏳ Snacks expiring soon</h2>
            <a href="#/snacks?sort=expiring">See all</a>
          </div>
          <div className="grid">
            {data.expiring.map((l, i) => (
              <ListingCard key={l.id} l={l} i={i} />
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="sec-head">
          <h2>Fresh drops</h2>
          <a href="#/new?cat=pokemon" className="btn btn-sm">+ New listing</a>
        </div>
        {!data ? (
          <SkeletonGrid n={4} />
        ) : data.fresh.length === 0 ? (
          <Empty icon="🌱" title="Nothing listed yet">
            Be the first! <a href="#/new?cat=pokemon">List a Pokémon</a> or <a href="#/new?cat=snack">a snack</a>.
          </Empty>
        ) : (
          <div className="grid">
            {data.fresh.map((l, i) => (
              <ListingCard key={l.id} l={l} i={i} />
            ))}
          </div>
        )}
      </section>

      {online.length > 0 && (
        <section>
          <div className="sec-head">
            <h2>Who's online</h2>
          </div>
          <div className="online-row">
            {online.map((u) => (
              <a key={u.id} href={`#/u/${u.username}`} className="online-chip">
                <Avatar dex={u.avatarDex} size={30} online />
                {u.displayName}
                {u.isAdmin && <AdminTag small />}
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
