"use client";

import { SCORING_CRITERIA } from "@boca/config";
import { useEffect, useRef, useState } from "react";
import { TourBack } from "@/components/frame";
import { PlateThumb } from "@/components/photo";
import { BRAND, ro1, verdict } from "@/lib/brand";
import { Emblem, Seal } from "@/lib/emblem";
import {
  type AiEvaluation,
  type CriterionKey,
  type DemoDish,
  ensureDemoSession,
  getEvaluation,
  listDishes,
  notScoreableCopy,
  startEvaluation,
  uploadPhoto,
} from "./eval-client";
import s from "./evaluare.module.css";

type Phase = "connecting" | "setup" | "evaluating" | "result" | "error";

function toneForScore(score: number): string {
  if (score >= 4) return "var(--pine)";
  if (score >= 3) return "var(--ochre)";
  return "var(--vin)";
}

export default function EvaluarePage() {
  const [phase, setPhase] = useState<Phase>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [dishes, setDishes] = useState<DemoDish[]>([]);
  const [dishId, setDishId] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<{ file: File; url: string } | null>(null);
  const [evaluation, setEvaluation] = useState<AiEvaluation | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await ensureDemoSession();
        // Deep-link to a past evaluation (?ev=<id>): reopen its report directly.
        const evParam = new URLSearchParams(window.location.search).get("ev");
        if (evParam) {
          const past = await getEvaluation(evParam);
          if (!alive) return;
          setEvaluation(past);
          setPhase("result");
          return;
        }
        const all = await listDishes();
        if (!alive) return;
        const withRefs = all.filter((d) => d.referenceSet?.status === "active");
        setDishes(withRefs);
        setDishId(withRefs[0]?.id ?? null);
        setPhase("setup");
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Eroare necunoscută.");
        setPhase("error");
      }
    })();
    return () => {
      alive = false;
      if (pollRef.current) window.clearTimeout(pollRef.current);
    };
  }, []);

  function pickCandidate(file: File | undefined) {
    if (!file) return;
    if (candidate) URL.revokeObjectURL(candidate.url);
    setCandidate({ file, url: URL.createObjectURL(file) });
  }

  async function run() {
    if (!dishId || !candidate) return;
    setError(null);
    setPhase("evaluating");
    try {
      const key = await uploadPhoto(candidate.file);
      const id = await startEvaluation(dishId, key);
      const poll = async () => {
        const ev = await getEvaluation(id);
        if (["completed", "not_scoreable", "eval_failed"].includes(ev.status)) {
          setEvaluation(ev);
          setPhase("result");
          return;
        }
        pollRef.current = window.setTimeout(poll, 2000);
      };
      await poll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Evaluarea a eșuat.");
      setPhase("setup");
    }
  }

  function reset() {
    setEvaluation(null);
    setPhase("setup");
  }

  const selectedDish = dishes.find((d) => d.id === dishId) ?? null;

  return (
    <div className={s.page}>
      <TourBack />
      <div className={s.inner}>
        <div className={s.head}>
          <span className={`${s.kicker} eyebrow`}>
            <span className={s.live} /> Funcțional · rulează pe Claude
          </span>
          <h1 className={s.title}>Controlul montajului</h1>
          <p className={s.lede}>
            Bucătarul fotografiază farfuria, iar inteligența artificială o compară cu standardul
            casei și acordă un scor de conformitate pe șase criterii — cu justificare pentru
            fiecare.
          </p>
        </div>

        {phase === "connecting" && (
          <div className={`card ${s.state}`}>
            <Emblem size={40} tone="var(--ochre)" />
            <div className={s.stateBig}>Mă conectez la bucătărie…</div>
            <p className="muted">Pregătesc standardele preparatelor.</p>
          </div>
        )}

        {phase === "error" && (
          <div className={`card ${s.state}`}>
            <div className={s.stateBig}>Nu ajung la server</div>
            <p className="muted">{error}</p>
          </div>
        )}

        {(phase === "setup" || phase === "evaluating") && (
          <>
            {phase === "setup" ? (
              <div className={s.bench}>
                <div className={`card ${s.panel}`}>
                  <div className={s.panelHead}>
                    <span className={s.panelStep}>I</span>
                    <span className={s.panelTitle}>Alege preparatul</span>
                  </div>
                  {dishes.length === 0 ? (
                    <p className="muted">
                      Niciun preparat cu set de referință activ. Creează-l în Administrare.
                    </p>
                  ) : (
                    <div className={s.dishList}>
                      {dishes.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          className={`${s.dishBtn} ${d.id === dishId ? s.dishBtnOn : ""}`}
                          onClick={() => setDishId(d.id)}
                        >
                          <PlateThumb tone="#8a6a3a" size={44} />
                          <span>
                            <span className={s.dishName}>{d.name.ro}</span>
                            <br />
                            <span className={s.dishMeta}>
                              {d.referenceSet?.photoCount} referințe · set v
                              {d.referenceSet?.versionNo}
                            </span>
                          </span>
                          {d.id === dishId ? <span className={s.check}>✓</span> : null}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className={`card ${s.panel}`}>
                  <div className={s.panelHead}>
                    <span className={s.panelStep}>II</span>
                    <span className={s.panelTitle}>Fotografia farfuriei</span>
                  </div>
                  <label className={s.drop}>
                    <input
                      className={s.dropInput}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(e) => pickCandidate(e.target.files?.[0])}
                    />
                    {candidate ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className={s.dropImg} src={candidate.url} alt="Farfuria candidat" />
                    ) : (
                      <span className={s.dropHint}>
                        <Emblem size={34} tone="var(--ochre)" />
                        <br />
                        Trage o poză aici sau apasă pentru a alege
                        <br />
                        <span className="faint" style={{ fontSize: "0.8rem" }}>
                          JPG sau PNG
                        </span>
                      </span>
                    )}
                  </label>
                  <button
                    type="button"
                    className={`btn btn--gold btn--block ${s.go}`}
                    disabled={!dishId || !candidate}
                    style={
                      !dishId || !candidate ? { opacity: 0.5, cursor: "not-allowed" } : undefined
                    }
                    onClick={run}
                  >
                    Evaluează montajul
                  </button>
                  {error ? <div className={s.err}>{error}</div> : null}
                </div>
              </div>
            ) : (
              <div className={`card ${s.evaluating}`}>
                <div className={s.spinner}>
                  <Emblem size={52} tone="var(--ochre)" />
                </div>
                <div className={s.stateBig}>Analiza rulează…</div>
                <p className="muted">
                  Trei evaluări independente, comparate cu standardul casei. Durează în jur de o
                  jumătate de minut.
                </p>
              </div>
            )}
          </>
        )}

        {phase === "result" && evaluation && (
          <ResultView
            ev={evaluation}
            dishName={selectedDish?.name.ro ?? ""}
            candidateUrl={candidate?.url ?? null}
            onReset={reset}
          />
        )}
      </div>
    </div>
  );
}

