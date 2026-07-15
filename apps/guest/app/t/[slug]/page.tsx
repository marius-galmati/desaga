"use client";

import type {
  BilingualText,
  GuestMenu,
  GuestOrder,
  GuestPlate,
  GuestSession,
} from "@boca/contracts";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BRAND, ro1 } from "@/lib/brand";
import { Emblem, Seal } from "@/lib/emblem";
import { fetchMenu, formatLei, TENANT_SLUG } from "@/lib/menu";
import {
  listOrders,
  listPlates,
  placeOrder,
  STATUS_RO,
  serviceRequest,
  startSession,
  storedToken,
} from "@/lib/order";
import { PhotoSlot } from "@/lib/photo";
import styles from "./table.module.css";

type Lang = "ro" | "en";
type Tab = "meniu" | "nota" | "farfuria";
type Cart = Record<string, number>; // dishId -> quantity

// Colored initial-avatar palette for the shared bill (per distinct guest).
const GUEST_TONES = [
  "var(--vin)",
  "var(--pine)",
  "var(--ochre)",
  "var(--indigo)",
  "var(--pine-soft)",
];

// Compact EU-14 allergen labels (RO); unknown codes fall back to the raw code.
const ALLERGEN_RO: Record<string, string> = {
  gluten: "gluten",
  crustacee: "crustacee",
  oua: "ouă",
  peste: "pește",
  arahide: "arahide",
  soia: "soia",
  lapte: "lapte",
  fructe_coaja: "fructe cu coajă",
  telina: "țelină",
  mustar: "muștar",
  susan: "susan",
  sulfiti: "sulfiți",
  lupin: "lupin",
  moluste: "moluște",
};

function t(text: BilingualText | null | undefined, lang: Lang): string {
  if (!text) return "";
  return (lang === "en" ? text.en : text.ro) || text.ro;
}

/* ---- Tab-bar icons (stroke SVG, matching the demo) ---- */
function IconMeniu() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 6h16M4 12h16M4 18h10"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
function IconNota() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 3.5h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4V3.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M9 8h6M9 11.5h6M9 15h4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
function IconFarfurie() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8.4" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.3" opacity="0.6" />
    </svg>
  );
}

