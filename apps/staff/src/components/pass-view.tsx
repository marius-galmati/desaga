"use client";

import type { AdminDishListItem, AiEvaluation, PassQueueItem } from "@boca/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
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
import styles from "../app/staff.module.css";

type Phase = "list" | "working" | "report";
type Mode = "queue" | "demo";
type Target = { kind: "queue"; item: PassQueueItem } | { kind: "demo"; dish: AdminDishListItem };

/** Pass plating capture: photograph a served plate -> live AI conformity report. */
export function PassView() {
  const [phase, setPhase] = useState<Phase>("list");
  const [mode, setMode] = useState<Mode>("queue");
  const [queue, setQueue] = useState<PassQueueItem[]>([]);
  const [dishes, setDishes] = useState<AdminDishListItem[]>([]);
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
    let cancelled = false;
    loadData().catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "Nu am putut încărca datele.");
    });
    return () => {
      cancelled = true;
    };
  }, [loadData]);

  const scoreableDishes = dishes.filter(
    (d) => d.referenceSet && d.referenceSet.status === "active",
  );

  const poll = useCallback(
    async (id: string, getter: (id: string) => Promise<AiEvaluation>): Promise<AiEvaluation> => {
      for (let i = 0; i < 40; i++) {
        const ev = await getter(id);
        if (
          ev.status === "completed" ||
          ev.status === "not_scoreable" ||
          ev.status === "eval_failed"
        ) {
          return ev;
        }
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

  const targetName = target?.kind === "queue" ? target.item.name.ro : (target?.dish.name.ro ?? "");

  return (
    <main className={styles.main}>
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

      {error ? (
        <p className={styles.err} role="alert">
          {error}
        </p>
      ) : null}

      {phase === "list" ? (
        <>
          <div className={styles.lead}>
            <span className="eyebrow eyebrow--ink">Pass · control montaj</span>
            <h1>Fotografiază farfuria</h1>
            <p>
              Fotografiază montajul servit și primești pe loc scorul de conformitate față de etalon,
              pe cele 6 criterii.
            </p>
          </div>

          <div className={styles.modeToggle} role="group" aria-label="Sursă">
            <button
              type="button"
              className={mode === "queue" ? styles.modeOn : ""}
              onClick={() => setMode("queue")}
            >
              Comenzi la pass
            </button>
            <button
              type="button"
              className={mode === "demo" ? styles.modeOn : ""}
              onClick={() => setMode("demo")}
            >
              Demo pe preparat
            </button>
          </div>

          {mode === "queue" ? (
            queue.length === 0 ? (
              <p className={styles.state}>
                Nicio farfurie în așteptare. Comenzile trimise de la mese apar aici.
              </p>
            ) : (
              <div className={styles.grid}>
                {queue.map((it) => (
                  <button
                    key={it.orderItemId}
                    type="button"
                    className={styles.dishCard}
                    onClick={() => pick({ kind: "queue", item: it })}
                  >
                    <div className={styles.thumb}>
                      {it.heroPhotoUrl ? (
                        // biome-ignore lint/performance/noImgElement: presigned URL
                        <img src={it.heroPhotoUrl} alt="" />
                      ) : (
                        <span className={styles.thumbEmpty}>Fără foto</span>
                      )}
                    </div>
                    <span className={styles.tableTag}>{it.tableLabel}</span>
                    <span className={styles.dishName}>
                      {it.quantity}× {it.name.ro}
                    </span>
                    <span className={styles.capture}>📷 Fotografiază</span>
                  </button>
                ))}
              </div>
            )
          ) : scoreableDishes.length === 0 ? (
            <p className={styles.state}>
              Niciun preparat cu set de referință activ. Configurează referințele în Administrare.
            </p>
          ) : (
            <div className={styles.grid}>
              {scoreableDishes.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className={styles.dishCard}
                  onClick={() => pick({ kind: "demo", dish: d })}
                >
                  <div className={styles.thumb}>
                    {d.heroPhotoUrl ? (
                      // biome-ignore lint/performance/noImgElement: presigned URL
                      <img src={d.heroPhotoUrl} alt="" />
                    ) : (
                      <span className={styles.thumbEmpty}>Fără foto</span>
                    )}
                  </div>
                  <span className={styles.dishName}>{d.name.ro}</span>
                  <span className={styles.capture}>📷 Fotografiază</span>
                </button>
              ))}
            </div>
          )}
        </>
      ) : null}

      {phase === "working" ? (
        <div className={styles.working}>
          {candidateUrl ? (
            // biome-ignore lint/performance/noImgElement: local object URL preview
            <img className={styles.workingImg} src={candidateUrl} alt="Farfuria evaluată" />
          ) : null}
          <div className={styles.spinner} aria-hidden />
          <p className={styles.state}>{status}</p>
          <p className={styles.workingDish}>{targetName}</p>
        </div>
      ) : null}

      {phase === "report" && evaluation && target ? (
        <ReportView
          evaluation={evaluation}
          dishName={targetName}
          candidateUrl={candidateUrl}
          referenceUrls={[]}
          onRetry={() => pick(target)}
          onNewCandidate={reset}
        />
      ) : null}
    </main>
  );
}
