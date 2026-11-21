import { useEffect, useState } from "react";
import { api, timeAgo } from "../api.js";
import { Empty } from "../ui.jsx";

export default function Notifications({ onRead }) {
  const [items, setItems] = useState(null);
  useEffect(() => {
    api("/api/notifications").then((d) => {
      setItems(d.notifications);
      api("/api/notifications/read", { method: "POST" }).then(onRead);
    });
  }, []);
  return (
    <div className="page">
      <p className="eyebrow">Inbox</p>
      <h1>Notifications 🔔</h1>
      {!items ? (
        <div className="ball-spin" />
      ) : items.length === 0 ? (
        <Empty icon="📭" title="All quiet">Offers, mentions and admin news show up here.</Empty>
      ) : (
        <ul className="notes">
          {items.map((n) => (
            <li key={n.id} className={n.read ? "" : "unread"}>
              {n.link ? <a href={n.link}>{n.body}</a> : <span>{n.body}</span>}
              <time>{timeAgo(n.createdAt)}</time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
