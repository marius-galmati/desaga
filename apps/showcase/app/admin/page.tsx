"use client";

import { SCORING_CRITERIA } from "@boca/config";
import { useState } from "react";
import { SurfaceHeader, TourBack } from "@/components/frame";
import { DishPhoto, PlateThumb } from "@/components/photo";
import { ALL_DISHES, type Dish, dishById, MENU } from "@/data/menu";
import { BRAND } from "@/lib/brand";
import { Emblem } from "@/lib/emblem";
import s from "./admin.module.css";

/* ============================================================================
   Administrare — the CMS / super-admin surface. A warm heritage control panel:
   a serif-titled sidebar switches between the menu, the 4K photo library, the
   AI gold-standard reference sets, the head-chef tolerances, and settings.
   ============================================================================ */

type NavKey = "meniu" | "fotografii" | "referinte" | "tolerante" | "setari";
type Lang = "ro" | "en";

const NAV: { key: NavKey; label: string; count?: string }[] = [
  { key: "meniu", label: "Meniu", count: `${ALL_DISHES.length}` },
  { key: "fotografii", label: "Fotografii", count: "4K" },
  { key: "referinte", label: "Seturi de referință" },
  { key: "tolerante", label: "Toleranțe" },
  { key: "setari", label: "Setări" },
];

/* Dishes whose gold-standard reference photos have gone stale. */
const STALE_REFS = new Set(["taci", "papricas"]);

/* Head-chef tolerance authoring: a RO helper + a seed position (strict→permisiv)
   per scoring criterion. Keyed by the stable criterion key. */
const TOL_META: Record<string, { helper: string; seed: number }> = {
  components: { helper: "Elemente lipsă sau străine în farfurie — se recomandă strict.", seed: 20 },
  arrangement: { helper: "Poziționare și compoziție — abaterile mici sunt firești.", seed: 42 },
  sauce: { helper: "Formă, cantitate și margini curate ale sosului — moderat.", seed: 46 },
  cleanliness: { helper: "Cel mai obiectiv criteriu — ține-l aproape de strict.", seed: 16 },
  color: { helper: "Toleranță mai mare — sensibil la lumina din sală.", seed: 70 },
  portion: { helper: "Proporții vizuale, nu grame — moderat.", seed: 48 },
};

const REF_DISHES = ["sarmale", "salau-nma", "papanasi", "taci"];

const ROLES: { name: string; desc: string }[] = [
  { name: "Bucătar-șef", desc: "Definește toleranțe și seturi de referință" },
  { name: "Bucătar la pass", desc: "Fotografiază montajul, primește scorul AI" },
  { name: "Ospătar", desc: "Comenzi de la masă, secțiuni proprii" },
  { name: "Manager locație", desc: "Rapoarte, coaching, tendințe" },
  { name: "Administrator", desc: "Meniu, foto, utilizatori, setări" },
];

export default function AdminPage() {
  const [nav, setNav] = useState<NavKey>("meniu");

  return (
    <div className={s.wrap}>
      <TourBack />
      <div className="container">
        <SurfaceHeader eyebrow="Panou de control" title="Administrare" />

        <div className={s.body}>
          <nav className={s.nav} aria-label="Secțiuni administrare">
            <div className={s.navLabel}>
              <span className="eyebrow eyebrow--ink">Secțiuni</span>
            </div>
            {NAV.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`${s.navItem} ${nav === item.key ? s.navItemActive : ""}`}
                aria-current={nav === item.key ? "page" : undefined}
                onClick={() => setNav(item.key)}
              >
                <span>{item.label}</span>
                {item.count ? <span className={s.navCount}>{item.count}</span> : null}
              </button>
            ))}
            <p className={s.navFoot}>
              {BRAND.full}
              <br />
              {BRAND.locations.join(" · ")}
            </p>
          </nav>

          <main className={s.panel}>
            {nav === "meniu" && <MenuPanel />}
            {nav === "fotografii" && <PhotosPanel />}
            {nav === "referinte" && <ReferencePanel />}
            {nav === "tolerante" && <TolerancePanel />}
            {nav === "setari" && <SettingsPanel />}
          </main>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 1 · MENIU                                                                   */
/* -------------------------------------------------------------------------- */

