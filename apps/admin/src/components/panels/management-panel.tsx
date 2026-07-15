"use client";

import type { ManagementDishStat, ManagementMetrics, MetricsPeriod } from "@boca/contracts";
import { useCallback, useEffect, useState } from "react";
import { Seal } from "@/design/emblem";
import { getMetrics } from "@/lib/api";
import { formatMedian, type Tone, verdictForMedian } from "@/lib/report";
import styles from "./management-panel.module.css";

const PERIODS: { key: MetricsPeriod; label: string }[] = [
  { key: "day", label: "Zi" },
  { key: "week", label: "Săptămână" },
  { key: "month", label: "Lună" },
  { key: "all", label: "Tot" },
];

const TONE_VAR: Record<Tone, string> = {
  good: "var(--pine)",
  mixed: "var(--ochre)",
  bad: "var(--vin)",
};

const UNDER_THRESHOLD = 4.0;

const AVATAR_TONES = [
  "var(--vin)",
  "var(--pine)",
  "var(--ochre)",
  "var(--indigo)",
  "var(--pine-soft)",
];

/** Hand-built inline sparkline (no chart lib), ported from the demo. */
function Sparkline({
  points,
  tone,
  width = 120,
  height = 32,
}: {
  points: number[];
  tone: string;
  width?: number;
  height?: number;
}) {
  const pad = 4;
  if (points.length < 2) {
    return <span className={styles.sample}>—</span>;
  }
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
  const last = coords[coords.length - 1] ?? [pad, height / 2];
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={styles.spark}
      aria-hidden
    >
      <path
        d={d}
        fill="none"
        stroke={tone}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={last[0]} cy={last[1]} r={2.4} fill={tone} />
    </svg>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + second).toUpperCase() || "•";
}

type Alert = { id: string; kind: string; tone: string; text: string };

/** Alerts are derived from the real aggregates, so the inbox always reflects data. */
function deriveAlerts(m: ManagementMetrics): Alert[] {
  const alerts: Alert[] = [];
  for (const d of m.dishes) {
    if (d.median < UNDER_THRESHOLD) {
      alerts.push({
        id: `under-${d.dishId}`,
        kind: "sub prag",
        tone: "var(--vin)",
        text: `${d.name.ro} — conformitate ${formatMedian(d.median)} sub pragul de 4,0 (${d.sample} farfurii).`,
      });
    }
  }
  if (m.kpis.notScoreable > 0) {
    alerts.push({
      id: "not-scoreable",
      kind: "neevaluabile",
      tone: "var(--ochre)",
      text: `${m.kpis.notScoreable} capturi neevaluabile în interval — verifică referințele și calitatea fotografiilor la pass.`,
    });
  }
  if (alerts.length === 0 && m.kpis.platesEvaluated > 0) {
    alerts.push({
      id: "ok",
      kind: "în regulă",
      tone: "var(--pine)",
      text: "Toate preparatele urmărite sunt peste prag în acest interval. Nimic de semnalat.",
    });
  }
  return alerts;
}

