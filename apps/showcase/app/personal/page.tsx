"use client";

import { useState } from "react";
import { PhoneFrame, PhoneStage, TourBack } from "@/components/frame";
import { DishPhoto } from "@/components/photo";
import { CHEFS, PASS_QUEUE, TABLES, type TableState, type Ticket } from "@/data/ops";
import { Emblem } from "@/lib/emblem";
import s from "./personal.module.css";

/* --------------------------------------------------------------------------
   Local, co-located order data. The shared ops dataset carries table state
   and totals; the per-table check lines live here (staff surface only) so we
   don't touch the shared module. Line sums match TABLES[].total.
   -------------------------------------------------------------------------- */
type OrderLine = { name: string; qty: number; price: number; course: string };

const ORDER_LINES: Record<number, OrderLine[]> = {
  3: [
    { name: "Biftec tartar", qty: 2, price: 68, course: "Principal" },
    { name: "Papricaș de pui zglobiu", qty: 1, price: 54, course: "Principal" },
    { name: "Șalău „Nu mă uita”", qty: 1, price: 72, course: "Principal" },
    { name: "Fetească Neagră, carafă", qty: 1, price: 96, course: "Vin" },
    { name: "Papanași ropogoși", qty: 2, price: 34, course: "Desert" },
  ],
  7: [
    { name: "Papricaș de pui zglobiu", qty: 1, price: 54, course: "Principal" },
    { name: "Biftec tartar", qty: 1, price: 68, course: "Principal" },
    { name: "Fetească Regală, pahar", qty: 2, price: 25, course: "Vin" },
    { name: "Apă minerală", qty: 1, price: 14, course: "Băuturi" },
  ],
  12: [
    { name: "Ciorbă de văcuță", qty: 2, price: 34, course: "Intrare" },
    { name: "Sarmale durdulii cu ciolan", qty: 3, price: 58, course: "Principal" },
    { name: "Taci și-nghite", qty: 2, price: 46, course: "Principal" },
    { name: "Fetească Neagră, sticlă", qty: 1, price: 148, course: "Vin" },
    { name: "Apă plată", qty: 2, price: 14, course: "Băuturi" },
    { name: "Papanași ropogoși", qty: 3, price: 34, course: "Desert" },
  ],
  5: [
    { name: "Ciorbă rădăuțeană", qty: 2, price: 30, course: "Intrare" },
    { name: "Fetească Regală, pahar", qty: 2, price: 17, course: "Vin" },
  ],
  14: [
    { name: "Platou aperitive transilvănean", qty: 1, price: 120, course: "Intrare" },
    { name: "Antricot de vită Limousin", qty: 3, price: 128, course: "Principal" },
    { name: "Sarmale durdulii cu ciolan", qty: 2, price: 58, course: "Principal" },
    { name: "Șalău „Nu mă uita”", qty: 2, price: 72, course: "Principal" },
    { name: "Fetească Neagră, sticlă", qty: 2, price: 148, course: "Vin" },
    { name: "Apă plată", qty: 3, price: 6, course: "Băuturi" },
    { name: "Papanași ropogoși", qty: 3, price: 34, course: "Desert" },
  ],
};

const SECTIONS = ["Salon", "Terasă", "Foișor"] as const;
const CURRENT_WAITER = "Maria";

const STATUS_META: Record<TableState["status"], { label: string; card: string; pill: string }> = {
  liber: { label: "Liber", card: s.stLiber ?? "", pill: s.pillLiber ?? "" },
  ocupat: { label: "Ocupat", card: s.stOcupat ?? "", pill: s.pillOcupat ?? "" },
  cere_nota: { label: "Cere nota", card: s.stCereNota ?? "", pill: s.pillCereNota ?? "" },
  cheama: { label: "Cheamă", card: s.stCheama ?? "", pill: s.pillCheama ?? "" },
};

function lei(n: number): string {
  return `${n.toLocaleString("ro-RO")} lei`;
}

/* ============================== WAITER PHONE ============================== */

