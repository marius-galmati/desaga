import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { Emblem, Seal, Wordmark } from "@/lib/emblem";
import s from "./page.module.css";

const SURFACES = [
  {
    href: "/oaspete",
    num: "I",
    title: "Experiența oaspetelui",
    desc: "Meniul digital cu poveștile preparatelor, comanda de la masă, nota comună și momentul „compară-ți farfuria”.",
    cta: "Vezi aplicația oaspeților",
  },
  {
    href: "/personal",
    num: "II",
    title: "Aplicațiile de personal",
    desc: "Ospătarul cu secțiunile și comenzile lui; pass-ul din bucătărie cu coada de tichete și captura montajului.",
    cta: "Vezi sala și bucătăria",
  },
  {
    href: "/management",
    num: "III",
    title: "Tabloul de management",
    desc: "Consistența montajului pe preparate, coaching pe bucătari, tendințe și scorurile AI agregate pe interval.",
    cta: "Vezi rapoartele",
  },
  {
    href: "/admin",
    num: "IV",
    title: "Administrare",
    desc: "Meniul cu versionare, biblioteca foto 4K, seturile de referință și toleranțele definite de bucătarul-șef.",
    cta: "Vezi panoul de control",
  },
];

export default function TourPage() {
  return (
    <div className={s.wrap}>
      <header className={s.topbar}>
        <div className={`container ${s.topbarInner}`}>
          <Wordmark />
          <div className={s.topbarMeta}>
            <span className={s.badge}>
              <span className={s.dot} /> Prototip
            </span>
            <span className="faint">{BRAND.locations.join(" · ")}</span>
          </div>
        </div>
      </header>

      <main>
        <section className={s.hero}>
          <div className={`container ${s.heroGrid}`}>
            <div>
              <div className={s.heroKicker}>
                <Emblem size={22} tone="var(--ochre)" />
                <span className="eyebrow">{BRAND.full}</span>
              </div>
              <h1 className={s.heroTitle}>
                Aceeași ospitalitate,
                <br />
                purtată în <em>digital</em>.
              </h1>
              <p className={s.heroLede}>
                O privire asupra întregii experiențe — de la masa oaspetelui până la controlul
                montajului din bucătărie. Așa ar arăta Desaga, cap-coadă.
              </p>
              <div className={s.heroActions}>
                <Link href="/evaluare" className="btn btn--gold">
                  Controlul AI al montajului
                  <span aria-hidden>→</span>
                </Link>
                <Link href="/oaspete" className="btn btn--ghost">
                  Începe turul
                </Link>
              </div>
            </div>

            <div className={s.heroArt}>
              <div className={s.heroArtRing} />
              <div className={s.heroArtRing2} />
              <div className={s.heroSeal}>
                <Seal size={230} tone="var(--ochre)" label="Gust Autentic">
                  <div style={{ display: "grid", gap: 2 }}>
                    <Emblem size={54} tone="var(--vin)" />
                  </div>
                </Seal>
              </div>
            </div>
          </div>
        </section>

        <section className={s.surfaces}>
          <div className="container">
            <div className={s.sectionHead}>
              <div>
                <span className="eyebrow eyebrow--ink">Patru suprafețe, o singură masă</span>
                <h2>Fiecare rol, cu unealta lui</h2>
              </div>
              <div className="rule" style={{ flex: 1, maxWidth: 280 }}>
                <span className="rule__node" />
              </div>
            </div>

            <div className={s.grid}>
              <Link href="/evaluare" className={`${s.tile} ${s.tileFeature}`}>
                <div className={s.tileFeatureBody}>
                  <span className="eyebrow eyebrow--dark">Funcțional · rulează pe Claude</span>
                  <h3>Farfuria, verificată față de standard</h3>
                  <p>
                    Bucătarul fotografiază montajul, iar inteligența artificială îl compară cu
                    farfuria de referință și acordă un scor de conformitate pe șase criterii — cu
                    justificare pentru fiecare. Această parte chiar funcționează, acum.
                  </p>
                  <span className={s.tileFoot} style={{ color: "var(--ochre-soft)" }}>
                    Deschide evaluarea{" "}
                    <span className={s.tileArrow} aria-hidden>
                      →
                    </span>
                  </span>
                </div>
                <div className={s.tileFeatureArt}>
                  <Seal size={168} tone="var(--ochre-soft)" label="Conform">
                    <div style={{ color: "var(--on-dark)" }}>
                      <div
                        style={{
                          fontFamily: "var(--font-display)",
                          fontSize: "2.9rem",
                          lineHeight: 1,
                          fontWeight: 600,
                        }}
                        className="tabular"
                      >
                        4,6
                      </div>
                      <div
                        style={{
                          fontSize: "0.7rem",
                          letterSpacing: "0.14em",
                          color: "var(--on-dark-soft)",
                        }}
                      >
                        DIN 5
                      </div>
                    </div>
                  </Seal>
                </div>
              </Link>

              {SURFACES.map((surf) => (
                <Link key={surf.href} href={surf.href} className={s.tile}>
                  <div>
                    <span className={s.tileNum}>{surf.num}</span>
                    <h3 className={s.tileTitle}>{surf.title}</h3>
                  </div>
                  <p className={s.tileDesc}>{surf.desc}</p>
                  <span className={s.tileFoot}>
                    {surf.cta}{" "}
                    <span className={s.tileArrow} aria-hidden>
                      →
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className={s.foot}>
        <div className={`container ${s.footInner}`}>
          <Wordmark tone="var(--ink-soft)" />
          <span>
            Prototip de prezentare · {BRAND.tagline} · {BRAND.locations.join(" & ")}
          </span>
        </div>
      </footer>
    </div>
  );
}