export function ManagementPanel() {
  const [period, setPeriod] = useState<MetricsPeriod>("month");
  const [metrics, setMetrics] = useState<ManagementMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: MetricsPeriod) => {
    setLoading(true);
    try {
      setMetrics(await getMetrics(p));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nu am putut încărca raportul.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(period);
  }, [load, period]);

  const dishes: ManagementDishStat[] = metrics?.dishes ?? [];
  const alerts = metrics ? deriveAlerts(metrics) : [];
  const kpis = metrics?.kpis;

  return (
    <div>
      <div className={styles.head}>
        <span className="eyebrow eyebrow--ink">Rapoarte · date interne</span>
        <h1>Tabloul de management</h1>
        <p className={styles.intro}>
          Consistența montajului preparatelor, din evaluările AI la pass. Preparatul e unitatea
          principală; scorurile mici urcă în capul listei.
        </p>
      </div>

      {/* Period selector */}
      <div className={styles.periods}>
        <div className={styles.periodChips} role="tablist" aria-label="Interval de raportare">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              role="tab"
              aria-selected={period === p.key}
              className={`${styles.periodChip} ${period === p.key ? styles.periodChipOn : ""}`}
              onClick={() => setPeriod(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
        {metrics ? <span className={styles.periodMeta}>{metrics.rangeLabel}</span> : null}
      </div>

      {error ? (
        <p className="form-error" style={{ marginTop: 16 }}>
          {error}
        </p>
      ) : null}

      {loading && !metrics ? (
        <div className={styles.state}>Se încarcă raportul…</div>
      ) : kpis && kpis.platesEvaluated === 0 ? (
        <div className={`card ${styles.state}`}>
          Încă nu există farfurii evaluate în acest interval. Pe măsură ce personalul fotografiază
          montajele la pass, raportul se populează automat. Încearcă intervalul „Tot”.
        </div>
      ) : kpis ? (
        <>
          {/* 1 · KPI ROW */}
          <section className={styles.section} aria-label="Indicatori-cheie">
            <div className={styles.kpiGrid}>
              <div className={`card ${styles.kpi}`}>
                <span className={`eyebrow eyebrow--ink ${styles.kpiLabel}`}>
                  Conformitate medie
                </span>
                <div className={styles.kpiValueRow}>
                  <span className={`${styles.kpiValue} tabular`} style={{ color: "var(--pine)" }}>
                    {kpis.avgConformity !== null ? formatMedian(kpis.avgConformity) : "—"}
                  </span>
                  <span className={styles.kpiUnit}>din 5</span>
                </div>
                <div className={styles.kpiFoot}>
                  <span className={styles.kpiTrend}>medie pe farfuriile evaluate</span>
                </div>
              </div>

              <div className={`card ${styles.kpi}`}>
                <span className={`eyebrow eyebrow--ink ${styles.kpiLabel}`}>Farfurii evaluate</span>
                <div className={styles.kpiValueRow}>
                  <span className={`${styles.kpiValue} tabular`} style={{ color: "var(--ink)" }}>
                    {kpis.platesEvaluated}
                  </span>
                </div>
                <div className={styles.kpiFoot}>
                  <span className={styles.kpiTrend}>montaje fotografiate la pass</span>
                </div>
              </div>

              <div className={`card ${styles.kpi}`}>
                <span className={`eyebrow eyebrow--ink ${styles.kpiLabel}`}>Neevaluabile</span>
                <div className={styles.kpiValueRow}>
                  <span
                    className={`${styles.kpiValue} tabular`}
                    style={{ color: kpis.notScoreable > 0 ? "var(--ochre)" : "var(--ink)" }}
                  >
                    {kpis.notScoreable}
                  </span>
                </div>
                <div className={styles.kpiFoot}>
                  <span className={styles.kpiTrend}>calitate foto / referințe lipsă</span>
                </div>
              </div>

              <div className={`card ${styles.kpi}`}>
                <span className={`eyebrow eyebrow--ink ${styles.kpiLabel}`}>
                  Preparate sub prag
                </span>
                <div className={styles.kpiValueRow}>
                  <span
                    className={`${styles.kpiValue} tabular`}
                    style={{ color: kpis.dishesUnderThreshold > 0 ? "var(--vin)" : "var(--pine)" }}
                  >
                    {kpis.dishesUnderThreshold}
                  </span>
                  <span className={styles.kpiUnit}>din {kpis.dishesTracked} urmărite</span>
                </div>
                <div className={styles.kpiFoot}>
                  <span className={styles.kpiTrend}>mediană sub 4,0</span>
                </div>
              </div>
            </div>
          </section>

          {/* 2 · ALERTS */}
          {alerts.length > 0 ? (
            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <div>
                  <span className="eyebrow eyebrow--ink">Inbox operațional</span>
                  <h2>De urmărit</h2>
                </div>
              </div>
              <div className={`card ${styles.alerts}`}>
                {alerts.map((a) => (
                  <div key={a.id} className={styles.alertRow}>
                    <span
                      className={styles.alertRule}
                      style={{ "--tone": a.tone } as React.CSSProperties}
                    />
                    <span
                      className={`chip ${styles.alertKind}`}
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
                    <span className={styles.alertText}>{a.text}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {/* 3 · DISH CONFORMITY */}
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <div>
                <span className="eyebrow eyebrow--ink">Vedere principală</span>
                <h2>Conformitatea montajului pe preparate</h2>
              </div>
              <p className={styles.sectionNote}>
                Mediana scorurilor AI pe fiecare preparat, cu dispersia și mărimea eșantionului.
              </p>
            </div>
            {dishes.length === 0 ? (
              <div className={`card ${styles.state}`}>
                Niciun preparat cu evaluări finalizate în acest interval.
              </div>
            ) : (
              <div className={`card ${styles.table}`}>
                <div className={styles.tableScroll}>
                  <table className={styles.tableGrid}>
                    <thead>
                      <tr>
                        <th>Preparat</th>
                        <th className={styles.thNum}>Mediană</th>
                        <th className={styles.thNum}>Dispersie</th>
                        <th className={styles.thNum}>Eșantion</th>
                        <th className={styles.thNum}>Tendință</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dishes.map((d) => {
                        const v = verdictForMedian(d.median);
                        const tone = TONE_VAR[v.tone];
                        const under = d.median < UNDER_THRESHOLD;
                        const trendCls =
                          d.trend > 0.05 ? styles.up : d.trend < -0.05 ? styles.down : styles.flat;
                        const trendArrow = d.trend > 0.05 ? "▲" : d.trend < -0.05 ? "▼" : "—";
                        return (
                          <tr key={d.dishId} className={under ? styles.rowFlag : undefined}>
                            <td>
                              <span className={styles.dishName}>{d.name.ro}</span>
                              {under ? (
                                <span className={`chip chip--vin ${styles.dishFlag}`}>
                                  sub prag
                                </span>
                              ) : null}
                            </td>
                            <td className={styles.tdNum}>
                              <span className={styles.medianCell}>
                                <span
                                  className={styles.dot}
                                  style={{ "--tone": tone } as React.CSSProperties}
                                />
                                <span className={`${styles.medianVal} tabular`}>
                                  {formatMedian(d.median)}
                                </span>
                              </span>
                            </td>
                            <td className={`${styles.tdNum} tabular muted`}>
                              ±{formatMedian(d.dispersion)}
                            </td>
                            <td className={styles.tdNum}>
                              <span className={styles.sample}>{d.sample} farfurii</span>
                            </td>
                            <td className={styles.tdNum}>
                              <span className={styles.trendCell}>
                                <span className={`${trendCls} ${styles.trendArrow} tabular`}>
                                  {trendArrow}
                                </span>
                                <Sparkline points={d.spark} tone={tone} width={110} height={30} />
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          {/* 4 · TEAM COACHING */}
          {metrics && metrics.staff.length > 0 ? (
            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <div>
                  <span className="eyebrow eyebrow--ink">Drill-down</span>
                  <h2>Conformitate pe echipă</h2>
                </div>
              </div>
              <div className={styles.chefGrid}>
                {metrics.staff.map((c, i) => {
                  const v = verdictForMedian(c.conformity);
                  const tone = TONE_VAR[v.tone];
                  return (
                    <div key={c.userId ?? `x-${i}`} className={`card ${styles.chefCard}`}>
                      <div className={styles.chefTop}>
                        <span
                          className={styles.avatar}
                          style={{ background: AVATAR_TONES[i % AVATAR_TONES.length] }}
                        >
                          {initials(c.name)}
                        </span>
                        <div>
                          <div className={styles.chefName}>{c.name}</div>
                        </div>
                      </div>
                      <div className={styles.chefSeal}>
                        <Seal size={78} tone={tone} label="Conformitate">
                          <div>
                            <div className={`${styles.sealScore} tabular`} style={{ color: tone }}>
                              {formatMedian(c.conformity)}
                            </div>
                            <div className={styles.sealUnit}>din 5</div>
                          </div>
                        </Seal>
                      </div>
                      <div className={styles.chefStats}>
                        <span className="tabular">{c.plates} farfurii</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className={styles.chefCaption}>
                Grupat după cine a fotografiat montajul la pass. Uz intern de coaching — niciodată
                clasament public.
              </p>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