function WaiterView() {
  const [section, setSection] = useState<(typeof SECTIONS)[number]>("Salon");
  const [openId, setOpenId] = useState<number | null>(12);

  const alerting = TABLES.filter((t) => t.status === "cheama" || t.status === "cere_nota");
  const tables = TABLES.filter((t) => t.section === section);

  return (
    <div className={s.screen}>
      <header className={s.wHead}>
        <div>
          <span className="eyebrow eyebrow--ink">Sala ta · tura de seară</span>
          <h1 className={s.wTitle}>Bună seara, {CURRENT_WAITER}</h1>
        </div>
        <span className={s.avatar} aria-hidden>
          {CURRENT_WAITER.charAt(0)}
        </span>
      </header>

      {alerting.length > 0 && (
        <div className={s.banners}>
          {alerting.map((t) =>
            t.status === "cheama" ? (
              <div key={t.id} className={`${s.banner} ${s.bannerVin}`}>
                <span className={s.bannerDot} aria-hidden />
                <span className={s.bannerText}>Masa {t.id} cheamă ospătarul</span>
                <span className={`${s.bannerTime} tabular`}>00:24</span>
              </div>
            ) : (
              <div key={t.id} className={`${s.banner} ${s.bannerOchre}`}>
                <span className={s.bannerText}>Masa {t.id} cere nota</span>
                <span className={s.bannerMeta}>{lei(t.total ?? 0)}</span>
              </div>
            ),
          )}
        </div>
      )}

      <div className={s.sections} role="tablist" aria-label="Secțiuni">
        {SECTIONS.map((sec) => {
          const count = TABLES.filter((t) => t.section === sec).length;
          const on = sec === section;
          return (
            <button
              key={sec}
              role="tab"
              aria-selected={on}
              className={`${s.secBtn} ${on ? s.secBtnOn : ""}`}
              onClick={() => setSection(sec)}
            >
              {sec}
              <span className={s.secCount}>{count}</span>
            </button>
          );
        })}
      </div>

      <div className={s.tables}>
        {tables.map((t) => {
          const meta = STATUS_META[t.status];
          const open = openId === t.id;
          const lines = ORDER_LINES[t.id] ?? [];
          return (
            <div key={t.id} className={`${s.tcard} ${meta.card} ${open ? s.tcardOn : ""}`}>
              <button
                className={s.tcardBtn}
                onClick={() => setOpenId(open ? null : t.id)}
                aria-expanded={open}
              >
                <span className={s.tnum}>
                  <span className={s.tnumBig}>{t.id}</span>
                  <span className={s.tseats}>{t.seats} loc.</span>
                </span>
                <span className={s.tbody}>
                  <span className={`${s.pill} ${meta.pill}`}>{meta.label}</span>
                  {t.status !== "liber" ? (
                    <span className={s.tmeta}>
                      <span>{t.guests} oaspeți</span>
                      <span aria-hidden>·</span>
                      <span className="tabular">acum {t.openedMin}′</span>
                    </span>
                  ) : (
                    <span className={s.tmeta}>Pregătită · {t.waiter}</span>
                  )}
                </span>
                <span className={s.tright}>
                  {t.status !== "liber" && (
                    <span className={`${s.ttotal} tabular`}>{lei(t.total ?? 0)}</span>
                  )}
                  <span className={s.twaiter}>{t.waiter}</span>
                </span>
              </button>

              {open && t.status !== "liber" && (
                <div className={s.detail}>
                  {lines.map((l, i) => (
                    <div key={i} className={s.oline}>
                      <span className={`${s.olQty} tabular`}>{l.qty}×</span>
                      <span className={s.olName}>
                        {l.name}
                        <span className={s.olCourse}>{l.course}</span>
                      </span>
                      <span className={`${s.olPrice} tabular`}>{lei(l.qty * l.price)}</span>
                    </div>
                  ))}
                  <div className={s.ototal}>
                    <span>Total masă</span>
                    <span className="tabular">{lei(t.total ?? 0)}</span>
                  </div>
                  <div className={s.detailActions}>
                    <button className="btn btn--ghost btn--sm">Curs nou</button>
                    <button className="btn btn--gold btn--sm">
                      {t.status === "cheama" ? "Am preluat masa" : "Cere nota"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* =============================== PASS PHONE =============================== */

function PassView() {
  const next: Ticket | undefined = PASS_QUEUE[0];
  const rest = PASS_QUEUE.slice(1);
  const [chefSel, setChefSel] = useState<string>(next?.chef ?? CHEFS[0]?.name ?? "");
  const attribution = CHEFS.slice(0, 4);

  return (
    <div className={s.pass}>
      <header className={s.pHead}>
        <div>
          <span className="eyebrow eyebrow--dark">Pass · montaj</span>
          <h1 className={s.pTitle}>Coada de montaj</h1>
        </div>
        <span className={s.pCount}>
          <span className={s.pCountDot} aria-hidden />
          <span className="tabular">{PASS_QUEUE.length}</span> la rând
        </span>
      </header>

      {next && (
        <section className={s.capture}>
          <div className={s.capMeta}>
            <span className={s.capTable}>Masa {next.table}</span>
            <span className={s.capCourse}>{next.course}</span>
            <span className={`${s.capWait} tabular`}>{next.waitMin} min</span>
          </div>
          <h2 className={s.capDish}>{next.dish}</h2>

          <div className={s.vf}>
            <div className={s.vfGhost} aria-hidden>
              <DishPhoto tone="var(--vin)" ratio="1 / 1" radius="0" />
            </div>
            <span className={`${s.br} ${s.brTL}`} aria-hidden />
            <span className={`${s.br} ${s.brTR}`} aria-hidden />
            <span className={`${s.br} ${s.brBL}`} aria-hidden />
            <span className={`${s.br} ${s.brBR}`} aria-hidden />
            <div className={s.vfGuide} aria-hidden>
              <Emblem size={46} tone="var(--ochre-soft)" />
            </div>
            <span className={s.vfCap}>Așază farfuria în cadru</span>
          </div>

          <button className="btn btn--gold btn--block">Fotografiază montajul</button>
          <p className={s.hint}>Montajul e comparat automat cu standardul preparatului.</p>

          <div className={s.attr}>
            <span className={s.attrLabel}>Montaj de</span>
            <div className={s.attrChips}>
              {attribution.map((c) => {
                const on = c.name === chefSel;
                return (
                  <button
                    key={c.id}
                    className={`${s.chefChip} ${on ? s.chefChipOn : ""}`}
                    onClick={() => setChefSel(c.name)}
                    aria-pressed={on}
                  >
                    <span className={s.chefInit}>{c.initials}</span>
                    {c.name.split(" ")[0]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className={s.ghosts}>
            <button className={s.ghostBtn}>Sari peste</button>
            <span className={s.ghostSep} aria-hidden>
              ·
            </span>
            <button className={s.ghostBtn}>Re-trimite</button>
          </div>
        </section>
      )}

      <div className={s.queueHead}>
        <span className="eyebrow eyebrow--dark">Următoarele la rând</span>
        <span className={s.rule} aria-hidden />
      </div>

      <div className={s.queue}>
        {rest.map((t) => {
          const chef = CHEFS.find((c) => c.name === t.chef);
          return (
            <div key={t.id} className={s.qrow}>
              <span className={s.qnum}>{t.table}</span>
              <span className={s.qbody}>
                <span className={s.qdish}>{t.dish}</span>
                <span className={s.qmeta}>
                  {t.course} · {t.chef}
                </span>
              </span>
              <span className={s.qside}>
                <span className={s.qchip}>{chef?.initials ?? "—"}</span>
                <span className={`${s.qwait} tabular`}>{t.waitMin}′</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ================================= PAGE ================================= */

export default function PersonalPage() {
  return (
    <>
      <TourBack />
      <PhoneStage>
        <div className={s.col}>
          <PhoneFrame>
            <WaiterView />
          </PhoneFrame>
          <div className={s.cap}>
            <span className="eyebrow eyebrow--ink">Ospătar · sală</span>
            <span className={s.capName}>Comenzile și mesele tale</span>
          </div>
        </div>

        <div className={s.col}>
          <PhoneFrame dark>
            <PassView />
          </PhoneFrame>
          <div className={s.cap}>
            <span className="eyebrow eyebrow--ink">Pass · bucătărie</span>
            <span className={s.capName}>Montajul, capturat la trecere</span>
          </div>
        </div>
      </PhoneStage>
    </>
  );
}
