"use client";

import type { AdminDishListItem, AiEvaluation, PassQueueItem } from "@boca/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { Emblem } from "@/design/emblem";
import {
  captureOrderItem,
  createEvaluation,
  getCapture,
  getEvaluation,
  listDishes,
  listPassQueue,
  uploadPhoto,
} from "@/lib/api";
import { ReportView } from "./report-view";
import s from "./floor.module.css";

type Phase = "list" | "working" | "report";
type Target = { kind: "queue"; item: PassQueueItem } | { kind: "demo"; dish: AdminDishListItem };

/** Pass plating capture, in the dark demo design: photograph the next plated
 *  ticket -> live AI conformity report. Falls back to a demo dish when the
 *  queue is empty (no guest orders yet). */
export function PassView() {
  const [phase, setPhase] = useState<Phase>("list");
  const [queue, setQueue] = useState<PassQueueItem[]>([]);
  const [dishes, setDishes] = useState<AdminDishListItem[]>([]);
  const [nextIndex, setNextIndex] = useState(0);
  const [demo, setDemo] = useState(false);
  const [target, setTarget] = useState<Target | null>(null);
  const [evaluation, setEvaluation] = useState<AiEvaluation | null>(null);
  const [candidateUrl, setCandidateUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadData = useCallback(async () => {
    const [q, d] = await Promise.all([listPassQueue(), listDishes()]);
    setQueue(q);
    setDishes(d);
  }, []);

  useEffect(() => {
    loadData().catch((err) =>
      setError(err instanceof Error ? err.message : "Nu am putut încărca coada."),
    );
  }, [loadData]);

  const poll = useCallback(
    async (id: string, getter: (id: string) => Promise<AiEvaluation>): Promise<AiEvaluation> => {
      for (let i = 0; i < 40; i++) {
        const ev = await getter(id);
        if (["completed", "not_scoreable", "eval_failed"].includes(ev.status)) return ev;
        setStatus(ev.status === "queued" ? "În coadă…" : "Se analizează montajul…");
        await new Promise((r) => setTimeout(r, 1500));
      }
      throw new Error("Evaluarea durează neobișnuit de mult. Reîncearcă.");
    },
    [],
  );

  async function onPhoto(file: File, t: Target) {
    setPhase("working");
    setError(null);
    setEvaluation(null);
    setCandidateUrl(URL.createObjectURL(file));
    try {
      setStatus("Se încarcă fotografia…");
      const { photoKey } = await uploadPhoto(file);
      setStatus("Se pornește evaluarea…");
      let ev: AiEvaluation;
      if (t.kind === "queue") {
        const { evaluationId } = await captureOrderItem({
          orderItemId: t.item.orderItemId,
          candidatePhotoKey: photoKey,
        });
        ev = await poll(evaluationId, getCapture);
      } else {
        const { evaluationId } = await createEvaluation({
          dishId: t.dish.id,
          candidatePhotoKey: photoKey,
        });
        ev = await poll(evaluationId, getEvaluation);
      }
      setEvaluation(ev);
      setPhase("report");
      void loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Evaluarea a eșuat.");
      setPhase("list");
    }
  }

  function pick(t: Target) {
    setTarget(t);
    setTimeout(() => fileInput.current?.click(), 0);
  }

  function reset() {
    setEvaluation(null);
    setCandidateUrl(null);
    setTarget(null);
    setPhase("list");
  }

  const scoreableDishes = dishes.filter(
    (d) => d.referenceSet && d.referenceSet.status === "active",
  );
  const next = queue[nextIndex];
  const rest = queue.filter((_, i) => i !== nextIndex);
  const targetName = target?.kind === "queue" ? target.item.name.ro : (target?.dish.name.ro ?? "");

  // Report is self-contained (light card) — show it full-width outside the dark panel.
  if (phase === "report" && evaluation && target) {
    return (
      <div className={s.salaWrap} style={{ padding: "0 12px" }}>
        <ReportView
          evaluation={evaluation}
          dishName={targetName}
          candidateUrl={candidateUrl}
          referenceUrls={[]}
          onRetry={() => (target ? pick(target) : reset())}
          onNewCandidate={reset}
        />
      </div>
    );
  }

  return (
    <div className={s.passWrap}>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file && target) void onPhoto(file, target);
        }}
      />

      <div className={s.pass}>
        <header className={s.pHead}>
          <div>
            <span className="eyebrow eyebrow--dark">Pass · montaj</span>
            <h1 className={s.pTitle}>Coada de montaj</h1>
          </div>
          <span className={s.pCount}>
            <span className={s.pCountDot} aria-hidden />
            <span className="tabular">{queue.length}</span> la rând
          </span>
        </header>

        {error ? (
          <p className={s.hint} style={{ color: "var(--vin-soft, #d98)" }}>
            {error}
          </p>
        ) : null}

        {phase === "working" ? (
          <section className={s.capture}>
            <div className={s.vf}>
              {candidateUrl ? (
                // biome-ignore lint/performance/noImgElement: local object URL preview
                <img className={s.vfGhost} src={candidateUrl} alt="" style={{ opacity: 0.5 }} />
              ) : null}
              <div className={s.vfGuide} aria-hidden>
                <Emblem size={46} tone="var(--ochre-soft)" />
              </div>
              <span className={s.vfCap}>{status}</span>
            </div>
            <p className={s.hint}>{targetName} · se evaluează…</p>
          </section>
        ) : demo ? (
          <section className={s.capture}>
            <span className="eyebrow eyebrow--dark">Demo pe preparat</span>
            {scoreableDishes.length === 0 ? (
              <p className={s.hint}>
                Niciun preparat cu set de referință activ (vezi Administrare).
              </p>
            ) : (
              <div className={s.queue}>
                {scoreableDishes.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className={s.qrow}
                    onClick={() => pick({ kind: "demo", dish: d })}
                  >
                    <span className={s.qnum}>📷</span>
                    <span className={s.qbody}>
                      <span className={s.qdish}>{d.name.ro}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div className={s.ghosts}>
              <button type="button" className={s.ghostBtn} onClick={() => setDemo(false)}>
                ← Înapoi la coadă
              </button>
            </div>
          </section>
        ) : next ? (
          <section className={s.capture}>
            <div className={s.capMeta}>
              <span className={s.capTable}>{next.tableLabel}</span>
              <span className={s.capCourse}>×{next.quantity}</span>
            </div>
            <h2 className={s.capDish}>{next.name.ro}</h2>

            <div className={s.vf}>
              {next.heroPhotoUrl ? (
                // biome-ignore lint/performance/noImgElement: presigned URL, ghost reference
                <img className={s.vfGhost} src={next.heroPhotoUrl} alt="" />
              ) : null}
              <span className={`${s.br} ${s.brTL}`} aria-hidden />
              <span className={`${s.br} ${s.brTR}`} aria-hidden />
              <span className={`${s.br} ${s.brBL}`} aria-hidden />
              <span className={`${s.br} ${s.brBR}`} aria-hidden />
              <div className={s.vfGuide} aria-hidden>
                <Emblem size={46} tone="var(--ochre-soft)" />
              </div>
              <span className={s.vfCap}>Așază farfuria în cadru</span>
            </div>

            <button
              type="button"
              className="btn btn--gold btn--block"
              onClick={() => pick({ kind: "queue", item: next })}
            >
              Fotografiază montajul
            </button>
            <p className={s.hint}>Montajul e comparat automat cu standardul preparatului.</p>

            <div className={s.ghosts}>
              {rest.length > 0 ? (
                <button
                  type="button"
                  className={s.ghostBtn}
                  onClick={() => setNextIndex((i) => (i + 1) % queue.length)}
                >
                  Sari peste
                </button>
              ) : null}
              <span className={s.ghostSep} aria-hidden>
                ·
              </span>
              <button type="button" className={s.ghostBtn} onClick={() => setDemo(true)}>
                Demo pe preparat
              </button>
            </div>
          </section>
        ) : (
          <section className={s.capture}>
            <p className={s.hint}>
              Coada e goală — farfuriile comandate de la mese apar aici pe măsură ce sunt trimise.
            </p>
            <div className={s.ghosts}>
              <button type="button" className={s.ghostBtn} onClick={() => setDemo(true)}>
                Demo pe preparat
              </button>
            </div>
          </section>
        )}

        {rest.length > 0 && !demo && phase === "list" ? (
          <>
            <div className={s.queueHead}>
              <span className="eyebrow eyebrow--dark">Următoarele la rând</span>
              <span className={s.rule} aria-hidden />
            </div>
            <div className={s.queue}>
              {rest.map((t) => (
                <button
                  key={t.orderItemId}
                  type="button"
                  className={s.qrow}
                  onClick={() => pick({ kind: "queue", item: t })}
                >
                  <span className={s.qnum}>{t.tableLabel.replace(/[^0-9]/g, "") || "•"}</span>
                  <span className={s.qbody}>
                    <span className={s.qdish}>{t.name.ro}</span>
                    <span className={s.qmeta}>
                      {t.tableLabel} · ×{t.quantity}
                    </span>
                  </span>
                  <span className={s.qside}>
                    <span className={s.qchip}>📷</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
