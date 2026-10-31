import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Html5Qrcode } from "html5-qrcode";

/* ---------- pomocnicze ---------- */
const api = async (path, opts = {}, token) => {
  const res = await fetch(path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(token ? { "X-Token": token } : {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Błąd serwera");
  return data;
};

const useHash = () => {
  const [h, setH] = useState(location.hash);
  useEffect(() => {
    const f = () => setH(location.hash);
    addEventListener("hashchange", f);
    return () => removeEventListener("hashchange", f);
  }, []);
  return h;
};

const useCountdown = (iso) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const diff = Math.max(0, new Date(iso).getTime() - now);
  const s = Math.floor(diff / 1000);
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
};

/* ---------- strona publiczna ---------- */
function Countdown({ date }) {
  const t = useCountdown(date);
  const p = (n) => String(n).padStart(2, "0");
  return (
    <div className="count" aria-label="Czas do wydarzenia">
      <div>{t.d}<small>dni</small></div>
      <div>{p(t.h)}<small>godz.</small></div>
      <div>{p(t.m)}<small>min.</small></div>
      <div>{p(t.s)}<small>sek.</small></div>
    </div>
  );
}

function BuyModal({ tier, onClose }) {
  const [form, setForm] = useState({ name: "", email: "", qty: 1 });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const submit = async () => {
    setBusy(true); setErr("");
    try {
      setDone(await api("/api/orders", { method: "POST", body: JSON.stringify({ ...form, qty: +form.qty, tier: tier.id }) }));
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        {!done ? (
          <>
            <h3>{tier.name} · {tier.price} zł</h3>
            <label htmlFor="n">Imię i nazwisko</label>
            <input id="n" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <label htmlFor="e">E-mail</label>
            <input id="e" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <label htmlFor="q">Liczba biletów (max 6)</label>
            <input id="q" type="number" min="1" max="6" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
            {err && <div className="err" role="alert">{err}</div>}
            <p style={{ margin: "18px 0 0", fontSize: 18 }}>Razem: {tier.price * (+form.qty || 0)} zł</p>
            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn" disabled={busy} onClick={submit}>{busy ? "Chwila..." : "Zapłać i odbierz bilet"}</button>
              <button className="btn ghost" onClick={onClose}>Zamknij</button>
            </div>
          </>
        ) : (
          <>
            <h3>Masz bilety</h3>
            <p>Pokaż kod QR przy wejściu. Zrób zrzut ekranu.</p>
            {done.tickets.map((t) => (
              <div className="ticket" key={t.id}>
                <QRCodeSVG value={t.code} size={120} />
                <div><h4>{t.tier}</h4><code>{t.id}</code></div>
              </div>
            ))}
            <p className="note"><b>Lokalizacja:</b> {done.location}</p>
            <button className="btn" style={{ marginTop: 18 }} onClick={onClose}>Gotowe</button>
          </>
        )}
      </div>
    </div>
  );
}

function Home({ c, reload }) {
  const [tier, setTier] = useState(null);
  return (
    <>
      <header className="top"><div className="wrap"><strong>{c.brand}</strong><a href="#tickets">{c.ticketsTitle}</a></div></header>
      <section className="hero">
        <div className="wrap">
          <h1>{c.heroTitle}</h1>
          <p className="sub">{c.heroSubtitle}</p>
          <Countdown date={c.eventDate} />
          <p className="note">{c.locationNote}</p>
        </div>
      </section>
      <section className="block"><div className="wrap">
        <h2>{c.aboutTitle}</h2>
        <p className="about">{c.aboutText}</p>
      </div></section>
      <section className="block" id="tickets"><div className="wrap">
        <h2>{c.ticketsTitle}</h2>
        <div className="tiers">
          {c.tiers.map((t) => (
            <div className="tier" key={t.id}>
              <h3>{t.name}</h3>
              <div className="price">{t.price} zł</div>
              <p>{t.desc}</p>
              <span className="left">{t.left > 0 ? `Zostało: ${t.left}` : "Wyprzedane"}</span>
              <button className="btn" disabled={t.left < 1} onClick={() => setTier(t)}>{c.buyButton}</button>
            </div>
          ))}
        </div>
      </div></section>
      <footer className="foot"><div className="wrap">{c.footer}</div></footer>
      {tier && <BuyModal tier={tier} onClose={() => { setTier(null); reload(); }} />}
    </>
  );
}

/* ---------- panel admina: edycja wszystkich tekstow ---------- */
const FIELDS = [
  ["brand", "Nazwa w nagłówku strony"],
  ["heroTitle", "Główny tytuł"],
  ["heroSubtitle", "Podtytuł"],
  ["eventDate", "Data i godzina wydarzenia (timer)", "datetime-local"],
  ["locationNote", "Info o lokalizacji (publiczne)"],
  ["secretLocation", "Prawdziwy adres (widoczny tylko po zakupie)"],
  ["aboutTitle", "Nagłówek sekcji opisu"],
  ["aboutText", "Opis wydarzenia", "area"],
  ["ticketsTitle", "Nagłówek sekcji biletów"],
  ["buyButton", "Tekst przycisku zakupu"],
  ["footer", "Stopka"],
];

function Admin() {
  const [token, setToken] = useState(sessionStorage.getItem("kc_admin") || "");
  const [c, setC] = useState(null);
  const [msg, setMsg] = useState("");

  const load = async () => {
    try { setC(await api("/api/admin/content", {}, token)); sessionStorage.setItem("kc_admin", token); setMsg(""); }
    catch (e) { setMsg(e.message); }
  };
  useEffect(() => { if (token) load(); }, []);

  const save = async () => {
    try { await api("/api/admin/content", { method: "PUT", body: JSON.stringify(c) }, token); setMsg("Zapisano. Strona jest już zaktualizowana."); }
    catch (e) { setMsg(e.message); }
  };
  const setTier = (i, k, v) => setC({ ...c, tiers: c.tiers.map((t, j) => (j === i ? { ...t, [k]: v } : t)) });

  if (!c)
    return (
      <div className="wrap panel">
        <h1>Panel</h1>
        <label htmlFor="t">Token admina</label>
        <input id="t" type="password" value={token} onChange={(e) => setToken(e.target.value)} />
        <button className="btn" style={{ marginTop: 14 }} onClick={load}>Wejdź</button>
        {msg && <div className="err">{msg}</div>}
      </div>
    );

  return (
    <div className="wrap panel">
      <h1>Edycja strony</h1>
      <fieldset>
        <legend>Teksty</legend>
        {FIELDS.map(([k, label, type]) => (
          <div key={k}>
            <label htmlFor={k}>{label}</label>
            {type === "area" ? (
              <textarea id={k} value={c[k] || ""} onChange={(e) => setC({ ...c, [k]: e.target.value })} />
            ) : (
              <input id={k} type={type || "text"} value={c[k] || ""} onChange={(e) => setC({ ...c, [k]: e.target.value })} />
            )}
          </div>
        ))}
      </fieldset>
      <fieldset>
        <legend>Bilety</legend>
        {c.tiers.map((t, i) => (
          <div className="row" key={t.id} style={{ marginTop: 18, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
            <div><label>Nazwa</label><input value={t.name} onChange={(e) => setTier(i, "name", e.target.value)} /></div>
            <div><label>Cena (zł)</label><input type="number" value={t.price} onChange={(e) => setTier(i, "price", +e.target.value)} /></div>
            <div><label>Pula</label><input type="number" value={t.capacity} onChange={(e) => setTier(i, "capacity", +e.target.value)} /></div>
            <div style={{ flexBasis: "100%" }}><label>Opis</label><input value={t.desc} onChange={(e) => setTier(i, "desc", e.target.value)} /></div>
            <button className="btn ghost" onClick={() => setC({ ...c, tiers: c.tiers.filter((_, j) => j !== i) })}>Usuń</button>
          </div>
        ))}
        <button className="btn ghost" style={{ marginTop: 18 }}
          onClick={() => setC({ ...c, tiers: [...c.tiers, { id: "t" + Date.now(), name: "Nowy bilet", price: 100, capacity: 100, desc: "" }] })}>
          Dodaj rodzaj biletu
        </button>
      </fieldset>
      <div className="sticky">
        <button className="btn" onClick={save}>Zapisz zmiany</button>
        <a href="#">Zobacz stronę</a>
        <span>{msg}</span>
      </div>
    </div>
  );
}

/* ---------- bramka: skaner QR ---------- */
function Scanner() {
  const [token, setToken] = useState(sessionStorage.getItem("kc_staff") || "");
  const [ready, setReady] = useState(false);
  const [result, setResult] = useState(null);
  const [stats, setStats] = useState(null);
  const [manual, setManual] = useState("");
  const last = useRef({ code: "", at: 0 });

  const refresh = () => api("/api/stats", {}, token).then(setStats).catch(() => {});

  const verify = async (code) => {
    const now = Date.now();
    if (last.current.code === code && now - last.current.at < 3000) return; // ten sam kod z kamery
    last.current = { code, at: now };
    try {
      setResult(await api("/api/verify", { method: "POST", body: JSON.stringify({ code }) }, token));
      navigator.vibrate?.(80);
    } catch (e) { setResult({ status: "invalid", error: e.message }); }
    refresh();
  };

  useEffect(() => {
    if (!ready) return;
    refresh();
    const s = new Html5Qrcode("reader");
    s.start({ facingMode: "environment" }, { fps: 10, qrbox: 240 }, verify).catch(() => {});
    return () => { s.stop().then(() => s.clear()).catch(() => {}); };
  }, [ready]);

  if (!ready)
    return (
      <div className="wrap panel">
        <h1>Bramka</h1>
        <label htmlFor="t">Token obsługi</label>
        <input id="t" type="password" value={token} onChange={(e) => setToken(e.target.value)} />
        <button className="btn" style={{ marginTop: 14 }}
          onClick={() => api("/api/stats", {}, token).then(() => { sessionStorage.setItem("kc_staff", token); setReady(true); }).catch((e) => setResult({ status: "invalid", error: e.message }))}>
          Start
        </button>
        {result?.error && <div className="err">{result.error}</div>}
      </div>
    );

  const label = { ok: "Wchodzi", used: "Już użyty", invalid: "Nieważny" };
  return (
    <div className="wrap panel">
      {stats && (
        <div className="stats">
          <div>{stats.lastHour}/{stats.targetPerHour}<small>wejść w ostatniej godzinie</small></div>
          <div>{stats.entered}/{stats.sold}<small>weszło / sprzedano</small></div>
        </div>
      )}
      <div id="reader" />
      <div className="row" style={{ marginTop: 14, maxWidth: 420 }}>
        <input placeholder="Wpisz kod ręcznie" value={manual} onChange={(e) => setManual(e.target.value)} />
        <button className="btn ghost" onClick={() => { verify(manual.trim()); setManual(""); }}>Sprawdź</button>
      </div>
      {result && (
        <div className={`scan-result ${result.status}`} role="status">
          {label[result.status]}
          {result.name && <small>{result.name}{result.tier ? ` · ${result.tier}` : ""}</small>}
        </div>
      )}
    </div>
  );
}

/* ---------- aplikacja ---------- */
export default function App() {
  const hash = useHash();
  const [c, setC] = useState(null);
  const load = () => api("/api/content").then(setC).catch(() => {});
  useEffect(() => { load(); }, []);

  if (hash === "#admin") return <Admin />;
  if (hash === "#scan") return <Scanner />;
  if (!c) return <div className="wrap" style={{ padding: 40 }}>Ładowanie...</div>;
  return <Home c={c} reload={load} />;
}
