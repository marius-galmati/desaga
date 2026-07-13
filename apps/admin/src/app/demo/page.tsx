"use client";

import type { AiEvaluation, DemoDish, ReferenceSetSummary } from "@boca/contracts";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { PhotoDrop } from "@/components/photo-drop";
import { ReportView } from "@/components/report-view";
import { Stepper } from "@/components/stepper";
import {
  attachReferences,
  createDemoDish,
  createEvaluation,
  getEvaluation,
  listDemoDishes,
  UnauthorizedError,
  uploadPhoto,
} from "@/lib/api";
import { ensureSession, getCurrentUser, logout } from "@/lib/auth";
import { isTerminalStatus, PENDING_STATUS_RO } from "@/lib/report";
import { REFERENCE_MAX, REFERENCE_MIN, validateUploadFile } from "@/lib/upload";
import styles from "./demo.module.css";

interface LocalPhoto {
  file: File;
  url: string;
}

const POLL_INTERVAL_MS = 1500;

export default function DemoPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  // step 1 — dish
  const [dishes, setDishes] = useState<DemoDish[]>([]);
  const [dish, setDish] = useState<DemoDish | null>(null);
  const [dishName, setDishName] = useState("");

  // step 2 — references
  const [refSet, setRefSet] = useState<ReferenceSetSummary | null>(null);
  const [refPhotos, setRefPhotos] = useState<LocalPhoto[]>([]);
  const [refUrls, setRefUrls] = useState<string[]>([]); // kept after attach, for the report

  // step 3 — candidate + evaluation
  const [candidate, setCandidate] = useState<LocalPhoto | null>(null);
  const [candidateKey, setCandidateKey] = useState<string | null>(null);
  const [evaluationId, setEvaluationId] = useState<string | null>(null);
  const [evaluation, setEvaluation] = useState<AiEvaluation | null>(null);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Every object URL ever minted, revoked on unmount.
  const urlsRef = useRef<Set<string>>(new Set());
  const makeUrl = useCallback((file: File): string => {
    const url = URL.createObjectURL(file);
    urlsRef.current.add(url);
    return url;
  }, []);
  useEffect(() => {
    const urls = urlsRef.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, []);

  const toLogin = useCallback(() => router.replace("/login"), [router]);

  const fail = useCallback(
    (err: unknown) => {
      if (err instanceof UnauthorizedError) {
        toLogin();
        return;
      }
      setError(err instanceof Error ? err.message : "A intervenit o eroare neașteptată.");
    },
    [toLogin],
  );

  // --- session guard + initial dish list -----------------------------------
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ok = await ensureSession();
      if (cancelled) return;
      if (!ok) {
        toLogin();
        return;
      }
      setReady(true);
      try {
        const list = await listDemoDishes();
        if (!cancelled) setDishes(list);
      } catch (err) {
        if (!cancelled) fail(err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [toLogin, fail]);

  // --- evaluation polling (every 1.5s until a terminal status) --------------
  useEffect(() => {
    if (!evaluationId) return;
    let stopped = false;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const ev = await getEvaluation(evaluationId);
        if (stopped) return;
        setEvaluation(ev);
        if (!isTerminalStatus(ev.status)) {
          timer = window.setTimeout(tick, POLL_INTERVAL_MS);
        }
      } catch (err) {
        if (stopped) return;
        if (err instanceof UnauthorizedError) {
          toLogin();
          return;
        }
        // Transient poll failure — keep trying, the evaluation is async anyway.
        timer = window.setTimeout(tick, POLL_INTERVAL_MS);
      }
    };
    void tick();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [evaluationId, toLogin]);

  const hasActiveRefs = refSet !== null && refSet.photoCount >= REFERENCE_MIN;
  const step: 0 | 1 | 2 = dish === null ? 0 : hasActiveRefs ? 2 : 1;

  // --- actions ---------------------------------------------------------------

  async function onCreateDish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = dishName.trim();
    if (!name) return;
    setError(null);
    setBusy(true);
    try {
      // Demo dishes get the RO name mirrored into EN (bilingual JSONB is NOT NULL).
      const created = await createDemoDish({ name: { ro: name, en: name } });
      setDish({
        id: created.dishId,
        dishVersionId: created.dishVersionId,
        name: { ro: name, en: name },
        referenceSet: null,
        createdAt: new Date().toISOString(),
      });
      setRefSet(null);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  function onSelectDish(selected: DemoDish) {
    setError(null);
    setDish(selected);
    setRefSet(selected.referenceSet);
    // References were uploaded in another session — thumbnails unavailable.
    setRefUrls([]);
  }

  function onAddRefFiles(files: File[]) {
    setError(null);
    setRefPhotos((prev) => {
      const next = [...prev];
      for (const file of files) {
        if (next.length >= REFERENCE_MAX) {
          setError(`Poți folosi cel mult ${REFERENCE_MAX} fotografii de referință.`);
          break;
        }
        const problem = validateUploadFile(file);
        if (problem) {
          setError(problem);
          continue;
        }
        next.push({ file, url: makeUrl(file) });
      }
      return next;
    });
  }

  function onRemoveRef(index: number) {
    setRefPhotos((prev) => prev.filter((_, i) => i !== index));
  }

  async function onSubmitReferences() {
    if (!dish || refPhotos.length < REFERENCE_MIN) return;
    setError(null);
    setBusy(true);
    try {
      const imageKeys: string[] = [];
      for (const [i, photo] of refPhotos.entries()) {
        setProgress(`Se încarcă fotografia ${i + 1} din ${refPhotos.length}…`);
        const { photoKey } = await uploadPhoto(photo.file);
        imageKeys.push(photoKey);
      }
      setProgress("Se activează setul de referință…");
      const summary = await attachReferences(dish.id, { imageKeys });
      setRefSet(summary);
      setRefUrls(refPhotos.map((p) => p.url));
      setRefPhotos([]);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  function onAddCandidate(files: File[]) {
    setError(null);
    const file = files[0];
    if (!file) return;
    const problem = validateUploadFile(file);
    if (problem) {
      setError(problem);
      return;
    }
    setCandidate({ file, url: makeUrl(file) });
  }

  async function onSubmitCandidate() {
    if (!dish || !candidate) return;
    setError(null);
    setBusy(true);
    try {
      setProgress("Se încarcă fotografia…");
      const { photoKey } = await uploadPhoto(candidate.file);
      setCandidateKey(photoKey);
      setProgress("Se pornește evaluarea…");
      const res = await createEvaluation({ dishId: dish.id, candidatePhotoKey: photoKey });
      setEvaluation(null);
      setEvaluationId(res.evaluationId);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  /** Re-enqueue with the SAME uploaded candidate photo (after eval_failed). */
  async function onRetryEvaluation() {
    if (!dish || !candidateKey) return;
    setError(null);
    setBusy(true);
    try {
      const res = await createEvaluation({ dishId: dish.id, candidatePhotoKey: candidateKey });
      setEvaluation(null);
      setEvaluationId(res.evaluationId);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  function onNewCandidate() {
    setError(null);
    setCandidate(null);
    setCandidateKey(null);
    setEvaluationId(null);
    setEvaluation(null);
  }

  function onChangeDish() {
    onNewCandidate();
    setDish(null);
    setRefSet(null);
    setRefPhotos([]);
    setRefUrls([]);
    setDishName("");
    // refresh the list so the dish just used shows its reference set
    void listDemoDishes()
      .then(setDishes)
      .catch(() => undefined);
  }

  async function onLogout() {
    await logout();
    toLogin();
  }

  if (!ready) {
    return <p className="eyebrow">Se verifică sesiunea…</p>;
  }

  const pending =
    evaluationId !== null && (evaluation === null || !isTerminalStatus(evaluation.status));
  const showReport = evaluation !== null && isTerminalStatus(evaluation.status);

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div>
          <p className="eyebrow">Demonstrație evaluare AI</p>
          <h1 className={styles.pageTitle}>
            {dish ? dish.name.ro : "Conformitatea montajului pe farfurie"}
          </h1>
        </div>
        <div className={styles.toolbarActions}>
          {dish ? (
            <button type="button" className="btn btn-ghost" onClick={onChangeDish} disabled={busy}>
              Schimbă preparatul
            </button>
          ) : null}
          <button type="button" className="btn btn-ghost" onClick={onLogout}>
            Deconectare {getCurrentUser()?.email ?? ""}
          </button>
        </div>
      </div>

      <Stepper current={step} />

      {error ? <p className="form-error">{error}</p> : null}

      {/* ---- step 1: create or pick a dish -------------------------------- */}
      {step === 0 ? (
        <section className={`card ${styles.panel}`}>
          <h2 className={styles.panelTitle}>Alege preparatul</h2>
          <p className={styles.panelLede}>
            Creează un preparat de probă sau continuă cu unul existent.
          </p>

          <form className={styles.dishForm} onSubmit={onCreateDish}>
            <div className={`field ${styles.dishField}`}>
              <label className="field-label" htmlFor="dish-name">
                Numele preparatului
              </label>
              <input
                id="dish-name"
                className="input"
                value={dishName}
                onChange={(e) => setDishName(e.target.value)}
                placeholder="ex. Biban de mare, piure de țelină"
                disabled={busy}
                required
              />
            </div>
            <button className="btn btn-primary" type="submit" disabled={busy}>
              Creează preparatul
            </button>
          </form>

          {dishes.length > 0 ? (
            <div className={styles.dishList}>
              <p className="eyebrow">Sau alege un preparat existent</p>
              <ul className={styles.dishItems}>
                {dishes.map((d) => (
                  <li key={d.id} className={styles.dishItem}>
                    <div>
                      <span className={styles.dishItemName}>{d.name.ro}</span>
                      <span className={styles.dishItemMeta}>
                        {d.referenceSet
                          ? `${d.referenceSet.photoCount} referințe · set v${d.referenceSet.versionNo}`
                          : "fără referințe"}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => onSelectDish(d)}
                      disabled={busy}
                    >
                      Alege
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* ---- step 2: reference photos -------------------------------------- */}
      {step === 1 ? (
        <section className={`card ${styles.panel}`}>
          <h2 className={styles.panelTitle}>Setul de referință</h2>
          <p className={styles.panelLede}>
            Încarcă {REFERENCE_MIN}–{REFERENCE_MAX} fotografii cu montajul corect al preparatului —
            ele devin standardul față de care se evaluează fiecare farfurie.
          </p>

          <PhotoDrop
            prompt="Trage fotografiile aici sau apasă pentru a alege"
            hint="JPEG, PNG sau WebP · maximum 15 MB per fotografie"
            multiple
            disabled={busy}
            previews={refPhotos.map((p) => ({ url: p.url, name: p.file.name }))}
            onAdd={onAddRefFiles}
            onRemove={onRemoveRef}
          />

          <div className={styles.panelActions}>
            <span className={styles.counter}>
              {refPhotos.length}/{REFERENCE_MAX} fotografii
            </span>
            <button
              type="button"
              className="btn btn-primary"
              onClick={onSubmitReferences}
              disabled={busy || refPhotos.length < REFERENCE_MIN}
            >
              {busy ? (progress ?? "Se încarcă…") : "Activează setul de referință"}
            </button>
          </div>
        </section>
      ) : null}

      {/* ---- step 3: candidate + evaluation --------------------------------- */}
      {step === 2 && !pending && !showReport ? (
        <section className={`card ${styles.panel}`}>
          <h2 className={styles.panelTitle}>Evaluează o farfurie</h2>
          <p className={styles.panelLede}>
            Setul de referință v{refSet?.versionNo} este activ ({refSet?.photoCount} fotografii).
            Încarcă fotografia farfuriei care iese acum din bucătărie.
          </p>

          <PhotoDrop
            prompt="Fotografia farfuriei de evaluat"
            hint="O singură fotografie · JPEG, PNG sau WebP"
            multiple={false}
            disabled={busy}
            previews={candidate ? [{ url: candidate.url, name: candidate.file.name }] : []}
            onAdd={onAddCandidate}
            onRemove={onNewCandidate}
          />

          <div className={styles.panelActions}>
            <span />
            <button
              type="button"
              className="btn btn-primary"
              onClick={onSubmitCandidate}
              disabled={busy || candidate === null}
            >
              {busy ? (progress ?? "Se trimite…") : "Trimite la evaluare"}
            </button>
          </div>
        </section>
      ) : null}

      {pending ? (
        <section className={`card ${styles.pendingPanel}`}>
          <span className={styles.spinner} aria-hidden />
          <div>
            <h2 className={styles.pendingTitle}>
              {evaluation && evaluation.status !== "completed"
                ? PENDING_STATUS_RO[evaluation.status as "queued" | "running"]
                : PENDING_STATUS_RO.queued}
            </h2>
            <p className={styles.pendingHint}>
              Trei rulări independente, scor median — de obicei sub un minut.
            </p>
          </div>
        </section>
      ) : null}

      {showReport && evaluation ? (
        <ReportView
          evaluation={evaluation}
          dishName={dish?.name.ro ?? ""}
          candidateUrl={candidate?.url ?? null}
          referenceUrls={refUrls}
          onRetry={onRetryEvaluation}
          onNewCandidate={onNewCandidate}
        />
      ) : null}
    </div>
  );
}
