import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import { startRealtime, stopRealtime, onRealtime, onStatus } from "./realtime.js";
import { AppCtx, useRoute, go, Avatar, AdminTag } from "./ui.jsx";
import AuthPage from "./pages/Auth.jsx";
import Home from "./pages/Home.jsx";
import Market from "./pages/Market.jsx";
import ListingForm from "./pages/ListingForm.jsx";
import ListingDetail from "./pages/ListingDetail.jsx";
import Chat from "./pages/Chat.jsx";
import Trainers from "./pages/Trainers.jsx";
import Profile from "./pages/Profile.jsx";
import Deals from "./pages/Deals.jsx";
import Settings from "./pages/MySettings.jsx";
import Admin from "./pages/Admin.jsx";
import Notifications from "./pages/Notifications.jsx";

export default function App() {
  const [me, setMe] = useState(undefined);
  const [settings, setSettings] = useState(null);
  const [unread, setUnread] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [dismissed, setDismissed] = useState(() => JSON.parse(localStorage.getItem("dismissed-ann") || "[]"));
  const [live, setLive] = useState("offline");
  const [online, setOnline] = useState([]);
  const route = useRoute();

  const toast = useCallback((text, tone = "ok") => {
    const id = Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const refreshMe = useCallback(async () => {
    try {
      const d = await api("/api/me");
      setMe(d.user);
      setSettings(d.settings);
      setUnread(d.unread || 0);
    } catch {
      setMe(null);
    }
  }, []);

  const loadAnnouncements = useCallback(() => {
    api("/api/announcements").then((d) => setAnnouncements(d.announcements)).catch(() => {});
  }, []);

  useEffect(() => {
    refreshMe();
    loadAnnouncements();
  }, [refreshMe, loadAnnouncements]);

  useEffect(() => {
    if (!me) {
      stopRealtime();
      return;
    }
    startRealtime();
    const offS = onStatus(setLive);
    const off = onRealtime((m) => {
      if (m.type === "hello" || m.type === "presence") setOnline(m.online);
      if (m.type === "notification") {
        setUnread((n) => n + 1);
        toast(m.body, "info");
      }
      if (m.type === "announcement") loadAnnouncements();
      if (m.type === "settings") refreshMe();
      if (m.type === "report" && me.isAdmin) toast("🚩 New report in the admin queue", "warn");
      if (m.type === "kicked") {
        toast(m.reason || "You were signed out.", "warn");
        setMe(null);
      }
    });
    return () => {
      off();
      offS();
    };
  }, [me?.id, me?.isAdmin, toast, loadAnnouncements, refreshMe]);

  if (me === undefined) {
    return (
      <div className="boot">
        <div className="ball-spin" />
      </div>
    );
  }

  const [page, ...rest] = route.parts;

  if (!me) {
    return (
      <AppCtx.Provider value={{ me, setMe, settings, toast, refreshMe }}>
        <AuthPage admin={page === "admin" || page === "admin-login"} />
        <Toasts toasts={toasts} />
      </AppCtx.Provider>
    );
  }

  let view;
  switch (page) {
    case undefined:
      view = <Home online={online} />;
      break;
    case "pokemon":
      view = <Market category="pokemon" key="pokemon" />;
      break;
    case "snacks":
      view = <Market category="snack" key="snack" />;
      break;
    case "new":
      view = <ListingForm category={route.query.get("cat") || "pokemon"} key={route.hash} />;
      break;
    case "listing":
      view = rest[1] === "edit" ? <ListingForm editId={rest[0]} key={route.hash} /> : <ListingDetail id={rest[0]} key={rest[0]} />;
      break;
    case "chat":
      view = <Chat slug={rest[0] || "general"} online={online} />;
      break;
    case "trainers":
      view = <Trainers online={online} />;
      break;
    case "u":
      view = <Profile username={rest[0]} key={rest[0]} online={online} />;
      break;
    case "deals":
      view = <Deals />;
      break;
    case "me":
      view = <Settings />;
      break;
    case "notifications":
      view = <Notifications onRead={() => setUnread(0)} />;
      break;
    case "admin":
    case "admin-login":
      view = <Admin tab={rest[0] || "overview"} online={online} />;
      break;
    default:
      view = <div className="page"><h1>Lost in the tall grass 🌿</h1><a href="#/">Go home</a></div>;
  }

  const nav = [
    { href: "#/", label: "Home", icon: "🏠", match: undefined },
    { href: "#/pokemon", label: "Pokémon", icon: "⚡", match: "pokemon" },
    { href: "#/snacks", label: "Snacks", icon: "🍫", match: "snacks" },
    { href: "#/chat/general", label: "Live chat", icon: "💬", match: "chat" },
    { href: "#/deals", label: "My deals", icon: "🤝", match: "deals" },
    { href: "#/trainers", label: "Trainers", icon: "🔎", match: "trainers" },
  ];
  const visibleAnn = announcements.filter((a) => !dismissed.includes(a.id));

  return (
    <AppCtx.Provider value={{ me, setMe, settings, toast, refreshMe, online, setUnread }}>
      <div className="shell">
        <aside className="side">
          <a className="brand" href="#/">
            <span className="brand-ball" />
            <span>{settings?.siteName || "PokéSwap Club"}</span>
          </a>
          <nav>
            {nav.map((n) => (
              <a key={n.href} href={n.href} className={page === n.match ? "active" : ""}>
                <span className="nav-ico">{n.icon}</span>
                {n.label}
              </a>
            ))}
            <a href="#/admin" className={`nav-admin ${page === "admin" ? "active" : ""}`}>
              <span className="nav-ico">🛡️</span>
              Admin panel
            </a>
          </nav>
          <div className="side-foot">
            <span className={`live-pill ${live}`}>
              <i /> {live === "live" ? `${online.length} online` : live === "connecting" ? "connecting…" : "offline"}
            </span>
          </div>
        </aside>

        <div className="main">
          <header className="top">
            <a className="brand mobile-only" href="#/">
              <span className="brand-ball" />
            </a>
            <div className="top-actions">
              <a href="#/new?cat=pokemon" className="btn btn-primary btn-sm hide-sm">+ List something</a>
              <a href="#/notifications" className="bell" aria-label="Notifications">
                🔔{unread > 0 && <b>{unread > 9 ? "9+" : unread}</b>}
              </a>
              <a href="#/me" className="me-chip">
                <Avatar dex={me.avatarDex} size={32} />
                <span className="hide-sm">{me.displayName}</span>
                {me.isAdmin && <AdminTag small />}
              </a>
            </div>
          </header>

          {visibleAnn.map((a) => (
            <div key={a.id} className={`announce ${a.tone}`}>
              <span>{a.tone === "warning" ? "⚠️" : a.tone === "hype" ? "🎉" : "📣"}</span>
              <p>{a.body}</p>
              <button
                className="icon-btn"
                onClick={() => {
                  const next = [...dismissed, a.id];
                  setDismissed(next);
                  localStorage.setItem("dismissed-ann", JSON.stringify(next));
                }}
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          ))}

          <main className="content">{view}</main>
        </div>

        <nav className="bottom-nav">
          {nav.slice(0, 4).map((n) => (
            <a key={n.href} href={n.href} className={page === n.match ? "active" : ""}>
              <span>{n.icon}</span>
              <small>{n.label}</small>
            </a>
          ))}
          <a href="#/new?cat=pokemon" className="bn-plus">＋</a>
        </nav>
      </div>
      <Toasts toasts={toasts} />
    </AppCtx.Provider>
  );
}

function Toasts({ toasts }) {
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export { go };
