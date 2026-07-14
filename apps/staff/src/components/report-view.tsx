import { SCORING_CRITERIA } from "@boca/config";
import type { AiEvaluation, EvaluationReport } from "@boca/contracts";
import {
  DISH_MISMATCH_WARNING,
  EVAL_FAILED_MESSAGE,
  formatConfidence,
  formatMedian,
  LOW_AGREEMENT_BADGE,
  NOT_SCOREABLE_REASON_RO,
  scoreTone,
  verdictForMedian,
} from "@/lib/report";
import styles from "./report-view.module.css";

interface ReportViewProps {
  evaluation: AiEvaluation;
  dishName: string;
  candidateUrl: string | null;
  referenceUrls: string[];
  onRetry: () => void;
  onNewCandidate: () => void;
}

/** The conformity report — the screen the owner judges the product by. */
export function ReportView({
  evaluation,
  dishName,
  candidateUrl,
  referenceUrls,
  onRetry,
  onNewCandidate,
}: ReportViewProps) {
  if (evaluation.status === "eval_failed") {
    return (
      <section className={`card ${styles.statePanel}`}>
        <p className="eyebrow">Evaluare nereușită</p>
        <h2 className={styles.stateTitle}>A intervenit o eroare tehnică</h2>
        <p className={styles.stateBody}>{EVAL_FAILED_MESSAGE}</p>
        <div className={styles.stateActions}>
          <button type="button" className="btn btn-primary" onClick={onRetry}>
            Reia evaluarea
          </button>
          <button type="button" className="btn" onClick={onNewCandidate}>
            Altă fotografie
          </button>
        </div>
      </section>
    );
  }

  if (evaluation.status === "not_scoreable") {
    const reason = evaluation.notScoreableReason
      ? NOT_SCOREABLE_REASON_RO[evaluation.notScoreableReason]
      : NOT_SCOREABLE_REASON_RO.other;
    return (
      <section className={`card ${styles.statePanel}`}>
        <p className="eyebrow">Neevaluabil</p>
        <h2 className={styles.stateTitle}>Fotografia nu a putut fi evaluată</h2>
        <p className={styles.stateBody}>{reason}</p>
        <div className={styles.stateActions}>
          <button type="button" className="btn btn-primary" onClick={onNewCandidate}>
            Încearcă altă fotografie
          </button>
        </div>
      </section>
    );
  }

  if (evaluation.status !== "completed" || !evaluation.report) return null;

  return (
    <CompletedReport
      report={evaluation.report}
      model={evaluation.evalConfig.model}
      ensembleSize={evaluation.evalConfig.ensembleSize}
      dishName={dishName}
      candidateUrl={candidateUrl}
      referenceUrls={referenceUrls}
      onNewCandidate={onNewCandidate}
    />
  );
}

function CompletedReport({
  report,
  model,
  ensembleSize,
  dishName,
  candidateUrl,
  referenceUrls,
  onNewCandidate,
}: {
  report: EvaluationReport;
  model: string;
  ensembleSize: number;
  dishName: string;
  candidateUrl: string | null;
  referenceUrls: string[];
  onNewCandidate: () => void;
}) {
  const verdict = verdictForMedian(report.overall.median);

  return (
    <div className={styles.report}>
      <section className={`card ${styles.verdict}`} data-tone={verdict.tone}>
        <div className={styles.verdictScore}>
          <span className={styles.verdictNumber}>{formatMedian(report.overall.median)}</span>
          <span className={styles.verdictOutOf}>din 5</span>
        </div>
        <div className={styles.verdictBody}>
          <p className="eyebrow">Raport de conformitate — {dishName}</p>
          <h2 className={styles.verdictLabel}>{verdict.label}</h2>
          <div className={styles.badges}>
            {report.overall.lowAgreement ? (
              <span className={`${styles.badge} ${styles.badgeWarn}`}>{LOW_AGREEMENT_BADGE}</span>
            ) : null}
            {report.dishMismatch ? (
              <span className={`${styles.badge} ${styles.badgeAlert}`}>
                {DISH_MISMATCH_WARNING}
              </span>
            ) : null}
          </div>
        </div>
      </section>

      <section className={styles.photos}>
        <figure className={styles.candidateFig}>
          {candidateUrl ? (
            <img className={styles.candidateImg} src={candidateUrl} alt="Farfuria evaluată" />
          ) : (
            <div className={styles.photoMissing}>Fotografia evaluată</div>
          )}
          <figcaption className={styles.figCaption}>Farfuria evaluată</figcaption>
        </figure>
        <figure className={styles.refsFig}>
          <div className={styles.refGrid}>
            {referenceUrls.length > 0
              ? referenceUrls.map((url, i) => (
                  <img key={url} className={styles.refImg} src={url} alt={`Referința ${i + 1}`} />
                ))
              : [0, 1, 2].map((i) => (
                  <div key={i} className={styles.photoMissing}>
                    REF {i + 1}
                  </div>
                ))}
          </div>
          <figcaption className={styles.figCaption}>Setul de referință</figcaption>
        </figure>
      </section>

      <section className={styles.criteria}>
        {SCORING_CRITERIA.map((criterion) => {
          const entry = report.criteria[criterion.key];
          const tone = scoreTone(entry.score);
          return (
            <article key={criterion.key} className={`card ${styles.criterion}`}>
              <header className={styles.criterionHead}>
                <h3 className={styles.criterionLabel}>{criterion.labelRo}</h3>
                <span className={styles.criterionScore} data-tone={tone}>
                  {entry.score}
                </span>
              </header>
              <ScoreScale score={entry.score} tone={tone} />
              <p className={styles.justification}>{entry.justification}</p>
              <footer className={styles.confidence}>
                <span
                  className={styles.confidenceBar}
                  style={{ ["--fill" as string]: `${Math.round(entry.confidence * 100)}%` }}
                  aria-hidden
                />
                <span className={styles.confidenceLabel}>
                  Încredere {formatConfidence(entry.confidence)}
                </span>
              </footer>
            </article>
          );
        })}
      </section>

      <footer className={styles.reportFooter}>
        <p className={styles.provenance}>
          Scor median din {ensembleSize} rulări independente · model {model}
        </p>
        <button type="button" className="btn" onClick={onNewCandidate}>
          Evaluează altă farfurie
        </button>
      </footer>
    </div>
  );
}

function ScoreScale({ score, tone }: { score: number; tone: "good" | "mixed" | "bad" }) {
  return (
    <div className={styles.scale} role="img" aria-label={`Scor ${score} din 5`} data-tone={tone}>
      {[1, 2, 3, 4, 5].map((step) => (
        <span key={step} className={styles.scaleStep} data-filled={step <= score || undefined} />
      ))}
    </div>
  );
}
