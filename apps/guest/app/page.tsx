"use client";

import type { GuestMenu, GuestTable } from "@boca/contracts";
import { useEffect, useMemo, useState } from "react";
import { BRAND } from "@/lib/brand";
import { Emblem } from "@/lib/emblem";
import { fetchMenu, fetchTables, formatLei } from "@/lib/menu";
import { useTenant } from "@/lib/tenant";
import styles from "./page.module.css";

type Lang = "ro" | "en";

// EU-14 allergen codes → short Romanian labels for the guest chips.
const ALLERGEN_RO: Record<string, string> = {
  gluten: "Gluten",
  crustaceans: "Crustacee",
  eggs: "Ouă",
  fish: "Pește",
  peanuts: "Arahide",
  soy: "Soia",
  soya: "Soia",
  milk: "Lapte",
  nuts: "Fructe cu coajă",
  celery: "Țelină",
  mustard: "Muștar",
  sesame: "Susan",
  sulphites: "Sulfiți",
  lupin: "Lupin",
  molluscs: "Moluște",
};

const UI = {
  ro: { lead: "Meniul nostru", allergens: "Alergeni", loading: "Se încarcă meniul…" },
  en: { lead: "Our menu", allergens: "Allergens", loading: "Loading the menu…" },
} as const;

export default function GuestMenuPage() {
  const tenant = useTenant();
  const [menu, setMenu] = useState<GuestMenu | null>(null);
  const [tables, setTables] = useState<GuestTable[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<Lang>("ro");

  useEffect(() => {
    let cancelled = false;
    fetchMenu(tenant.slug)
      .then((m) => {
        if (!cancelled) setMenu(m);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Eroare necunoscută.");
      });
    fetchTables(tenant.slug)
      .then((tt) => {
        if (!cancelled) setTables(tt);
      })
      .catch(() => {
        /* table picker is optional */
      });
    return () => {
      cancelled = true;
    };
  }, [tenant.slug]);

  const t = UI[lang];
  const dishCount = useMemo(
    () => menu?.categories.reduce((n, c) => n + c.dishes.length, 0) ?? 0,
    [menu],
  );

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <Emblem size={26} />
          <span>{BRAND.name}</span>
        </div>
        <div className={styles.langToggle} role="group" aria-label="Limbă / Language">
          {(["ro", "en"] as const).map((l) => (
            <button
              key={l}
              type="button"
              className={lang === l ? styles.langOn : ""}
              aria-pressed={lang === l}
              onClick={() => setLang(l)}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      <section className={styles.hero}>
        <span className="eyebrow eyebrow--ink">{BRAND.tagline}</span>
        <h1>{BRAND.full}</h1>
        <p>{BRAND.promise}</p>
      </section>

      {tables.length > 0 ? (
        <section className={styles.order}>
          <div className={styles.orderCard}>
            <div>
              <span className="eyebrow eyebrow--ink">Comandă de la masă</span>
              <h2>Ești la o masă?</h2>
              <p>
                Scanează codul QR de pe masă — sau alege masa mai jos — ca să comanzi și să chemi
                ospătarul direct din telefon.
              </p>
            </div>
            <div className={styles.tableChips}>
              {tables.map((tb) => (
                <a key={tb.qrSlug} href={`/t/${tb.qrSlug}`} className={styles.tableChip}>
                  {tb.label}
                </a>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {error ? (
        <p className={styles.state} role="alert">
          {error}
        </p>
      ) : !menu ? (
        <p className={styles.state}>{t.loading}</p>
      ) : (
        <>
          <nav className={styles.catNav} aria-label={t.lead}>
            {menu.categories.map((c) => (
              <a key={c.id} href={`#cat-${c.id}`} className={styles.catChip}>
                {c.name[lang] || c.name.ro}
              </a>
            ))}
          </nav>

          <main className={styles.menu}>
            {menu.categories.map((cat) => (
              <section key={cat.id} id={`cat-${cat.id}`} className={styles.category}>
                <h2 className={styles.catTitle}>{cat.name[lang] || cat.name.ro}</h2>
                <ul className={styles.dishes}>
                  {cat.dishes.map((dish) => {
                    const name = dish.name[lang] || dish.name.ro;
                    const desc = dish.description
                      ? dish.description[lang] || dish.description.ro
                      : "";
                    return (
                      <li key={dish.id} className={styles.dish}>
                        {dish.heroPhotoUrl ? (
                          // biome-ignore lint/performance/noImgElement: guest menu uses presigned URLs, not next/image
                          <img
                            className={styles.thumb}
                            src={dish.heroPhotoUrl}
                            alt={name}
                            loading="lazy"
                          />
                        ) : (
                          <div className={`${styles.thumb} ${styles.thumbEmpty}`} aria-hidden />
                        )}
                        <div className={styles.dishBody}>
                          <div className={styles.dishHead}>
                            <h3>{name}</h3>
                            <span className={styles.price}>{formatLei(dish.priceMinor)}</span>
                          </div>
                          {desc ? <p className={styles.desc}>{desc}</p> : null}
                          {dish.allergenCodes.length > 0 ? (
                            <p className={styles.allergens}>
                              <span className={styles.allergensLabel}>{t.allergens}:</span>{" "}
                              {dish.allergenCodes
                                .map((code) => ALLERGEN_RO[code] ?? code)
                                .join(", ")}
                            </p>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </main>

          <footer className={styles.footer}>
            <span>
              {BRAND.full} · {BRAND.locations.join(" · ")}
            </span>
            <span className={styles.footNote}>
              {dishCount} preparate · {BRAND.greeting}
            </span>
          </footer>
        </>
      )}
    </div>
  );
}
