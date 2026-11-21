import { useState } from "react";
import { api, artwork } from "../api.js";
import { useApp, PokemonPicker, ErrorNote, AdminTag, TYPE_COLORS } from "../ui.jsx";

export default function MySettings() {
  const { me, setMe, toast, refreshMe } = useApp();
  const [f, setF] = useState({ displayName: me.displayName, bio: me.bio, avatarDex: me.avatarDex, favoriteType: me.favoriteType });
  const [pw, setPw] = useState({ current: "", next: "" });
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");

  async function save(e) {
    e.preventDefault();
    setErr("");
    try {
      const d = await api("/api/me", { method: "PATCH", body: f });
      setMe(d.user);
      toast("Profile saved");
    } catch (e) {
      setErr(e.message);
    }
  }
  async function changePw(e) {
    e.preventDefault();
    try {
      await api("/api/me/password", { method: "POST", body: pw });
      setPw({ current: "", next: "" });
      toast("Password changed 🔐");
    } catch (e) {
      toast(e.message, "warn");
    }
  }
  async function unlock(e) {
    e.preventDefault();
    try {
      const d = await api("/api/admin/unlock", { method: "POST", body: { code } });
      setMe(d.user);
      toast("Admin unlocked ★");
      location.hash = "#/admin";
    } catch (e) {
      toast(e.message, "warn");
    }
  }
  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    setMe(null);
    location.hash = "#/";
    refreshMe();
  }

  return (
    <div className="page settings-page">
      <p className="eyebrow">You</p>
      <h1>My trainer card</h1>
      <div className="settings-grid">
        <form className="panel" onSubmit={save}>
          <div className="trainer-preview" style={{ "--tc": TYPE_COLORS[f.favoriteType] }}>
            <img src={artwork(f.avatarDex || 1)} alt="" />
            <div>
              <b>{f.displayName || "…"}</b> {me.isAdmin && <AdminTag small />}
              <small>@{me.username}</small>
            </div>
          </div>
          <label className="field">
            <span>Display name</span>
            <input value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} maxLength={30} />
          </label>
          <div className="field">
            <span>Partner Pokémon (your avatar)</span>
            <PokemonPicker value={f.avatarDex} onChange={(v) => v && setF({ ...f, avatarDex: v })} />
          </div>
          <div className="field">
            <span>Favorite type</span>
            <div className="type-pick">
              {Object.entries(TYPE_COLORS).map(([t, c]) => (
                <button type="button" key={t} className={f.favoriteType === t ? "on" : ""} style={{ "--c": c }} onClick={() => setF({ ...f, favoriteType: t })}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <label className="field">
            <span>Bio</span>
            <textarea rows={3} value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} maxLength={280} placeholder="Collecting Eeveelutions. Will trade for Sour Patch." />
          </label>
          <ErrorNote error={err} />
          <button className="btn btn-primary">Save profile</button>
        </form>

        <div className="stack">
          <form className="panel" onSubmit={changePw}>
            <h3>Change password</h3>
            <label className="field">
              <span>Current password</span>
              <input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required autoComplete="current-password" />
            </label>
            <label className="field">
              <span>New password</span>
              <input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required minLength={4} autoComplete="new-password" />
            </label>
            <button className="btn">Update password</button>
          </form>

          {!me.isAdmin && (
            <form className="panel admin-unlock" onSubmit={unlock}>
              <h3>🛡️ Become an admin</h3>
              <p className="muted small">Got the secret admin code? Enter it to unlock the admin panel and get the ★ ADMIN tag.</p>
              <input type="password" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Admin code" required autoComplete="off" />
              <button className="btn">Unlock</button>
            </form>
          )}

          <div className="panel">
            <a className="btn btn-block" href={`#/u/${me.username}`}>View my public profile</a>
            <button className="btn btn-block btn-danger" onClick={logout}>Log out</button>
          </div>
        </div>
      </div>
    </div>
  );
}
