import { useEffect, useState } from "react";
import { api, shrinkImage, imageUrl, todayISO } from "../api.js";
import { useApp, PokemonPicker, ErrorNote, PokeArt } from "../ui.jsx";

const CONDITIONS = ["Mint", "Near mint", "Good", "Played", "Damaged"];
const POKE_TYPES = ["Card", "Plush", "Figure", "Game", "Sticker", "Other"];

export default function ListingForm({ category: initialCat, editId }) {
  const { settings, toast, me } = useApp();
  const [loading, setLoading] = useState(!!editId);
  const [f, setF] = useState({
    category: initialCat === "snack" ? "snack" : "pokemon",
    kind: "sell",
    title: "",
    description: "",
    price: "",
    tradeFor: "",
    condition: "",
    quantity: 1,
    expiresOn: "",
    meetSpot: "",
    pokemonDex: null,
    imageKey: null,
    itemType: "Card",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (!editId) return;
    api(`/api/listings/${editId}`).then(({ listing: l }) => {
      setF({
        ...l,
        price: l.priceCents === null ? "" : (l.priceCents / 100).toString(),
        expiresOn: l.expiresOn || "",
        itemType: "Card",
      });
      setLoading(false);
    });
  }, [editId]);

  const isSnack = f.category === "snack";

  async function upload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const blob = await shrinkImage(file);
      const d = await api("/api/uploads", { method: "POST", raw: blob });
      set("imageKey", d.key);
    } catch (err) {
      toast(err.message, "warn");
    } finally {
      setUploading(false);
    }
  }

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const body = {
      kind: f.kind,
      title: f.title,
      description: f.description,
      priceCents: f.price === "" ? null : Math.round(Number(f.price) * 100),
      tradeFor: f.tradeFor,
      condition: isSnack ? "" : f.condition,
      quantity: Number(f.quantity) || 1,
      expiresOn: isSnack ? f.expiresOn || null : null,
      meetSpot: f.meetSpot,
      pokemonDex: f.pokemonDex,
      imageKey: f.imageKey,
    };
    if (!editId) body.category = f.category;
    try {
      const d = editId
        ? await api(`/api/listings/${editId}`, { method: "PATCH", body })
        : await api("/api/listings", { method: "POST", body });
      toast(editId ? "Listing updated" : "Listed! 🎉");
      location.hash = `#/listing/${d.listing.id}`;
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="page"><div className="ball-spin" /></div>;

  return (
    <div className="page form-page">
      <h1>{editId ? "Edit listing" : "New listing"}</h1>
      <form onSubmit={submit} className="listing-form">
        <div className="form-main">
          {!editId && (
            <div className="big-choice">
              <button type="button" className={!isSnack ? "on poke" : ""} onClick={() => set("category", "pokemon")}>
                <span>⚡</span> Pokémon
              </button>
              <button type="button" className={isSnack ? "on snack" : ""} onClick={() => set("category", "snack")}>
                <span>🍫</span> Snack
              </button>
            </div>
          )}

          <div className="field">
            <span>I want to…</span>
            <div className="seg wide">
              {[["sell", "💰 Sell"], ["buy", "🛒 Buy"], ["trade", "🔄 Trade"]].map(([v, l]) => (
                <button type="button" key={v} className={f.kind === v ? "on" : ""} onClick={() => set("kind", v)}>{l}</button>
              ))}
            </div>
          </div>

          <label className="field">
            <span>Title</span>
            <input
              value={f.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder={isSnack ? "Hot Cheetos (big bag)" : "Holo Charizard card"}
              maxLength={80}
              required
            />
          </label>

          {!isSnack && (
            <>
              <div className="field">
                <span>Which Pokémon? <small>(shows its picture)</small></span>
                <PokemonPicker value={f.pokemonDex} onChange={(v) => set("pokemonDex", v)} />
              </div>
              <div className="field">
                <span>Type of item</span>
                <div className="chips">
                  {POKE_TYPES.map((t) => (
                    <button
                      type="button"
                      key={t}
                      className={`chip ${f.title.toLowerCase().includes(t.toLowerCase()) ? "on" : ""}`}
                      onClick={() => !f.title.toLowerCase().includes(t.toLowerCase()) && set("title", `${f.title} ${t}`.trim())}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <span>Condition</span>
                <div className="chips">
                  {CONDITIONS.map((c) => (
                    <button type="button" key={c} className={`chip ${f.condition === c ? "on" : ""}`} onClick={() => set("condition", f.condition === c ? "" : c)}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {isSnack && (
            <label className="field">
              <span>Expiration date <small>(required)</small></span>
              <input type="date" value={f.expiresOn} min={editId ? undefined : todayISO()} onChange={(e) => set("expiresOn", e.target.value)} required />
            </label>
          )}

          <div className="row2">
            {f.kind !== "trade" && (
              <label className="field">
                <span>{f.kind === "buy" ? "Willing to pay ($)" : "Price ($)"}</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  max={(settings?.maxPriceCents || 10000) / 100}
                  value={f.price}
                  onChange={(e) => set("price", e.target.value)}
                  placeholder="Leave empty for offers"
                />
              </label>
            )}
            <label className="field">
              <span>Quantity</span>
              <input type="number" min="1" max="999" value={f.quantity} onChange={(e) => set("quantity", e.target.value)} />
            </label>
          </div>

          {f.kind !== "buy" && (
            <label className="field">
              <span>{f.kind === "trade" ? "What do you want in return?" : "Would also trade for (optional)"}</span>
              <input value={f.tradeFor} onChange={(e) => set("tradeFor", e.target.value)} placeholder={isSnack ? "Takis, gummy worms…" : "Any Eevee evolution"} maxLength={200} />
            </label>
          )}

          <div className="field">
            <span>Meet-up spot at school</span>
            <div className="chips">
              {(settings?.meetSpots || []).map((s) => (
                <button type="button" key={s} className={`chip ${f.meetSpot === s ? "on" : ""}`} onClick={() => set("meetSpot", f.meetSpot === s ? "" : s)}>
                  📍 {s}
                </button>
              ))}
            </div>
            <input value={f.meetSpot} onChange={(e) => set("meetSpot", e.target.value)} placeholder="Or type your own" maxLength={60} />
          </div>

          <label className="field">
            <span>Details</span>
            <textarea rows={4} value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="Anything people should know?" maxLength={1000} />
          </label>
        </div>

        <aside className="form-side">
          <div className="field">
            <span>Photo</span>
            <label className="drop">
              {f.imageKey ? (
                <img src={imageUrl(f.imageKey)} alt="" />
              ) : f.pokemonDex ? (
                <PokeArt dex={f.pokemonDex} />
              ) : (
                <span>{uploading ? "Uploading…" : "📷 Tap to add a photo"}</span>
              )}
              <input type="file" accept="image/*" onChange={upload} hidden />
            </label>
            {f.imageKey && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => set("imageKey", null)}>Remove photo</button>
            )}
          </div>
          <ErrorNote error={error} />
          <button className="btn btn-primary btn-block" disabled={busy || uploading}>
            {busy ? "Saving…" : editId ? "Save changes" : "Post listing"}
          </button>
          <p className="muted small">Posting as {me.displayName}. Deals happen in person at school, so be safe and fair.</p>
        </aside>
      </form>
    </div>
  );
}
