"use client";

import type {
  AdminCategory,
  AdminDishListItem,
  ReferencePhotoRole,
  ReferenceSetDetail,
} from "@boca/contracts";
import { useCallback, useEffect, useState } from "react";
import { createReferenceSet, getReferenceSet, listCategories, listDishes } from "@/lib/api";
import { Dropzone } from "../uploader";
import { DishSelect } from "./dish-select";
import styles from "./panels.module.css";

interface Candidate {
  mediaId: string;
  url: string;
  role: ReferencePhotoRole;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Ciornă",
  active: "Set activ",
  retired: "Retras",
};

export function ReferencesPanel() {
  const [dishes, setDishes] = useState<AdminDishListItem[]>([]);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [set, setSet] = useState<ReferenceSetDetail | null>(null);
  const [loadingDishes, setLoadingDishes] = useState(true);
  const [loadingSet, setLoadingSet] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listDishes(), listCategories()])
      .then(([d, c]) => {
        if (cancelled) return;
        setDishes(d);
        setCategories(c);
        setSelectedId((prev) => prev ?? d[0]?.id ?? null);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Nu am putut încărca preparatele.");
      })
      .finally(() => {
        if (!cancelled) setLoadingDishes(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadSet = useCallback((dishId: string) => {
    setLoadingSet(true);
    setError(null);
    setSet(null); // clear the previous dish's set so it can't linger on switch/error
    getReferenceSet(dishId)
      .then(setSet)
      .catch((err) => {
        setSet(null);
        setError(err instanceof Error ? err.message : "Nu am putut încărca setul.");
      })
      .finally(() => setLoadingSet(false));
  }, []);

  useEffect(() => {
    if (selectedId) {
      setCandidates([]);
      loadSet(selectedId);
    }
  }, [selectedId, loadSet]);

  const primaryCount = candidates.filter((c) => c.role === "primary").length;
  const canSubmit =
    candidates.length >= 3 && candidates.length <= 5 && primaryCount >= 3 && !saving;

  async function submit() {
    if (!selectedId) return;
    setSaving(true);
    setError(null);
    try {
      const detail = await createReferenceSet(selectedId, {
        photos: candidates.map((c) => ({ mediaId: c.mediaId, role: c.role })),
      });
      setSet(detail);
      setCandidates([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nu am putut salva setul.");
    } finally {
      setSaving(false);
    }
  }

  const selectedDish = dishes.find((d) => d.id === selectedId);

  return (
    <div>
      <div className={styles.head}>
        <div>
          <span className="eyebrow eyebrow--ink">Standard aur · AI</span>
          <h1>Seturi de referință</h1>
          <p className={styles.intro}>
            Farfuriile-etalon față de care AI compară montajul de la pass. 3–5 fotografii, dintre
            care cel puțin 3 „primare”. Fotografiază cu același dispozitiv ca la pass — aceeași
            lentilă, aceeași lumină.
          </p>
        </div>
      </div>

      {loadingDishes ? (
        <div className={styles.state}>Se încarcă preparatele…</div>
      ) : dishes.length === 0 ? (
        <div className={styles.state}>Adaugă întâi preparate în meniu.</div>
      ) : (
        <>
          <DishSelect
            categories={categories}
            dishes={dishes}
            value={selectedId}
            onChange={setSelectedId}
          />

          <div className={`card ${styles.block}`}>
            <div className={styles.blockHead}>
              <div>
                <h3>{selectedDish?.name.ro ?? "Preparat"}</h3>
                <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
                  {set ? (
                    <>
                      <span className="chip chip--pine">
                        {STATUS_LABEL[set.status] ?? set.status}
                      </span>
                      <span className="faint" style={{ fontSize: "0.82rem" }}>
                        · v{set.versionNo} · {set.photos.length} foto
                      </span>
                    </>
                  ) : (
                    <span className="chip">Niciun set încă</span>
                  )}
                </div>
              </div>
            </div>

            {loadingSet ? (
              <p className={styles.spinner}>Se încarcă setul…</p>
            ) : set ? (
              <>
                <div className={styles.refGroup}>
                  <RefRow
                    label="Primare"
                    hint="folosite la scorare"
                    photos={set.photos.filter((p) => p.role === "primary")}
                  />
                  <RefRow
                    label="Holdout"
                    hint="verificare, neexpuse modelului"
                    photos={set.photos.filter((p) => p.role === "holdout")}
                    holdout
                  />
                </div>
                {set.staleness.isStale ? (
                  <div className={styles.staleBox}>
                    <strong>Referințe învechite.</strong> Setul aparține versiunii v
                    {set.staleness.boundToVersionNo}, dar preparatul are o versiune mai nouă.
                    Reîncarcă un set nou ca scorurile AI să reflecte standardul actual.
                  </div>
                ) : (
                  <div className={styles.noteBox}>
                    Referințele aparțin versiunii v{set.staleness.boundToVersionNo} a preparatului.
                  </div>
                )}
              </>
            ) : (
              <p className="faint">Acest preparat nu are încă un set de referință.</p>
            )}
          </div>

          <div className={`card ${styles.block}`}>
            <div className={styles.blockHead}>
              <div>
                <h3>{set ? "Reîncarcă setul" : "Creează setul"}</h3>
                <p className={styles.tolDesc}>
                  Încarcă 3–5 fotografii și marchează cel puțin 3 ca „primare”. Setul nou devine
                  activ; cel vechi rămâne arhivat, legat de evaluările deja făcute.
                </p>
              </div>
            </div>

            <Dropzone
              multiple
              title="Încarcă fotografii pentru set"
              hint="JPEG, PNG sau WebP, până la 15 MB."
              onUploaded={(asset) =>
                setCandidates((prev) =>
                  prev.length >= 5
                    ? prev
                    : [...prev, { mediaId: asset.mediaId, url: asset.url, role: "primary" }],
                )
              }
              onError={(m) => setError(m)}
            />

            {candidates.length > 0 ? (
              <>
                <div className={styles.stageGrid}>
                  {candidates.map((c) => (
                    <div key={c.mediaId} className={styles.stageItem}>
                      <img src={c.url} alt="Candidat referință" />
                      <div className={styles.stageCtrls}>
                        <div className={styles.roleToggle}>
                          <button
                            type="button"
                            className={c.role === "primary" ? styles.roleToggleOn : ""}
                            onClick={() =>
                              setCandidates((prev) =>
                                prev.map((x) =>
                                  x.mediaId === c.mediaId ? { ...x, role: "primary" } : x,
                                ),
                              )
                            }
                          >
                            Primară
                          </button>
                          <button
                            type="button"
                            className={c.role === "holdout" ? styles.roleToggleOn : ""}
                            onClick={() =>
                              setCandidates((prev) =>
                                prev.map((x) =>
                                  x.mediaId === c.mediaId ? { ...x, role: "holdout" } : x,
                                ),
                              )
                            }
                          >
                            Holdout
                          </button>
                        </div>
                        <button
                          type="button"
                          className={styles.removeBtn}
                          onClick={() =>
                            setCandidates((prev) => prev.filter((x) => x.mediaId !== c.mediaId))
                          }
                        >
                          Șterge
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="faint" style={{ marginTop: 12, fontSize: "0.84rem" }}>
                  {candidates.length} fotografii · {primaryCount} primare
                  {canSubmit ? "" : " — sunt necesare 3–5 fotografii, minim 3 primare."}
                </p>
              </>
            ) : null}

            {error ? (
              <p className="form-error" style={{ marginTop: 12 }}>
                {error}
              </p>
            ) : null}

            <div className={styles.formActions}>
              <button type="button" className="btn" disabled={!canSubmit} onClick={submit}>
                {saving ? "Se salvează…" : "Publică setul de referință"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function RefRow({
  label,
  hint,
  photos,
  holdout = false,
}: {
  label: string;
  hint: string;
  photos: { id: string; url: string }[];
  holdout?: boolean;
}) {
  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", marginBottom: 8 }}>
        <span className="eyebrow eyebrow--ink">{label}</span>
        <span className="faint" style={{ fontSize: "0.76rem" }}>
          {hint}
        </span>
      </div>
      {photos.length === 0 ? (
        <p className="faint" style={{ fontSize: "0.84rem" }}>
          —
        </p>
      ) : (
        <div className={styles.refThumbRow}>
          {photos.map((p) => (
            <div key={p.id} className={`${styles.refThumb} ${holdout ? styles.refThumbHold : ""}`}>
              <img src={p.url} alt={label} />
              <span className={styles.roleTag}>{holdout ? "holdout" : "primară"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
