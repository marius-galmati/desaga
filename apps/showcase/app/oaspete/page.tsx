"use client";

import { useState } from "react";
import { PhoneFrame, PhoneStage, TourBack } from "@/components/frame";
import { DishPhoto } from "@/components/photo";
import { ALL_DISHES, DISH_COUNT_REAL, type Dish, dishById, MENU } from "@/data/menu";
import { BRAND, ro1 } from "@/lib/brand";
import { Emblem, Seal } from "@/lib/emblem";
import s from "./oaspete.module.css";

/* ---------------------------------------------------------------------------
   Guest surface — the phone app a Desaga oaspete holds at the table.
   Three tabs (Meniu / Nota / Farfuria mea) + a dish detail reachable from Meniu.
   Warm, generous, keepsake-first: the guest never sees a chef's QC verdict.
   --------------------------------------------------------------------------- */

type Tab = "meniu" | "nota" | "farfuria";

// The shared table. A few lines, each attributed to a guest at Masa 12.
const GUESTS: Record<string, { name: string; tone: string }> = {
  ana: { name: "Ana", tone: "var(--vin)" },
  mihai: { name: "Mihai", tone: "var(--pine)" },
  ioana: { name: "Ioana", tone: "var(--ochre)" },
};

const ORDER: { dishId: string; guest: keyof typeof GUESTS; qty: number }[] = [
  { dishId: "ciorba-burta", guest: "ana", qty: 1 },
  { dishId: "sarmale", guest: "ana", qty: 1 },
  { dishId: "mici", guest: "mihai", qty: 6 },
  { dishId: "papricas", guest: "mihai", qty: 1 },
  { dishId: "salau-nma", guest: "ioana", qty: 1 },
  { dishId: "taci", guest: "ioana", qty: 1 },
  { dishId: "papanasi", guest: "ana", qty: 2 },
];

const ORDER_TOTAL = ORDER.reduce((sum, l) => {
  const d = dishById(l.dishId);
  return sum + (d ? d.price * l.qty : 0);
}, 0);

function categoryOf(id: string): string {
  return MENU.find((c) => c.dishes.some((d) => d.id === id))?.name ?? "";
}

/* ---- Tab-bar icons (stroke SVG, never emoji) ---- */
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

export default function OaspetePage() {
  const [tab, setTab] = useState<Tab>("meniu");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [activeCat, setActiveCat] = useState<string>("toate");
  const [added, setAdded] = useState(false);

  const detail = detailId ? dishById(detailId) : undefined;

  function goTab(next: Tab) {
    setDetailId(null);
    setTab(next);
  }
  function openDish(id: string) {
    setAdded(false);
    setDetailId(id);
  }

  return (
    <>
      <TourBack />
      <PhoneStage>
        <PhoneFrame>
          <div className={s.app}>
            <div className={s.view}>
              {tab === "meniu" && !detail && (
                <MeniuView activeCat={activeCat} setActiveCat={setActiveCat} onOpen={openDish} />
              )}
              {tab === "meniu" && detail && (
                <DetailView
                  dish={detail}
                  added={added}
                  onAdd={() => setAdded(true)}
                  onBack={() => setDetailId(null)}
                />
              )}
              {tab === "nota" && <NotaView />}
              {tab === "farfuria" && <FarfuriaView />}
            </div>

            <nav className={s.tabbar}>
              <button
                className={`${s.tab} ${tab === "meniu" ? s.tabOn : ""}`}
                onClick={() => goTab("meniu")}
                aria-current={tab === "meniu"}
              >
                <IconMeniu />
                <span>Meniu</span>
              </button>
              <button
                className={`${s.tab} ${tab === "nota" ? s.tabOn : ""}`}
                onClick={() => goTab("nota")}
                aria-current={tab === "nota"}
              >
                <IconNota />
                <span>Nota</span>
              </button>
              <button
                className={`${s.tab} ${tab === "farfuria" ? s.tabOn : ""}`}
                onClick={() => goTab("farfuria")}
                aria-current={tab === "farfuria"}
              >
                <IconFarfurie />
                <span>Farfuria mea</span>
              </button>
            </nav>
          </div>
        </PhoneFrame>
      </PhoneStage>
    </>
  );
}