function ResultView({
  ev,
  dishName,
  candidateUrl,
  onReset,
}: {
  ev: AiEvaluation;
  dishName: string;
  candidateUrl: string | null;
  onReset: () => void;
}) {
  if (ev.status === "not_scoreable") {
    return (
      <div className={`card ${s.state}`}>
        <Emblem size={40} tone="var(--ochre)" />
        <div className={s.stateBig}>Nu am putut evalua montajul</div>
        <p className="muted" style={{ maxWidth: "46ch", margin: "0 auto" }}>
          {notScoreableCopy(ev.notScoreableReason)}
        </p>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          style={{ marginTop: 20 }}
          onClick={onReset}
        >
          Încearcă altă fotografie
        </button>
      </div>
    );
  }
  if (ev.status === "eval_failed" || !ev.report) {
    return (
      <div className={`card ${s.state}`}>
        <div className={s.stateBig}>Evaluarea nu s-a finalizat</div>
        <p className="muted">A apărut o eroare la analiză. Reia evaluarea.</p>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          style={{ marginTop: 20 }}
          onClick={onReset}
        >
          Reia evaluarea
        </button>
      </div>
    );
  }

  const report = ev.report;
  const v = verdict(report.overall.median);

  return (
    <div className={s.result}>
      <div className={`card ${s.verdict}`}>
        <div className={s.verdictSeal}>
          <Seal
            size={148}
            tone={v.tone}
            label={v.key === "conform" || v.key === "minor" ? "Gust Autentic" : "De revizuit"}
          >
            <div>
              <div className={s.scoreNum} style={{ color: v.tone }}>
                {ro1(report.overall.median)}
              </div>
              <div className={s.scoreDin}>DIN 5</div>
            </div>
          </Seal>
        </div>
        <div className={s.verdictBody}>
          <span className="eyebrow eyebrow--ink">Verdict</span>
          <div className={s.verdictLabel} style={{ color: v.tone }}>
            {v.label}
          </div>
          <div className={s.badges}>
            {report.overall.lowAgreement ? (
              <span className="chip chip--gold">Scor incert — dezacord între rulări</span>
            ) : null}
            {report.dishMismatch ? (
              <span className="chip chip--vin">Farfuria pare alt preparat</span>
            ) : null}
            {!report.overall.lowAgreement && !report.dishMismatch ? (
              <span className="chip chip--pine">Rulări concordante</span>
            ) : null}
          </div>
        </div>
      </div>

      <div className={s.compare}>
        <div className={s.compareCol}>
          <h4>Farfuria servită</h4>
          {candidateUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className={s.candidate} src={candidateUrl} alt="Farfuria candidat" />
          ) : (
            <div className={`card ${s.state}`} style={{ padding: 24 }}>
              <p className="faint" style={{ fontSize: "0.85rem" }}>
                Fotografia nu e păstrată pentru o evaluare redeschisă.
              </p>
            </div>
          )}
        </div>
        <div className={s.compareCol}>
          <h4>Standardul casei{dishName ? ` · ${dishName}` : ""}</h4>
          <div className={s.refRow}>
            {[0, 1, 2].map((i) => (
              <PlateThumb key={i} tone="#8a6a3a" size={72} />
            ))}
          </div>
        </div>
      </div>

      <div className={s.criteria}>
        {SCORING_CRITERIA.map((crit) => {
          const c = report.criteria[crit.key as CriterionKey];
          const tone = toneForScore(c.score);
          return (
            <div key={crit.key} className={`card ${s.critCard}`}>
              <div className={s.critTop}>
                <span className={s.critName}>{crit.labelRo}</span>
                <span className={s.critScore} style={{ color: tone }}>
                  {c.score}/5
                </span>
              </div>
              <div className="scorebar">
                {[1, 2, 3, 4, 5].map((n) => (
                  <span
                    key={n}
                    className={`scorebar__seg ${n <= c.score ? "scorebar__seg--on" : ""}`}
                    style={{ ["--tone" as string]: tone }}
                  />
                ))}
              </div>
              <p className={s.critJust}>{c.justification}</p>
              <div className={s.conf}>
                <span>Încredere</span>
                <span className={s.confTrack}>
                  <span
                    className={s.confFill}
                    style={{ width: `${Math.round(c.confidence * 100)}%` }}
                  />
                </span>
                <span className="tabular">{Math.round(c.confidence * 100)}%</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className={s.provenance}>
        <span>Scor median din {ev.evalConfig.ensembleSize} rulări independente</span>
        <span className={s.provDot} />
        <span>model {ev.evalConfig.model}</span>
        <span className={s.provDot} />
        <span>prompt {ev.evalConfig.promptVersion}</span>
        <span className={s.provDot} />
        <span>set de referință v{ev.evalConfig.referenceSetVersion}</span>
      </div>

      <div style={{ textAlign: "center", marginTop: 8 }}>
        <button type="button" className="btn btn--ghost" onClick={onReset}>
          Evaluează altă farfurie
        </button>
      </div>

      <p
        className="faint center"
        style={{ fontSize: "0.78rem", maxWidth: "60ch", margin: "0 auto" }}
      >
        {BRAND.tagline} · Scorurile sunt folosite intern, pentru coaching — niciodată afișate
        oaspeților sau ca bază unică de sancțiune.
      </p>
    </div>
  );
}
