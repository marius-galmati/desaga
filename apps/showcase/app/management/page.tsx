"use client";

import { SCORING_CRITERIA } from "@boca/config";
import { useState } from "react";
import { SurfaceHeader, TourBack } from "@/components/frame";
import { ALERTS, CHEFS, type Chef, DISH_STATS, type DishStat, KPIS } from "@/data/ops";
import { ro1, verdict } from "@/lib/brand";
import { Seal } from "@/lib/emblem";
import s from "./management.module.css";

/* ---- tiny hand-built inline sparkline (no chart lib) ---- */
function Sparkline({
  points,
  tone,
  width = 120,
  height = 32,
  strokeWidth = 1.6,
  dot = true,
}: {
  points: number[];
  tone: string;
  width?: number;
  height?: number;
  strokeWidth?: number;
  dot?: boolean;
}) {
  const pad = 4;
  if (points.length < 2)
    return <svg width={width} height={height} className={s.spark} aria-hidden />;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const stepX = (width - pad * 2) / (points.length - 1);
  const coords = points.map((v, i) => {
    const x = pad + i * stepX;
    const y = pad + (1 - (v - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });
  const d = coords.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const [lastX, lastY] = coords[coords.length - 1] ?? [pad, height / 2];
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={s.spark}
      aria-hidden
    >
      <path
        d={d}
        fill="none"
        stroke={tone}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {dot && <circle cx={lastX} cy={lastY} r={2.4} fill={tone} />}
    </svg>
  );
}

/* ---- 5-segment scorebar (mirrors global .scorebar) ---- */
function ScoreBar({ score, tone }: { score: number; tone: string }) {
  const on = Math.round(score);
  return (
    <div className={`scorebar ${s.critBar}`} role="img" aria-label={`${ro1(score)} din 5`}>
      {[1, 2, 3, 4, 5].map((seg) => (
        <span
          key={seg}
          className={`scorebar__seg ${seg <= on ? "scorebar__seg--on" : ""}`}
          style={seg <= on ? ({ "--tone": tone } as React.CSSProperties) : undefined}
        />
      ))}
    </div>
  );
}

const PERIODS = ["Zi", "Săptămână", "Lună", "Interval"] as const;

/* Decorative KPI trends (period shape, colored by tile tone). */
const KPI_TRENDS: number[][] = [
  [4.0, 4.1, 4.15, 4.2, 4.28, 4.34, 4.4],
  [612, 648, 690, 726, 781, 820, 866],
  [88, 90, 91, 92, 93, 93.4, 94],
  [3, 2, 2, 3, 2, 1, 1],
];

/* WoW cell class + arrow by direction. */
function wowMeta(wow: number) {
  if (wow > 0) return { cls: s.wowUp, arrow: "▲", text: `+${ro1(wow)} pp` };
  if (wow < 0) return { cls: s.wowDown, arrow: "▼", text: `−${ro1(Math.abs(wow))} pp` };
  return { cls: s.wowFlat, arrow: "—", text: "0,0 pp" };
}

/* Chef avatar tone rotation drawn from brand jewels. */
const AVATAR_TONES = [
  "var(--vin)",
  "var(--pine)",
  "var(--ochre)",
  "var(--indigo)",
  "var(--pine-soft)",
];

export default function ManagementPage() {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>("Lună");

  // Dish-first: worst conformity surfaces to the top so it stands out.
  const dishes: DishStat[] = [...DISH_STATS].sort((a, b) => a.median - b.median);

  const reportChef = CHEFS.find((c) => c.name === "Andrei Pop") ??
    CHEFS[0] ?? {
      name: "—",
      conformity: 0,
      initials: "",
      station: "",
      trend: 0,
      plates: 0,
      reviews: 0,
      id: "x",
    };
  const reportV = verdict(reportChef.conformity);
  const critScores = [4.7, 4.4, 4.8];
  const reportCriteria = [0, 1, 3].map((idx, n) => {
    const c = SCORING_CRITERIA[idx];
    return { key: c?.key ?? String(idx), labelRo: c?.labelRo ?? "", score: critScores[n] ?? 0 };
  });

  return (
    <div className={s.page}>
      <TourBack />
      <div className="container">
        <SurfaceHeader eyebrow="Rapoarte · date interne" title="Tabloul de management" />

        {/* Period selector (visual) */}
        <div className={s.periods}>
          <div className={s.periodChips} role="tablist" aria-label="Interval de raportare">
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={period === p}
                className={`${s.periodChip} ${period === p ? s.periodChipOn : ""}`}
                onClick={() => setPeriod(p)}
              >
                {p}
              </button>
            ))}
          </div>
          <span className={s.periodMeta}>Interval curent · 1–30 iunie 2026 · fus Cluj-Napoca</span>
        </div>

        {/* 1 · KPI ROW */}
        <section className={s.section} aria-label="Indicatori-cheie">
          <div className={s.kpiGrid}>
            {KPIS.map((k, i) => (
              <div key={k.label} className={`card ${s.kpi}`}>
                <span className={`eyebrow eyebrow--ink ${s.kpiLabel}`}>{k.label}</span>
                <div className={s.kpiValueRow}>
                  <span className={`${s.kpiValue} tabular`} style={{ color: k.tone }}>
                    {k.value}
                  </span>
                  <span className={s.kpiUnit}>{k.unit}</span>
                </div>
                <div className={s.kpiFoot}>
                  <span className={s.kpiTrend}>{k.trend}</span>
                  <Sparkline
                    points={KPI_TRENDS[i] ?? []}
                    tone={k.tone}
                    width={72}
                    height={26}
                    dot={false}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 2 · ALERTS */}
        <section className={s.section}>
          <div className={s.sectionHead}>
            <div>
              <span className="eyebrow eyebrow--ink">Inbox operațional</span>
              <h2>De urmărit</h2>
            </div>
          </div>
          <div className={`card ${s.alerts}`}>
            {ALERTS.map((a) => (
              <div key={a.id} className={s.alertRow}>
                <span className={s.alertRule} style={{ "--tone": a.tone } as React.CSSProperties} />
                <span
                  className={`chip ${s.alertKind}`}
                  style={
                    {
                      background: `color-mix(in srgb, ${a.tone} 12%, transparent)`,
                      color: a.tone,
                      borderColor: "transparent",
                    } as React.CSSProperties
                  }
                >
                  {a.kind}
                </span>
                <span className={s.alertText}>{a.text}</span>
              </div>
            ))}
          </div>
        </section>

        {/* 3 · DISH CONFORMITY — primary, dish-first view */}
        <section className={s.section}>
          <div className={s.sectionHead}>
            <div>
              <span className="eyebrow eyebrow--ink">Vedere principală</span>
              <h2>Conformitatea montajului pe preparate</h2>
            </div>
            <p className={s.sectionNote}>
              Preparatul e unitatea principală. Bucătarul e detaliu, normalizat.
            </p>
          </div>
          <div className={`card ${s.table}`}>
            <div className={s.tableScroll}>
              <table className={s.tableGrid}>
                <thead>
                  <tr>
                    <th>Preparat</th>
                    <th className={s.thNum}>Mediană</th>
                    <th className={s.thNum}>Varianță</th>
                    <th className={s.thNum}>Eșantion</th>
                    <th className={s.thNum}>Săpt. / săpt.</th>
                    <th className={s.thNum}>Tendință 8 săpt.</th>
                  </tr>
                </thead>
                <tbody>
                  {dishes.map((d) => {
                    const v = verdict(d.median);
                    const under = d.median < 4.0;
                    const w = wowMeta(d.wow);
                    return (
                      <tr key={d.dishId} className={under ? s.rowFlag : undefined}>
                        <td>
                          <span className={s.dishName}>{d.name}</span>
                          {under && (
                            <span className={`chip chip--vin ${s.dishFlag}`}>sub prag</span>
                          )}
                        </td>
                        <td className={s.tdNum}>
                          <span className={s.medianCell}>
                            <span
                              className={s.dot}
                              style={{ "--tone": v.tone } as React.CSSProperties}
                            />
                            <span className={`${s.medianVal} tabular`}>{ro1(d.median)}</span>
                          </span>
                        </td>
                        <td className={`${s.tdNum} tabular muted`}>±{ro1(d.variance)}</td>
                        <td className={s.tdNum}>
                          <span className={s.sample}>{d.sample} farfurii</span>
                        </td>
                        <td className={s.tdNum}>
                          <span className={`${w.cls} tabular`}>
                            {w.arrow} {w.text}
                          </span>
                        </td>
                        <td className={s.tdNum}>
                          <Sparkline points={d.spark} tone={v.tone} width={120} height={32} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* 4 · CHEF COACHING — secondary drill-down */}
        <section className={s.section}>
          <div className={s.sectionHead}>
            <div>
              <span className="eyebrow eyebrow--ink">Drill-down</span>
              <h2>Coaching pe bucătari</h2>
            </div>
          </div>
          <div className={s.chefGrid}>
            {CHEFS.map((c: Chef, i) => {
              const v = verdict(c.conformity);
              const up = c.trend >= 0;
              return (
                <div key={c.id} className={`card ${s.chefCard}`}>
                  <div className={s.chefTop}>
                    <span
                      className={s.avatar}
                      style={{ background: AVATAR_TONES[i % AVATAR_TONES.length] }}
                    >
                      {c.initials}
                    </span>
                    <div>
                      <div className={s.chefName}>{c.name}</div>
                      <span className={`chip ${s.chefStation}`}>{c.station}</span>
                    </div>
                  </div>

                  <div className={s.chefSeal}>
                    <Seal size={78} tone={v.tone} label="Conformitate">
                      <div>
                        <div className={`${s.sealScore} tabular`} style={{ color: v.tone }}>
                          {ro1(c.conformity)}
                        </div>
                        <div className={s.sealUnit} style={{ color: "var(--ink-faint)" }}>
                          din 5
                        </div>
                      </div>
                    </Seal>
                  </div>

                  <div className={s.chefTrend} style={{ color: up ? "var(--pine)" : "var(--vin)" }}>
                    {up ? "▲" : "▼"} {up ? "+" : "−"}
                    {ro1(Math.abs(c.trend))} pp față de intervalul anterior
                  </div>

                  <div className={s.chefStats}>
                    <span className="tabular">{c.plates} farfurii</span>
                    <span className={s.chefStatSep}>·</span>
                    <span className="tabular">{c.reviews} evaluări</span>
                  </div>
                </div>
              );
            })}
          </div>
          <p className={s.chefCaption}>
            Uz intern de coaching · minim 25 de farfurii pe interval · niciodată clasament public.
          </p>
        </section>

        {/* 5 · COACHING REPORT preview */}
        <section className={s.section}>
          <div className={s.sectionHead}>
            <div>
              <span className="eyebrow eyebrow--ink">Previzualizare raport</span>
              <h2>Raport de coaching</h2>
            </div>
          </div>
          <div className={`card ${s.report}`}>
            <div className={s.reportAside}>
              <Seal size={132} tone={reportV.tone} label="Conformitate">
                <div>
                  <div
                    className="tabular"
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: "2.5rem",
                      fontWeight: 500,
                      lineHeight: 1,
                      color: reportV.tone,
                    }}
                  >
                    {ro1(reportChef.conformity)}
                  </div>
                  <div
                    style={{
                      fontSize: "0.62rem",
                      letterSpacing: "0.16em",
                      color: "var(--ink-faint)",
                    }}
                  >
                    DIN 5
                  </div>
                </div>
              </Seal>
              <div>
                <div className={s.reportChef}>{reportChef.name}</div>
                <span
                  className="chip"
                  style={
                    {
                      background: reportV.wash,
                      color: reportV.tone,
                      borderColor: "transparent",
                      marginTop: 8,
                    } as React.CSSProperties
                  }
                >
                  {reportV.label}
                </span>
              </div>
            </div>

            <div className={s.reportBody}>
              <span className="eyebrow eyebrow--ink">Criterii evaluate</span>
              <div className={s.reportCriteria}>
                {reportCriteria.map((cr) => {
                  const cv = verdict(cr.score);
                  return (
                    <div key={cr.key} className={s.crit}>
                      <span className={s.critLabel}>{cr.labelRo}</span>
                      <span className={`${s.critScore} tabular`} style={{ color: cv.tone }}>
                        {ro1(cr.score)}
                      </span>
                      <ScoreBar score={cr.score} tone={cv.tone} />
                    </div>
                  );
                })}
              </div>
              <div className={s.reportFoot}>
                <span className={s.signoff}>Semnat de manager · confirmat de bucătar</span>
                <button type="button" className="btn btn--ghost btn--sm">
                  Descarcă raportul (PDF)
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
