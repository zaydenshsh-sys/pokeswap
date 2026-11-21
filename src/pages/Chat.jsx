import { useEffect, useRef, useState } from "react";
import { api, timeAgo } from "../api.js";
import { useApp, Avatar, AdminTag, Trainer, Modal } from "../ui.jsx";
import { onRealtime, sendRealtime, onStatus } from "../realtime.js";

const QUICK = ["👍", "😂", "🔥", "🤝", "❤️", "👀"];

function renderBody(body, myName) {
  return body.split(/(@[a-z0-9_]{3,20})/gi).map((p, i) =>
    p.startsWith("@") ? (
      <a key={i} href={`#/u/${p.slice(1).toLowerCase()}`} className={`mention ${p.slice(1).toLowerCase() === myName ? "me" : ""}`}>{p}</a>
    ) : (
      <span key={i}>{p}</span>
    )
  );
}

export default function Chat({ slug, online }) {
  const { me, toast, settings } = useApp();
  const [channels, setChannels] = useState([]);
  const [channel, setChannel] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [pinned, setPinned] = useState([]);
  const [text, setText] = useState("");
  const [typing, setTyping] = useState({});
  const [live, setLive] = useState("offline");
  const [mod, setMod] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const list = useRef(null);
  const lastTyping = useRef(0);
  const msgsRef = useRef([]);
  msgsRef.current = msgs;

  const loadChannels = () => api("/api/channels").then((d) => setChannels(d.channels));
  const scrollDown = () => requestAnimationFrame(() => list.current && (list.current.scrollTop = list.current.scrollHeight));

  async function loadMessages() {
    const d = await api(`/api/channels/${slug}/messages`);
    setChannel(d.channel);
    setMsgs(d.messages);
    setPinned(d.pinned);
    setHasMore(d.messages.length >= 60);
    scrollDown();
  }
  async function catchUp() {
    const last = msgsRef.current.at(-1)?.id || 0;
    const d = await api(`/api/channels/${slug}/messages?after=${last}`);
    if (d.messages.length) {
      setMsgs((m) => dedupe([...m, ...d.messages]));
      scrollDown();
    }
    setPinned(d.pinned);
  }
  async function loadOlder() {
    const first = msgs[0]?.id;
    if (!first) return;
    const d = await api(`/api/channels/${slug}/messages?before=${first}`);
    setMsgs((m) => dedupe([...d.messages, ...m]));
    setHasMore(d.messages.length >= 60);
  }

  useEffect(() => {
    loadChannels();
    const draft = sessionStorage.getItem("draft");
    if (draft) {
      setText(draft);
      sessionStorage.removeItem("draft");
    }
  }, []);
  useEffect(() => {
    setMsgs([]);
    setChannel(null);
    loadMessages().catch((e) => toast(e.message, "warn"));
  }, [slug]);

  useEffect(() => onStatus(setLive), []);
  // Fallback polling when the live connection is down.
  useEffect(() => {
    if (live === "live") return;
    const t = setInterval(() => catchUp().catch(() => {}), 4000);
    return () => clearInterval(t);
  }, [live, slug]);

  useEffect(
    () =>
      onRealtime((m) => {
        if (m.type === "message" && m.message.channel === slug) {
          const nearBottom = list.current && list.current.scrollHeight - list.current.scrollTop - list.current.clientHeight < 160;
          setMsgs((xs) => dedupe([...xs, m.message]));
          setTyping((t) => {
            const n = { ...t };
            delete n[m.message.author.id];
            return n;
          });
          if (nearBottom || m.message.userId === me.id) scrollDown();
        }
        if (m.type === "message_deleted") {
          setMsgs((xs) => xs.map((x) => (x.id === m.id ? { ...x, deleted: true, body: "" } : x)));
          setPinned((p) => p.filter((x) => x.id !== m.id));
        }
        if (m.type === "message_pinned") catchUp();
        if (m.type === "channel_cleared" && m.channel === slug) setMsgs([]);
        if (m.type === "channels") {
          loadChannels();
          api(`/api/channels/${slug}/messages?after=999999999`).then((d) => setChannel(d.channel)).catch(() => {});
        }
        if (m.type === "reconnected") catchUp().catch(() => {});
        if (m.type === "typing" && m.channel === slug) {
          setTyping((t) => ({ ...t, [m.user.id]: { name: m.user.displayName, at: Date.now() } }));
        }
      }),
    [slug, me.id]
  );
  useEffect(() => {
    const t = setInterval(() => setTyping((ty) => Object.fromEntries(Object.entries(ty).filter(([, v]) => Date.now() - v.at < 4000))), 1500);
    return () => clearInterval(t);
  }, []);

  async function send(e, override) {
    e?.preventDefault();
    const body = (override ?? text).trim();
    if (!body) return;
    if (!override) setText("");
    try {
      const d = await api(`/api/channels/${slug}/messages`, { method: "POST", body: { body } });
      setMsgs((xs) => dedupe([...xs, d.message]));
      scrollDown();
    } catch (err) {
      toast(err.message, "warn");
      if (!override) setText(body);
    }
  }
  function onType(v) {
    setText(v);
    if (Date.now() - lastTyping.current > 2500) {
      lastTyping.current = Date.now();
      sendRealtime({ type: "typing", channel: slug });
    }
  }
  async function remove(m) {
    await api(`/api/messages/${m.id}`, { method: "DELETE" }).catch((e) => toast(e.message, "warn"));
  }
  async function pin(m) {
    await api(`/api/messages/${m.id}/pin`, { method: "POST" }).catch((e) => toast(e.message, "warn"));
  }

  const muted = me.mutedUntil && new Date(me.mutedUntil) > new Date();
  const blocked = !me.isAdmin && (channel?.locked || channel?.adminOnly || !settings?.chatOpen || muted);
  const typers = Object.values(typing).map((t) => t.name);

  return (
    <div className="chat">
      <aside className="chan-list">
        <h4>Channels</h4>
        {channels.map((c) => (
          <a key={c.id} href={`#/chat/${c.slug}`} className={c.slug === slug ? "on" : ""}>
            <span>{c.emoji}</span> {c.name}
            {c.locked && <small>🔒</small>}
            {c.adminOnly && <small>🛡️</small>}
          </a>
        ))}
        <h4>Online · {online.length}</h4>
        <div className="online-list">
          {online.map((u) => (
            <a key={u.id} href={`#/u/${u.username}`}>
              <Avatar dex={u.avatarDex} size={24} online />
              <span>{u.displayName}</span>
              {u.isAdmin && <AdminTag small />}
            </a>
          ))}
        </div>
      </aside>

      <section className="chat-main">
        <header className="chat-head">
          <div>
            <h2>
              {channel?.emoji} {channel?.name || "…"}
            </h2>
            <p className="muted small">
              {channel?.description}
              {channel?.slowModeSeconds > 0 && ` · 🐢 Slow mode ${channel.slowModeSeconds}s`}
            </p>
          </div>
          <span className={`live-pill ${live}`}><i /> {live === "live" ? "Live" : "Reconnecting…"}</span>
        </header>

        {pinned.length > 0 && (
          <div className="pinned">
            {pinned.map((p) => (
              <div key={p.id}>📌 <b>{p.author.displayName}:</b> {p.body}</div>
            ))}
          </div>
        )}

        <div className="msgs" ref={list}>
          {hasMore && msgs.length >= 60 && (
            <button className="btn btn-sm btn-ghost load-older" onClick={loadOlder}>Load older messages</button>
          )}
          {msgs.length === 0 && channel && <div className="muted center pad">No messages yet. Say hi! 👋</div>}
          {msgs.map((m, i) => {
            const prev = msgs[i - 1];
            const grouped = prev && prev.userId === m.userId && new Date(m.createdAt) - new Date(prev.createdAt) < 120000 && !prev.deleted;
            const mentionsMe = m.body.toLowerCase().includes(`@${me.username}`);
            return (
              <div key={m.id} className={`msg ${grouped ? "grouped" : ""} ${m.userId === me.id ? "mine" : ""} ${mentionsMe ? "pinged" : ""} ${m.pinned ? "is-pinned" : ""}`}>
                {!grouped ? <Avatar dex={m.author.avatarDex} size={36} /> : <span className="msg-gap" />}
                <div className="msg-main">
                  {!grouped && (
                    <div className="msg-head">
                      <Trainer user={m.author} avatar={false} />
                      <time>{timeAgo(m.createdAt)}</time>
                    </div>
                  )}
                  {m.deleted ? (
                    <p className="deleted">message removed</p>
                  ) : (
                    <p>{renderBody(m.body, me.username)}</p>
                  )}
                  {m.listingId && !m.deleted && (
                    <a className="msg-listing" href={`#/listing/${m.listingId}`}>🏷️ Open listing #{m.listingId} →</a>
                  )}
                </div>
                {!m.deleted && (
                  <div className="msg-tools">
                    {m.userId !== me.id && <button title="Reply" onClick={() => setText(`@${m.author.username} `)}>↩</button>}
                    {(m.userId === me.id || me.isAdmin) && <button title="Delete" onClick={() => remove(m)}>🗑</button>}
                    {me.isAdmin && <button title={m.pinned ? "Unpin" : "Pin"} onClick={() => pin(m)}>📌</button>}
                    {me.isAdmin && m.userId !== me.id && <button title="Moderate user" onClick={() => setMod(m.author)}>🛡️</button>}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="typing">{typers.length > 0 && `${typers.slice(0, 3).join(", ")} ${typers.length > 1 ? "are" : "is"} typing…`}</div>

        {blocked ? (
          <div className="composer blocked">
            {muted
              ? `🔇 You're muted until ${new Date(me.mutedUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
              : !settings?.chatOpen
                ? "⏸ Chat is paused by an admin"
                : channel?.adminOnly
                  ? "🛡️ Only admins can post here"
                  : "🔒 This channel is locked"}
          </div>
        ) : (
          <form className="composer" onSubmit={send}>
            <div className="quick-react">
              {QUICK.map((q) => (
                <button type="button" key={q} onClick={() => send(null, q)}>{q}</button>
              ))}
            </div>
            <input value={text} onChange={(e) => onType(e.target.value)} placeholder={`Message #${channel?.name || ""} (use @username to ping)`} maxLength={800} />
            <button className="btn btn-primary">Send</button>
          </form>
        )}
      </section>
      {mod && <ModModal user={mod} onClose={() => setMod(null)} />}
    </div>
  );
}

function dedupe(arr) {
  const seen = new Map();
  for (const m of arr) seen.set(m.id, m);
  return [...seen.values()].sort((a, b) => a.id - b.id);
}

export function ModModal({ user, onClose }) {
  const { toast } = useApp();
  async function act(body, msg) {
    try {
      await api(`/api/admin/users/${user.id}`, { method: "PATCH", body });
      toast(msg);
      onClose();
    } catch (e) {
      toast(e.message, "warn");
    }
  }
  return (
    <Modal title={`Moderate ${user.displayName}`} onClose={onClose}>
      <div className="mod-grid">
        <button className="btn" onClick={() => act({ muteMinutes: 5 }, "Muted 5 min")}>🔇 Mute 5m</button>
        <button className="btn" onClick={() => act({ muteMinutes: 60 }, "Muted 1 hour")}>🔇 Mute 1h</button>
        <button className="btn" onClick={() => act({ muteMinutes: 1440 }, "Muted 1 day")}>🔇 Mute 1 day</button>
        <button className="btn" onClick={() => act({ muteMinutes: 0 }, "Unmuted")}>🔊 Unmute</button>
        <button
          className="btn btn-danger"
          onClick={() => {
            const reason = prompt("Ban reason (optional)") ?? "";
            act({ banned: true, banReason: reason }, "User banned");
          }}
        >
          ⛔ Ban
        </button>
        <a className="btn" href={`#/u/${user.username}`} onClick={onClose}>View profile</a>
      </div>
    </Modal>
  );
}