export default function TableOrderPage() {
  const params = useParams<{ slug: string }>();
  const qrSlug = params.slug;

  const [session, setSession] = useState<GuestSession | null>(null);
  const [menu, setMenu] = useState<GuestMenu | null>(null);
  const [orders, setOrders] = useState<GuestOrder[]>([]);
  const [plates, setPlates] = useState<GuestPlate[]>([]);
  const [cart, setCart] = useState<Cart>({});
  const [lang, setLang] = useState<Lang>("ro");
  const [tab, setTab] = useState<Tab>("meniu");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [activeCat, setActiveCat] = useState<string>("toate");
  const [cartOpen, setCartOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const token = session?.token ?? (typeof window !== "undefined" ? storedToken(qrSlug) : null);

  const refresh = useCallback(async (tok: string) => {
    const [o, p] = await Promise.allSettled([listOrders(tok), listPlates(tok)]);
    if (o.status === "fulfilled") setOrders(o.value);
    if (p.status === "fulfilled") setPlates(p.value);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [ses, m] = await Promise.all([startSession(qrSlug), fetchMenu(TENANT_SLUG)]);
        if (cancelled) return;
        setSession(ses);
        setMenu(m);
        void refresh(ses.token);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Nu am putut deschide masa.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [qrSlug, refresh]);

  // Keep orders + plates fresh so kitchen progress and new comparisons appear.
  useEffect(() => {
    if (!token) return;
    const id = setInterval(() => void refresh(token), 15000);
    return () => clearInterval(id);
  }, [token, refresh]);

  const dishById = useMemo(() => {
    const map = new Map<
      string,
      {
        name: BilingualText;
        description: BilingualText | null;
        priceMinor: number;
        heroPhotoUrl: string | null;
        allergenCodes: string[];
        category: BilingualText;
      }
    >();
    for (const c of menu?.categories ?? [])
      for (const d of c.dishes)
        map.set(d.id, {
          name: d.name,
          description: d.description,
          priceMinor: d.priceMinor,
          heroPhotoUrl: d.heroPhotoUrl,
          allergenCodes: d.allergenCodes,
          category: c.name,
        });
    return map;
  }, [menu]);

  const cartLines = Object.entries(cart).filter(([, q]) => q > 0);
  const cartCount = cartLines.reduce((n, [, q]) => n + q, 0);
  const cartTotal = cartLines.reduce(
    (s, [id, q]) => s + (dishById.get(id)?.priceMinor ?? 0) * q,
    0,
  );

  function setQty(dishId: string, qty: number) {
    setCart((prev) => ({ ...prev, [dishId]: Math.max(0, qty) }));
  }
  function goTab(next: Tab) {
    setDetailId(null);
    setNotice(null);
    setTab(next);
    if (next === "farfuria" && token) void refresh(token);
  }

  async function submit() {
    if (!token || cartLines.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await placeOrder(token, {
        items: cartLines.map(([dishId, quantity]) => ({ dishId, quantity })),
      });
      setCart({});
      setCartOpen(false);
      setNotice("Comanda a fost trimisă către bucătărie. Poftă bună!");
      setTab("nota");
      await refresh(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nu am putut trimite comanda.");
    } finally {
      setSubmitting(false);
    }
  }

  async function callService(kind: "call_waiter" | "request_bill") {
    if (!token) return;
    setError(null);
    try {
      await serviceRequest(token, kind);
      setNotice(kind === "call_waiter" ? "Ospătarul a fost anunțat." : "Nota a fost solicitată.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cererea nu a putut fi trimisă.");
    }
  }

  if (error && !menu) return <p className={styles.center}>{error}</p>;
  if (!menu || !session) return <p className={styles.center}>Se deschide masa…</p>;

  const detail = detailId ? dishById.get(detailId) : undefined;

  return (
    <div className={styles.app}>
      <header className={styles.topbar}>
        <div className={styles.tableChip}>
          <span className={styles.tableEmoji} aria-hidden>
            {session.guest.emoji}
          </span>
          <div>
            <div className={styles.tableLabel}>{session.tableLabel}</div>
            <div className={styles.tableSub}>{session.guest.displayName}</div>
          </div>
        </div>
        <div className={styles.langToggle} role="group" aria-label="Limbă">
          {(["ro", "en"] as const).map((l) => (
            <button
              key={l}
              type="button"
              className={lang === l ? styles.langOn : ""}
              onClick={() => setLang(l)}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      {notice ? (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className={styles.err} role="alert">
          {error}
        </p>
      ) : null}

      <div
        className={styles.view}
        style={tab === "meniu" && cartCount > 0 ? { paddingBottom: 92 } : undefined}
      >
        {tab === "meniu" && !detail ? (
          <MeniuView
            menu={menu}
            lang={lang}
            activeCat={activeCat}
            setActiveCat={setActiveCat}
            onOpen={(id) => setDetailId(id)}
          />
        ) : null}
        {tab === "meniu" && detail && detailId ? (
          <DetailView
            dish={detail}
            lang={lang}
            inCart={cart[detailId] ?? 0}
            onAdd={() => setQty(detailId, (cart[detailId] ?? 0) + 1)}
            onBack={() => setDetailId(null)}
          />
        ) : null}
        {tab === "nota" ? (
          <NotaView
            tableLabel={session.tableLabel}
            orders={orders}
            lang={lang}
            onCallWaiter={() => callService("call_waiter")}
            onRequestBill={() => callService("request_bill")}
          />
        ) : null}
        {tab === "farfuria" ? <FarfuriaView plates={plates} lang={lang} /> : null}
      </div>

      {tab === "meniu" && cartCount > 0 ? (
        <button type="button" className={styles.cartBar} onClick={() => setCartOpen(true)}>
          <span>
            {cartCount} {cartCount === 1 ? "produs" : "produse"}
          </span>
          <span>Vezi comanda · {formatLei(cartTotal)}</span>
        </button>
      ) : null}

      <nav className={styles.tabbar}>
        <button
          type="button"
          className={`${styles.tab} ${tab === "meniu" ? styles.tabOn : ""}`}
          onClick={() => goTab("meniu")}
          aria-current={tab === "meniu"}
        >
          <IconMeniu />
          <span>Meniu</span>
        </button>
        <button
          type="button"
          className={`${styles.tab} ${tab === "nota" ? styles.tabOn : ""}`}
          onClick={() => goTab("nota")}
          aria-current={tab === "nota"}
        >
          <IconNota />
          <span>Nota</span>
        </button>
        <button
          type="button"
          className={`${styles.tab} ${tab === "farfuria" ? styles.tabOn : ""}`}
          onClick={() => goTab("farfuria")}
          aria-current={tab === "farfuria"}
        >
          <IconFarfurie />
          <span>Farfuria mea</span>
        </button>
      </nav>

      {cartOpen ? (
        <div className={styles.sheet} role="dialog" aria-modal="true">
          <div className={styles.sheetInner}>
            <div className={styles.sheetHead}>
              <h2>Comanda ta</h2>
              <button
                type="button"
                className={styles.close}
                onClick={() => setCartOpen(false)}
                aria-label="Închide"
              >
                ✕
              </button>
            </div>
            <ul className={styles.cartList}>
              {cartLines.map(([id, q]) => {
                const d = dishById.get(id);
                return (
                  <li key={id}>
                    <span>{t(d?.name, lang)}</span>
                    <span className={styles.stepper}>
                      <button type="button" onClick={() => setQty(id, q - 1)} aria-label="Scade">
                        −
                      </button>
                      <span className="tabular">{q}</span>
                      <button type="button" onClick={() => setQty(id, q + 1)} aria-label="Adaugă">
                        +
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className={styles.cartTotalRow}>
              <span>Total</span>
              <span>{formatLei(cartTotal)}</span>
            </div>
            <button
              type="button"
              className="btn btn--gold btn--block"
              disabled={submitting}
              onClick={submit}
            >
              {submitting ? "Se trimite…" : "Trimite comanda"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ===================== MENIU ===================== */
type DishInfo = {
  name: BilingualText;
  description: BilingualText | null;
  priceMinor: number;
  heroPhotoUrl: string | null;
  allergenCodes: string[];
  category: BilingualText;
};

function MeniuView({
  menu,
  lang,
  activeCat,
  setActiveCat,
  onOpen,
}: {
  menu: GuestMenu;
  lang: Lang;
  activeCat: string;
  setActiveCat: (c: string) => void;
  onOpen: (id: string) => void;
}) {
  const cats = menu.categories;
  const dishes =
    activeCat === "toate"
      ? cats.flatMap((c) => c.dishes)
      : (cats.find((c) => c.id === activeCat)?.dishes ?? []);
  const total = cats.reduce((n, c) => n + c.dishes.length, 0);

  return (
    <>
      <header className={styles.header}>
        <div className={styles.eyebrowRow}>
          <Emblem size={18} tone="var(--ochre)" />
          <span className="eyebrow">{BRAND.tagline}</span>
        </div>
        <h1 className={styles.greeting}>{BRAND.greeting}</h1>
        <p className={styles.subline}>
          Astăzi avem <strong>{total} de preparate</strong> tradiționale, gata de masă. Alege pe
          îndelete.
        </p>
      </header>

      <div className={styles.filters}>
        <button
          type="button"
          className={`${styles.filterPill} ${activeCat === "toate" ? styles.filterPillOn : ""}`}
          onClick={() => setActiveCat("toate")}
        >
          Toate
        </button>
        {cats.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`${styles.filterPill} ${activeCat === c.id ? styles.filterPillOn : ""}`}
            onClick={() => setActiveCat(c.id)}
          >
            {t(c.name, lang)}
          </button>
        ))}
      </div>

      <div className={styles.list}>
        {dishes.map((d) => (
          <button
            key={d.id}
            type="button"
            className={`card ${styles.dishCard}`}
            onClick={() => onOpen(d.id)}
          >
            <div className={styles.dishThumb}>
              <PhotoSlot url={d.heroPhotoUrl} ratio="1 / 1" radius="var(--r-sm)" alt="" />
            </div>
            <div className={styles.dishBody}>
              <span className={styles.dishName}>{t(d.name, lang)}</span>
              {d.description ? (
                <span className={styles.dishDesc}>{t(d.description, lang)}</span>
              ) : null}
              <div className={styles.dishMeta}>
                <span className={styles.price}>{formatLei(d.priceMinor)}</span>
                <span className={styles.dishArrow} aria-hidden>
                  →
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </>
  );
}

/* ===================== DETAIL ===================== */
function DetailView({
  dish,
  lang,
  inCart,
  onAdd,
  onBack,
}: {
  dish: DishInfo;
  lang: Lang;
  inCart: number;
  onAdd: () => void;
  onBack: () => void;
}) {
  return (
    <div className={styles.detail}>
      <button type="button" className={styles.backBtn} onClick={onBack}>
        <span aria-hidden>←</span> Meniu
      </button>

      <div className={styles.detailPhoto}>
        <PhotoSlot
          url={dish.heroPhotoUrl}
          ratio="4 / 3"
          radius="var(--r-lg)"
          label={t(dish.name, lang)}
          alt={t(dish.name, lang)}
        />
      </div>

      <div className={styles.detailTags}>
        <span className="chip">{t(dish.category, lang)}</span>
        {dish.allergenCodes.map((code) => (
          <span key={code} className="chip chip--gold">
            {ALLERGEN_RO[code] ?? code}
          </span>
        ))}
      </div>

      <h2 className={styles.detailName}>{t(dish.name, lang)}</h2>
      {dish.description ? <p className={styles.detailDesc}>{t(dish.description, lang)}</p> : null}

      <div className={styles.detailFoot}>
        <div>
          <span
            className="faint"
            style={{ fontSize: "0.72rem", letterSpacing: "0.08em", textTransform: "uppercase" }}
          >
            Preț
          </span>
          <div className={styles.detailPrice}>{formatLei(dish.priceMinor)}</div>
        </div>
        <button type="button" className={`btn ${inCart > 0 ? "btn--gold" : ""}`} onClick={onAdd}>
          {inCart > 0 ? `Adăugat (${inCart})` : "Adaugă la comandă"}
        </button>
      </div>
      {inCart > 0 ? (
        <p className={styles.addedNote}>
          Adăugat în comandă. Apasă bara „Vezi comanda” de jos ca să o trimiți.
        </p>
      ) : null}
    </div>
  );
}

/* ===================== NOTA ===================== */
function NotaView({
  tableLabel,
  orders,
  lang,
  onCallWaiter,
  onRequestBill,
}: {
  tableLabel: string;
  orders: GuestOrder[];
  lang: Lang;
  onCallWaiter: () => void;
  onRequestBill: () => void;
}) {
  // Distinct guests -> a stable tone, for the colored initials.
  const guestTone = new Map<string, string>();
  for (const o of orders) {
    const name = o.guest?.displayName;
    if (name && !guestTone.has(name))
      guestTone.set(name, GUEST_TONES[guestTone.size % GUEST_TONES.length] ?? "var(--vin)");
  }
  const total = orders.reduce((s, o) => s + o.totalMinor, 0);
  const legend = [...guestTone.entries()];

  return (
    <div className={styles.nota}>
      <header className={styles.notaHead}>
        <span className="eyebrow eyebrow--ink">Nota comună</span>
        <h2 className={styles.notaTitle}>{tableLabel} · împreună</h2>
        {legend.length > 0 ? (
          <div className={styles.legend}>
            {legend.map(([name, tone]) => (
              <span key={name} className={styles.legendItem}>
                <span className={styles.initial} style={{ background: tone, color: "#fff" }}>
                  {name[0]}
                </span>
                {name}
              </span>
            ))}
          </div>
        ) : null}
      </header>

      {orders.length === 0 ? (
        <div className={styles.empty}>
          Încă nu ați comandat nimic. Alege din Meniu și trimite comanda.
        </div>
      ) : (
        <>
          <div className={`card ${styles.notaTable}`}>
            {orders.flatMap((o) =>
              o.items.map((it) => {
                const who = o.guest?.displayName ?? "Masa";
                const tone = (o.guest && guestTone.get(o.guest.displayName)) || "var(--ink-faint)";
                return (
                  <div key={it.id} className={styles.notaLine}>
                    <span
                      className={styles.initialSm}
                      style={{ background: tone, color: "#fff" }}
                      title={who}
                    >
                      {who[0]}
                    </span>
                    <div className={styles.notaLineBody}>
                      <span className={styles.notaDish}>
                        {it.quantity > 1 ? `${it.quantity}× ` : ""}
                        {t(it.name, lang)}
                      </span>
                      <span className={styles.notaWho}>
                        {who} · {STATUS_RO[it.status] ?? it.status}
                      </span>
                    </div>
                    <span className={`tabular ${styles.notaPrice}`}>
                      {formatLei(it.lineTotalMinor)}
                    </span>
                  </div>
                );
              }),
            )}
            <div className={styles.totalRow}>
              <span>Total masă</span>
              <span className={`tabular ${styles.totalValue}`}>{formatLei(total)}</span>
            </div>
          </div>
          <p className={styles.notaHint}>
            Se împarte cum vă e vouă mai ușor — ospătarul ajută la nevoie.
          </p>
        </>
      )}

      <div className={styles.notaActions}>
        <button type="button" className="btn btn--ghost btn--block" onClick={onCallWaiter}>
          Cheamă ospătarul
        </button>
        <button type="button" className="btn btn--block" onClick={onRequestBill}>
          Cere nota
        </button>
      </div>
    </div>
  );
}

/* ===================== FARFURIA MEA ===================== */
function farfurieTone(fidelity: number): string {
  if (fidelity >= 8) return "var(--pine)";
  if (fidelity >= 6) return "var(--pine-soft)";
  return "var(--ochre)";
}
function keepsakeLine(fidelity: number): string {
  if (fidelity >= 9) return "Farfuria ta e fidelă rețetei — poftă bună!";
  if (fidelity >= 7.5) return "Aproape ca la bunica — poftă bună!";
  if (fidelity >= 6) return "Gustul casei, în felul tău — poftă bună!";
  return "Făcută cu drag, doar pentru tine — poftă bună!";
}

function FarfuriaView({ plates, lang }: { plates: GuestPlate[]; lang: Lang }) {
  const [sel, setSel] = useState(0);
  const plate = plates[Math.min(sel, plates.length - 1)];

  return (
    <div className={styles.farfurie}>
      <header className={styles.farfHead}>
        <span className="eyebrow eyebrow--ink">Farfuria mea</span>
        <h2 className={styles.farfTitle}>Compară-ți farfuria cu standardul casei</h2>
        <p className={styles.farfLede}>
          Un mic joc de-al nostru — cât de aproape e farfuria ta de rețeta bunicilor?
        </p>
      </header>

      {plates.length === 0 || !plate ? (
        <div className={styles.empty}>
          Farfuriile tale se compară cu rețeta casei pe măsură ce ies din bucătărie. Revino după ce
          sosesc preparatele. 🍽️
        </div>
      ) : (
        <>
          {plates.length > 1 ? (
            <div className={styles.plateStrip}>
              {plates.map((p, i) => (
                <button
                  key={p.evaluationId}
                  type="button"
                  className={`${styles.plateChip} ${i === sel ? styles.plateChipOn : ""}`}
                  onClick={() => setSel(i)}
                >
                  <span className={styles.plateChipThumb}>
                    {p.candidateUrl ? <img src={p.candidateUrl} alt="" loading="lazy" /> : null}
                  </span>
                  {t(p.dishName, lang)}
                </button>
              ))}
            </div>
          ) : null}

          <div className={styles.compareRow}>
            <div className={styles.compareCol}>
              <span className={styles.compareLabel}>Farfuria ta</span>
              <PhotoSlot
                url={plate.candidateUrl}
                ratio="1 / 1"
                radius="var(--r)"
                alt="Farfuria ta"
              />
            </div>
            <div className={styles.compareVs}>
              <Emblem size={20} tone="var(--line-strong)" />
            </div>
            <div className={styles.compareCol}>
              <span className={styles.compareLabel}>Rețeta casei</span>
              <PhotoSlot
                url={plate.referenceUrl}
                ratio="1 / 1"
                radius="var(--r)"
                label={t(plate.dishName, lang)}
                alt="Rețeta casei"
              />
            </div>
          </div>

          <div className={styles.sealWrap}>
            <Seal size={168} tone={farfurieTone(plate.fidelity)} label="Poftă bună">
              <div>
                <div
                  className={`tabular ${styles.matchNum}`}
                  style={{ color: farfurieTone(plate.fidelity) }}
                >
                  {ro1(plate.fidelity)}
                </div>
                <div className={styles.matchOf}>fidelă rețetei</div>
              </div>
            </Seal>
          </div>

          <p className={styles.keepsakeLine}>{keepsakeLine(plate.fidelity)}</p>

          {plate.chips.length > 0 ? (
            <div className={styles.delightChips}>
              {plate.chips.map((c) => (
                <span key={c} className="chip chip--pine">
                  {c}
                </span>
              ))}
            </div>
          ) : null}

          <div className={`card ${styles.keepsake}`}>
            <Emblem size={22} tone="var(--ochre)" />
            <div>
              <strong>Un suvenir de la masa ta</strong>
              <span className="muted">
                Am păstrat momentul pentru tine, cu drag de la {BRAND.name}.
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
