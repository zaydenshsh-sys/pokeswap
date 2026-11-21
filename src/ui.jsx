import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { sprite, loadSpecies, artwork } from "./api.js";

export const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

export function useRoute() {
  const [hash, setHash] = useState(location.hash || "#/");
  useEffect(() => {
    const on = () => setHash(location.hash || "#/");
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  const [path, query = ""] = hash.slice(1).split("?");
  return { parts: path.split("/").filter(Boolean), query: new URLSearchParams(query), hash };
}
export const go = (h) => (location.hash = h);

export function Avatar({ dex, size = 40, ring, online }) {
  return (
    <span className={`avatar ${ring ? "ring" : ""}`} style={{ width: size, height: size }}>
      <img src={sprite(dex || 1)} alt="" loading="lazy" width={size} height={size} />
      {online && <i className="online-dot" />}
    </span>
  );
}

export function AdminTag({ small }) {
  return <span className={`admin-tag ${small ? "sm" : ""}`} title="Club admin">★ ADMIN</span>;
}

export function Trainer({ user, avatar = true, size = 28, online }) {
  if (!user) return <span className="muted">unknown</span>;
  return (
    <a className="trainer" href={`#/u/${user.username}`} onClick={(e) => e.stopPropagation()}>
      {avatar && <Avatar dex={user.avatarDex} size={size} online={online} />}
      <span className="trainer-name">{user.displayName}</span>
      {user.isAdmin && <AdminTag small />}
    </a>
  );
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const k = (e) => e.key === "Escape" && onClose();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-label={title}>
        <header>
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track"><span className="knob" /></span>
      <span>
        <b>{label}</b>
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}

export function Empty({ icon = "🔍", title, children }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}

export function SkeletonGrid({ n = 6 }) {
  return (
    <div className="grid">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="card skeleton" style={{ animationDelay: `${i * 80}ms` }}>
          <div className="sk-img" />
          <div className="sk-line" />
          <div className="sk-line short" />
        </div>
      ))}
    </div>
  );
}

export function ErrorNote({ error }) {
  if (!error) return null;
  return <div className="error-note">⚠️ {error}</div>;
}

// Searchable Pokémon picker backed by PokéAPI species names.
export function PokemonPicker({ value, onChange, placeholder = "Search a Pokémon…" }) {
  const [list, setList] = useState([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    loadSpecies().then(setList);
  }, []);
  useEffect(() => {
    const off = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
    addEventListener("mousedown", off);
    return () => removeEventListener("mousedown", off);
  }, []);
  const current = list.find((p) => p.id === value);
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return list.slice(0, 24);
    const n = Number(s);
    return list.filter((p) => p.name.includes(s) || p.id === n).slice(0, 24);
  }, [q, list]);
  return (
    <div className="picker" ref={box}>
      <div className="picker-input">
        {value ? <img src={sprite(value)} alt="" /> : <span className="picker-ball" />}
        <input
          value={open ? q : current ? `#${current.id} ${current.name}` : value ? `#${value}` : ""}
          placeholder={placeholder}
          onFocus={() => {
            setOpen(true);
            setQ("");
          }}
          onChange={(e) => setQ(e.target.value)}
        />
        {value && (
          <button type="button" className="icon-btn" onClick={() => onChange(null)} aria-label="Clear">✕</button>
        )}
      </div>
      {open && (
        <div className="picker-menu">
          {results.length === 0 && <div className="muted pad">No matches{list.length ? "" : " (loading Pokédex…)"}</div>}
          {results.map((p) => (
            <button
              type="button"
              key={p.id}
              onClick={() => {
                onChange(p.id);
                setOpen(false);
              }}
            >
              <img src={sprite(p.id)} alt="" loading="lazy" />
              <span>
                <small>#{String(p.id).padStart(4, "0")}</small> {p.name}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function PokeArt({ dex, className }) {
  const [err, setErr] = useState(false);
  if (err) return <img className={className} src={sprite(dex)} alt="" />;
  return <img className={className} src={artwork(dex)} onError={() => setErr(true)} alt="" loading="lazy" />;
}

export const TYPE_COLORS = {
  normal: "#a8a77a", fire: "#ee8130", water: "#6390f0", grass: "#7ac74c", electric: "#f7d02c", ice: "#96d9d6",
  fighting: "#c22e28", poison: "#a33ea1", ground: "#e2bf65", flying: "#a98ff3", psychic: "#f95587", bug: "#a6b91a",
  rock: "#b6a136", ghost: "#735797", dragon: "#6f35fc", dark: "#705746", steel: "#b7b7ce", fairy: "#d685ad",
};