function MenuPanel() {
  const [lang, setLang] = useState<Lang>("ro");
  const [off, setOff] = useState<Set<string>>(new Set(["papricas"]));

  const toggle = (id: string) =>
    setOff((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <div className={s.panelHead}>
        <div>
          <span className="eyebrow eyebrow--ink">Conținut · versionat</span>
          <h2>Meniu</h2>
          <p className={s.panelIntro}>
            Preparatele publicate în aplicația oaspeților. Editează denumiri, prețuri și
            disponibilitatea, în română și engleză.
          </p>
        </div>
        <div className={s.headActions}>
          <div className={s.langToggle} role="group" aria-label="Limbă de editare">
            <button
              type="button"
              className={`${s.langChip} ${lang === "ro" ? s.langChipActive : ""}`}
              onClick={() => setLang("ro")}
            >
              Română
            </button>
            <button
              type="button"
              className={`${s.langChip} ${lang === "en" ? s.langChipActive : ""}`}
              onClick={() => setLang("en")}
            >
              English
            </button>
          </div>
          <button type="button" className="btn btn--gold btn--sm">
            + Adaugă preparat
          </button>
        </div>
      </div>

      {MENU.map((cat) => (
        <section key={cat.id} className={s.catBlock}>
          <div className={s.catHead}>
            <h3>{cat.name}</h3>
            {cat.note ? <span className={s.catNote}>{cat.note}</span> : null}
          </div>
          <div className={s.dishList}>
            {cat.dishes.map((dish) => {
              const isOff = off.has(dish.id);
              return (
                <div key={dish.id} className={`${s.dishRow} ${isOff ? s.dishRowOff : ""}`}>
                  <div className={s.thumb}>
                    <DishPhoto tone={dish.tone} ratio="1 / 1" radius="var(--r-sm)" />
                  </div>

                  <div className={s.dishMeta}>
                    <div className={s.dishNameRow}>
                      <span className={`${s.dishName} ${isOff ? s.dishNameOff : ""}`}>
                        {dish.name}
                      </span>
                      {dish.signature ? <span className={s.sig}>Semnătură</span> : null}
                      {STALE_REFS.has(dish.id) ? (
                        <span className="chip chip--gold" title="Setul de referință AI e învechit">
                          <span aria-hidden>◆</span> refs învechite
                        </span>
                      ) : null}
                    </div>
                    {lang === "en" ? (
                      <div className={`${s.dishSub} ${s.enMissing}`}>Traducere EN de completat</div>
                    ) : (
                      <div className={s.dishSub}>{dish.desc}</div>
                    )}
                  </div>

                  <div className={s.dishCtrls}>
                    <span className={`${s.price} ${isOff ? s.priceOff : ""}`}>
                      {dish.price} lei
                    </span>
                    <button
                      type="button"
                      className={`${s.avail} ${isOff ? s.availOff : ""}`}
                      aria-pressed={!isOff}
                      onClick={() => toggle(dish.id)}
                    >
                      {isOff ? "86" : "Disponibil"}
                      <span className={s.availDot} aria-hidden />
                    </button>
                    <button type="button" className={s.linkBtn}>
                      Editează
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* 2 · FOTOGRAFII (lighter)                                                    */
/* -------------------------------------------------------------------------- */

function PhotosPanel() {
  return (
    <>
      <div className={s.panelHead}>
        <div>
          <span className="eyebrow eyebrow--ink">Bibliotecă · 4K</span>
          <h2>Fotografii</h2>
          <p className={s.panelIntro}>
            Fotografia oficială a fiecărui preparat, la rezoluție mare. Aceleași imagini apar pe
            toate suprafețele.
          </p>
        </div>
      </div>

      <div className={s.photoGrid}>
        <div className={s.dropzone}>
          <Emblem size={34} tone="var(--ochre)" />
          <h4>Încarcă fotografii noi</h4>
          <p className={s.dropzoneSub}>
            Trage fișierele aici sau răsfoiește. JPEG/PNG la minim 4K, lumină de studio, fundal
            neutru.
          </p>
          <button type="button" className="btn btn--outline-gold btn--sm">
            Răsfoiește fișiere
          </button>
        </div>

        {ALL_DISHES.map((dish) => (
          <figure key={dish.id} className={s.photoTile}>
            <DishPhoto tone={dish.tone} ratio="4 / 3" label={dish.name} />
            <figcaption className={s.photoCap}>
              <span className={s.photoRes}>4032 × 3024</span>
              <button type="button" className={s.linkBtn}>
                Înlocuiește
              </button>
            </figcaption>
          </figure>
        ))}
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* 3 · SETURI DE REFERINȚĂ                                                     */
/* -------------------------------------------------------------------------- */

function ReferencePanel() {
  const [dishId, setDishId] = useState<string>("sarmale");
  const dish = dishById(dishId);
  if (!dish) return null;

  return (
    <>
      <div className={s.panelHead}>
        <div>
          <span className="eyebrow eyebrow--ink">Standard aur · AI</span>
          <h2>Seturi de referință</h2>
          <p className={s.panelIntro}>
            Farfuriile-etalon față de care inteligența artificială compară montajul de la pass.
            Fiecare set e versionat și legat de un preparat.
          </p>
        </div>
      </div>

      <div className={s.pickerRow}>
        {REF_DISHES.map((id) => {
          const d = dishById(id);
          if (!d) return null;
          return (
            <button
              key={id}
              type="button"
              className={`${s.pick} ${dishId === id ? s.pickActive : ""}`}
              onClick={() => setDishId(id)}
            >
              {d.name}
            </button>
          );
        })}
      </div>

      <div className={`card ${s.refCard}`}>
        <div className={s.refTop}>
          <div>
            <h3>{dish.name}</h3>
            <div className={s.setTag}>
              <span className="chip chip--pine">Set activ</span>
              <span className={s.setVer}>· v1</span>
            </div>
          </div>
          <button type="button" className="btn btn--ghost btn--sm">
            reîncarcă set
          </button>
        </div>

        <div className={s.thumbGroup}>
          <div className={s.thumbSet}>
            <div className={s.thumbSetLabel}>
              <span className="eyebrow eyebrow--ink">Primare</span>
              <span className="faint" style={{ fontSize: "0.76rem" }}>
                folosite la scorare
              </span>
            </div>
            <div className={s.thumbRow}>
              <PlateThumb tone={dish.tone} size={78} />
              <PlateThumb tone={dish.tone} size={78} />
              <PlateThumb tone={dish.tone} size={78} />
            </div>
          </div>

          <div className={s.thumbSet}>
            <div className={s.thumbSetLabel}>
              <span className="eyebrow eyebrow--ink">Holdout</span>
              <span className="faint" style={{ fontSize: "0.76rem" }}>
                verificare, neexpuse
              </span>
            </div>
            <div className={s.thumbRow}>
              <div className={s.holdout}>
                <PlateThumb tone={dish.tone} size={78} />
              </div>
              <div className={s.holdout}>
                <PlateThumb tone={dish.tone} size={78} />
              </div>
            </div>
          </div>
        </div>

        <div className={s.refNotes}>
          <p className={s.noteLine}>
            <span className={s.noteMark} aria-hidden>
              ◆
            </span>
            <span>
              Fotografiate cu același dispozitiv ca la pass — aceeași lentilă, aceeași lumină.
            </span>
          </p>
          <p className={s.noteLine}>
            <span className={s.noteMark} aria-hidden>
              ◆
            </span>
            <span>
              „reîncarcă set” pornește o sesiune nouă de captură; setul vechi rămâne arhivat și
              legat de evaluările deja făcute.
            </span>
          </p>
        </div>

        <div className={s.staleBox}>
          <strong>Învechire dură.</strong> Dacă preparatul își schimbă rețeta sau montajul, setul
          devine neconform pentru comparație și trebuie refăcut — altfel scorurile AI nu mai
          reflectă standardul actual. Preparatele marcate „refs învechite” în meniu au nevoie de
          recaptură.
        </div>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* 4 · TOLERANȚE                                                               */
/* -------------------------------------------------------------------------- */

function TolerancePanel() {
  const [dishId, setDishId] = useState<string>("sarmale");
  const dish: Dish | undefined = dishById(dishId);
  const [values, setValues] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const c of SCORING_CRITERIA) init[c.key] = TOL_META[c.key]?.seed ?? 50;
    return init;
  });

  const setValue = (key: string, v: number) => setValues((prev) => ({ ...prev, [key]: v }));

  const bucket = (v: number) => (v < 34 ? "strict" : v > 66 ? "permisiv" : "echilibrat");

  if (!dish) return null;

  return (
    <>
      <div className={s.panelHead}>
        <div>
          <span className="eyebrow eyebrow--ink">Bucătar-șef · versionat</span>
          <h2>Toleranțe</h2>
          <p className={s.panelIntro}>
            Cât de aproape de etalon trebuie să fie montajul pe fiecare criteriu. Aici se definește
            ce contează drept abatere.
          </p>
        </div>
      </div>

      <div className={s.pickerRow}>
        {REF_DISHES.map((id) => {
          const d = dishById(id);
          if (!d) return null;
          return (
            <button
              key={id}
              type="button"
              className={`${s.pick} ${dishId === id ? s.pickActive : ""}`}
              onClick={() => setDishId(id)}
            >
              {d.name}
            </button>
          );
        })}
      </div>

      <div className={`card ${s.tolCard}`}>
        <div className={s.refTop}>
          <div>
            <h3>{dish.name}</h3>
            <div className={s.setTag}>
              <span className="chip chip--gold">Profil toleranțe</span>
              <span className={s.setVer}>· v1</span>
            </div>
          </div>
        </div>

        <div className={s.tolList}>
          {SCORING_CRITERIA.map((c) => {
            const v = values[c.key] ?? 50;
            return (
              <div key={c.key} className={s.tolRow}>
                <div>
                  <div className={s.tolName}>{c.labelRo}</div>
                  <p className={s.tolHelp}>{TOL_META[c.key]?.helper}</p>
                </div>
                <div className={s.tolSlider}>
                  <div className={s.tolScale}>
                    <span>strict</span>
                    <span className={s.tolValue}>{bucket(v)}</span>
                    <span>permisiv</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={v}
                    className={s.range}
                    aria-label={`Toleranță: ${c.labelRo}`}
                    onChange={(e) => setValue(c.key, Number(e.target.value))}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className={s.tolFoot}>
          <p className={s.tolFootNote}>
            Aceste praguri definesc ce înseamnă „abatere” pentru AI. Sunt scrise de bucătarul-șef și
            versionate — fiecare evaluare reține profilul cu care a fost scorată.
          </p>
          <button type="button" className="btn btn--gold btn--sm">
            Publică versiunea
          </button>
        </div>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* 5 · SETĂRI (lighter)                                                        */
/* -------------------------------------------------------------------------- */

function SettingsPanel() {
  return (
    <>
      <div className={s.panelHead}>
        <div>
          <span className="eyebrow eyebrow--ink">Cont · locații</span>
          <h2>Setări</h2>
          <p className={s.panelIntro}>Datele restaurantului, locațiile și rolurile echipei.</p>
        </div>
      </div>

      <div className={s.settingsGrid}>
        <div className={`card ${s.setBlock}`}>
          <h3>Restaurant</h3>
          <span className="faint" style={{ fontSize: "0.84rem" }}>
            {BRAND.full}
          </span>
          <div className={s.fieldList}>
            <label className={s.field}>
              <span className={s.fieldLabel}>Denumire</span>
              <input className={s.fieldInput} defaultValue={BRAND.name} />
            </label>
            <label className={s.field}>
              <span className={s.fieldLabel}>Slogan</span>
              <input className={s.fieldInput} defaultValue={BRAND.tagline} />
            </label>
          </div>
        </div>

        <div className={`card ${s.setBlock}`}>
          <h3>Locații</h3>
          <span className="faint" style={{ fontSize: "0.84rem" }}>
            Puncte de lucru active
          </span>
          <div className={s.fieldList}>
            <label className={s.field}>
              <span className={s.fieldLabel}>Locație principală</span>
              <input className={s.fieldInput} defaultValue={BRAND.locations[0]} />
            </label>
            <label className={s.field}>
              <span className={s.fieldLabel}>A doua locație</span>
              <input className={s.fieldInput} defaultValue={BRAND.locations[1]} />
            </label>
          </div>
        </div>

        <div className={`card ${s.setBlock}`} style={{ gridColumn: "1 / -1" }}>
          <h3>Roluri</h3>
          <span className="faint" style={{ fontSize: "0.84rem" }}>
            Cine ce poate face în aplicații
          </span>
          <div className={s.roleList}>
            {ROLES.map((r) => (
              <div key={r.name} className={s.roleRow}>
                <div>
                  <div className={s.roleName}>{r.name}</div>
                  <div className={s.roleDesc}>{r.desc}</div>
                </div>
                <button type="button" className={s.linkBtn}>
                  Permisiuni
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