/* ===================== MENIU ===================== */
function MeniuView({
  activeCat,
  setActiveCat,
  onOpen,
}: {
  activeCat: string;
  setActiveCat: (c: string) => void;
  onOpen: (id: string) => void;
}) {
  const dishes: Dish[] =
    activeCat === "toate" ? ALL_DISHES : (MENU.find((c) => c.id === activeCat)?.dishes ?? []);

  return (
    <>
      <header className={s.header}>
        <div className={s.eyebrowRow}>
          <Emblem size={18} tone="var(--ochre)" />
          <span className="eyebrow">{BRAND.tagline}</span>
        </div>
        <h1 className={s.greeting}>{BRAND.greeting}</h1>
        <p className={s.subline}>
          Astăzi avem <strong>peste 100 de preparate</strong> tradiționale, gata de masă —{" "}
          {DISH_COUNT_REAL} în total. Alege pe îndelete.
        </p>
      </header>

      <div className={s.filters}>
        <button
          className={`${s.filterPill} ${activeCat === "toate" ? s.filterPillOn : ""}`}
          onClick={() => setActiveCat("toate")}
        >
          Toate
        </button>
        {MENU.map((c) => (
          <button
            key={c.id}
            className={`${s.filterPill} ${activeCat === c.id ? s.filterPillOn : ""}`}
            onClick={() => setActiveCat(c.id)}
          >
            {c.name}
          </button>
        ))}
      </div>

      <div className={s.list}>
        {dishes.map((d) => (
          <button key={d.id} className={`card ${s.dishCard}`} onClick={() => onOpen(d.id)}>
            <div className={s.dishThumb}>
              <DishPhoto tone={d.tone} ratio="1 / 1" radius="var(--r-sm)" />
            </div>
            <div className={s.dishBody}>
              {d.signature && (
                <span className={s.sigTag}>
                  <Emblem size={13} tone="var(--ochre)" />
                  Semnătura casei
                </span>
              )}
              <span className={s.dishName}>{d.name}</span>
              <span className={s.dishDesc}>{d.desc}</span>
              <div className={s.dishMeta}>
                <span className={s.price}>{d.price} lei</span>
                <span className={s.dishArrow} aria-hidden>
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
  added,
  onAdd,
  onBack,
}: {
  dish: Dish;
  added: boolean;
  onAdd: () => void;
  onBack: () => void;
}) {
  return (
    <div className={s.detail}>
      <button className={s.backBtn} onClick={onBack}>
        <span aria-hidden>←</span> Meniu
      </button>

      <div className={s.detailPhoto}>
        <DishPhoto tone={dish.tone} label={dish.name} ratio="4 / 3" radius="var(--r-lg)" />
      </div>

      <div className={s.detailTags}>
        <span className="chip">{categoryOf(dish.id)}</span>
        {dish.signature && <span className="chip chip--gold">Semnătura casei</span>}
        <span className="chip chip--pine">Se servește cald</span>
      </div>

      <h2 className={s.detailName}>{dish.name}</h2>
      <p className={s.detailDesc}>{dish.desc}</p>

      <div className={s.detailFoot}>
        <div>
          <span
            className="faint"
            style={{ fontSize: "0.72rem", letterSpacing: "0.08em", textTransform: "uppercase" }}
          >
            Preț
          </span>
          <div className={s.detailPrice}>{dish.price} lei</div>
        </div>
        <button className={`btn ${added ? "btn--gold" : ""}`} onClick={onAdd} disabled={added}>
          {added ? "Adăugat la Masa 12" : "Adaugă la comandă"}
        </button>
      </div>
      {added && <p className={s.addedNote}>S-a adăugat pe nota comună a mesei. Poftă bună!</p>}
    </div>
  );
}

/* ===================== NOTA ===================== */
function NotaView() {
  return (
    <div className={s.nota}>
      <header className={s.notaHead}>
        <span className="eyebrow eyebrow--ink">Nota comună</span>
        <h2 className={s.notaTitle}>Masa 12 · împreună</h2>
        <div className={s.legend}>
          {Object.entries(GUESTS).map(([id, g]) => (
            <span key={id} className={s.legendItem}>
              <span className={s.initial} style={{ background: g.tone }}>
                {g.name[0]}
              </span>
              {g.name}
            </span>
          ))}
        </div>
      </header>

      <div className={`card ${s.notaTable}`}>
        {ORDER.map((line, i) => {
          const d = dishById(line.dishId);
          const g = GUESTS[line.guest];
          if (!d || !g) return null;
          return (
            <div key={i} className={s.notaLine}>
              <span className={s.initialSm} style={{ background: g.tone }} title={g.name}>
                {g.name[0]}
              </span>
              <div className={s.notaLineBody}>
                <span className={s.notaDish}>{d.name}</span>
                <span className={s.notaWho}>
                  {g.name}
                  {line.qty > 1 ? ` · ${line.qty} porții` : ""}
                </span>
              </div>
              <span className={`tabular ${s.notaPrice}`}>{d.price * line.qty} lei</span>
            </div>
          );
        })}

        <div className={s.totalRow}>
          <span>Total masă</span>
          <span className={`tabular ${s.totalValue}`}>{ORDER_TOTAL} lei</span>
        </div>
      </div>

      <p className={s.notaHint}>Se împarte cum vă e vouă mai ușor — ospătarul ajută la nevoie.</p>

      <div className={s.notaActions}>
        <button className="btn btn--ghost btn--block">Cheamă ospătarul</button>
        <button className="btn btn--block">Cere nota</button>
      </div>
    </div>
  );
}

/* ===================== FARFURIA MEA ===================== */
function FarfuriaView() {
  const ref = dishById("sarmale");
  const match = 96;

  return (
    <div className={s.farfurie}>
      <header className={s.farfHead}>
        <span className="eyebrow eyebrow--ink">Farfuria mea</span>
        <h2 className={s.farfTitle}>Compară-ți farfuria cu standardul casei</h2>
        <p className={s.farfLede}>
          Un mic joc de-al nostru — cât de aproape e farfuria ta de rețeta bunicilor?
        </p>
      </header>

      <div className={s.compareRow}>
        <div className={s.compareCol}>
          <span className={s.compareLabel}>Farfuria ta</span>
          <DishPhoto tone={ref?.tone ?? "#6f4326"} ratio="1 / 1" radius="var(--r)" />
        </div>
        <div className={s.compareVs}>
          <Emblem size={20} tone="var(--line-strong)" />
        </div>
        <div className={s.compareCol}>
          <span className={s.compareLabel}>Rețeta casei</span>
          <DishPhoto
            tone={ref?.tone ?? "#6f4326"}
            label={ref?.name ?? "Rețeta casei"}
            ratio="1 / 1"
            radius="var(--r)"
          />
        </div>
      </div>

      <div className={s.sealWrap}>
        <Seal size={168} tone="var(--pine)" label="Poftă bună">
          <div>
            <div className={`tabular ${s.matchNum}`}>{ro1(match / 10)}</div>
            <div className={s.matchOf}>fidelă rețetei</div>
          </div>
        </Seal>
      </div>

      <p className={s.keepsakeLine}>Farfuria ta e fidelă rețetei — poftă bună!</p>

      <div className={s.delightChips}>
        <span className="chip chip--pine">Montaj generos</span>
        <span className="chip chip--pine">Culori vii</span>
        <span className="chip chip--pine">Ca acasă</span>
      </div>

      <div className={`card ${s.keepsake}`}>
        <Emblem size={22} tone="var(--ochre)" />
        <div>
          <strong>Un suvenir de la masa ta</strong>
          <span className="muted">
            Am păstrat momentul pentru tine, cu drag de la {BRAND.name}.
          </span>
        </div>
      </div>
    </div>
  );
}
