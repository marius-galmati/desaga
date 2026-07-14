"use client";

import type { AdminDishListItem, AiEvaluation } from "@boca/contracts";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ReportView } from "@/components/report-view";
import { BRAND } from "@/design/brand";
import { Wordmark } from "@/design/emblem";
import { createEvaluation, getEvaluation, listDishes, uploadPhoto } from "@/lib/api";
import { ensureSession, getCurrentUser, logout } from "@/lib/auth";
import styles from "./staff.module.css";

type Phase = "checking" | "list" | "working" | "report";

export default function StaffPass() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");
  const [dishes, setDishes] = useState<AdminDishListItem[]>([]);
  const [dish, setDish] = useState<AdminDishListItem | null>(null);
  const [evaluation, setEvaluation] = useState<AiEvaluation | null>(null);
  const [candidateUrl, setCandidateUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void ensureSession().then(async (ok) => {
      if (cancelled) return;
      if (!ok) {
        router.replace("/login");
        return;
      }
      try {
        const all = await listDishes();
        if (!cancelled) {
          setDishes(all);
          setPhase("list");
        }
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Nu am putut încărca preparatele.");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  // Only dishes with an active reference set are scoreable.
  const scoreable = dishes.filter((d) => d.referenceSet && d.referenceSet.status === "active");

  const poll = useCallback(async (id: string): Promise<AiEvaluation> => {
    for (let i = 0; i < 40; i++) {
      const ev = await getEvaluation(id);
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
  }, []);

  async function onPhoto(file: File, forDish: AdminDishListItem) {
    setPhase("working");
    setError(null);
    setEvaluation(null);
    setCandidateUrl(URL.createObjectURL(file));
    try {
      setStatus("Se încarcă fotografia…");
      const { photoKey } = await uploadPhoto(file);
      setStatus("Se pornește evaluarea…");
      const { evaluationId } = await createEvaluation({
        dishId: forDish.id,
        candidatePhotoKey: photoKey,
      });
      const ev = await poll(evaluationId);
      setEvaluation(ev);
      setPhase("report");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Evaluarea a eșuat.");
      setPhase("list");
    }
  }

  function pick(d: AdminDishListItem) {
    setDish(d);
    // Defer the file dialog to the next tick so the ref is mounted.
    setTimeout(() => fileInput.current?.click(), 0);
  }

  function reset() {
    setEvaluation(null);
    setCandidateUrl(null);
    setDish(null);
    setPhase("list");
  }

  const user = getCurrentUser();

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <Wordmark />
        <div className={styles.userBox}>
          {user ? <span className={styles.userName}>{user.fullName}</span> : null}
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={async () => {
              await logout();
              router.replace("/login");
            }}
          >
            Ieșire
          </button>
        </div>
      </header>

      {/* hidden camera/file input, triggered per dish */}
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file && dish) void onPhoto(file, dish);
        }}
      />

      <main className={styles.main}>
        {phase === "checking" ? <p className={styles.state}>Se încarcă…</p> : null}

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
                Alege preparatul, fotografiază montajul servit și primești pe loc scorul de
                conformitate față de etalon, pe cele 6 criterii.
              </p>
            </div>
            {scoreable.length === 0 ? (
              <p className={styles.state}>
                Niciun preparat cu set de referință activ. Configurează referințele în Administrare.
              </p>
            ) : (
              <div className={styles.grid}>
                {scoreable.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className={styles.dishCard}
                    onClick={() => pick(d)}
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
            <p className={styles.workingDish}>{dish?.name.ro}</p>
          </div>
        ) : null}

        {phase === "report" && evaluation && dish ? (
          <ReportView
            evaluation={evaluation}
            dishName={dish.name.ro}
            candidateUrl={candidateUrl}
            referenceUrls={[]}
            onRetry={() => pick(dish)}
            onNewCandidate={reset}
          />
        ) : null}
      </main>

      <footer className={styles.foot}>
        {BRAND.full} · {BRAND.locations.join(" · ")}
      </footer>
    </div>
  );
}
