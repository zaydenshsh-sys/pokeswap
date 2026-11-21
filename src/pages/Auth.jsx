import { useState } from "react";
import { api, artwork } from "../api.js";
import { useApp, ErrorNote } from "../ui.jsx";

const HERO_DEX = [1, 4, 7, 25, 133, 39];

export default function AuthPage({ admin }) {
  const { setMe, settings, refreshMe } = useApp();
  const [mode, setMode] = useState(admin ? "admin" : "login");
  const [form, setForm] = useState({ username: "", password: "", displayName: "", code: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const path = mode === "signup" ? "/api/auth/signup" : mode === "admin" ? "/api/admin/login" : "/api/auth/login";
      const d = await api(path, { method: "POST", body: form });
      setMe(d.user);
      await refreshMe();
      location.hash = mode === "admin" ? "#/admin" : "#/";
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`auth ${mode === "admin" ? "auth-admin" : ""}`}>
      <section className="auth-hero">
        <div className="auth-brand">
          <span className="brand-ball big" />
          <h1>{settings?.siteName || "PokéSwap Club"}</h1>
        </div>
        <p className="auth-tag">{settings?.tagline}</p>
        <ul className="auth-points">
          <li><b>⚡ Pokémon</b> trade, buy & sell, meet up at school</li>
          <li><b>🍫 Snacks</b> with expiration dates so nothing goes stale</li>
          <li><b>💬 Live chat</b> with the whole crew</li>
        </ul>
        <div className="hero-mons" aria-hidden>
          {HERO_DEX.map((d, i) => (
            <img key={d} src={artwork(d)} style={{ "--i": i }} alt="" />
          ))}
        </div>
      </section>

      <section className="auth-card-wrap">
        <form className="auth-card" onSubmit={submit}>
          <div className="seg">
            <button type="button" className={mode === "login" ? "on" : ""} onClick={() => setMode("login")}>Log in</button>
            <button type="button" className={mode === "signup" ? "on" : ""} onClick={() => setMode("signup")}>Sign up</button>
            <button type="button" className={mode === "admin" ? "on" : ""} onClick={() => setMode("admin")}>🛡️ Admin</button>
          </div>

          {mode === "admin" && (
            <p className="hint">Admins sign in with their account <b>plus the secret admin code</b>. No account yet? Sign up first, then come back here.</p>
          )}
          {mode === "signup" && !settings?.signupsOpen && (
            <p className="hint warn">Sign-ups are closed right now. Ask an admin to make your account.</p>
          )}

          <label className="field">
            <span>Username</span>
            <input autoComplete="username" value={form.username} onChange={set("username")} placeholder="ash_k" required />
          </label>
          {mode === "signup" && (
            <label className="field">
              <span>Display name <small>(optional)</small></span>
              <input value={form.displayName} onChange={set("displayName")} placeholder="Ash" maxLength={30} />
            </label>
          )}
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              value={form.password}
              onChange={set("password")}
              required
              minLength={4}
            />
          </label>
          {mode === "admin" && (
            <label className="field">
              <span>Admin code</span>
              <input type="password" value={form.code} onChange={set("code")} placeholder="••••" required autoComplete="off" />
            </label>
          )}

          <ErrorNote error={error} />
          <button className="btn btn-primary btn-block" disabled={busy || (mode === "signup" && !settings?.signupsOpen)}>
            {busy ? "…" : mode === "signup" ? "Create my account" : mode === "admin" ? "Unlock admin panel" : "Let's go!"}
          </button>
        </form>
      </section>
    </div>
  );
}
