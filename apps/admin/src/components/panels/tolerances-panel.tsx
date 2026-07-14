"use client";

import { SCORING_CRITERIA, type ScoringCriterionKey } from "@boca/config";
import type {
  AdminDishListItem,
  ToleranceCriteria,
  ToleranceCriterion,
  ToleranceVariance,
} from "@boca/contracts";
import { useCallback, useEffect, useState } from "react";
import { getTolerance, listDishes, putTolerance } from "@/lib/api";
import styles from "./panels.module.css";

const VARIANTS: { key: ToleranceVariance; label: string }[] = [
  { key: "strict", label: "Strict" },
  { key: "balanced", label: "Echilibrat" },
  { key: "permissive", label: "Permisiv" },
];

function emptyCriteria(): ToleranceCriteria {
  const base: ToleranceCriterion = { allowedVariance: "balanced", notesRo: "" };
  return {
    components: { ...base },
    arrangement: { ...base },
    sauce: { ...base },
    cleanliness: { ...base },
    color: { ...base },
    portion: { ...base },
  };
}

export function TolerancesPanel() {
  const [dishes, setDishes] = useState<AdminDishListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [criteria, setCriteria] = useState<ToleranceCriteria>(emptyCriteria);
  const [hasExisting, setHasExisting] = useState(false);
  const [loadingDishes, setLoadingDishes] = useState(true);
  const [loadingTol, setLoadingTol] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listDishes()
      .then((d) => {
        if (cancelled) return;
        setDishes(d);
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

  const loadTol = useCallback((dishId: string) => {
    setLoadingTol(true);
    setError(null);
    setOk(null);
    getTolerance(dishId)
      .then((c) => {
        setHasExisting(c !== null);
        setCriteria(c ?? emptyCriteria());
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Nu am putut încărca toleranțele."),
      )
      .finally(() => setLoadingTol(false));
  }, []);

  useEffect(() => {
    if (selectedId) loadTol(selectedId);
  }, [selectedId, loadTol]);

  function setVariance(key: ScoringCriterionKey, v: ToleranceVariance) {
    setCriteria((prev) => ({ ...prev, [key]: { ...prev[key], allowedVariance: v } }));
  }
  function setNotes(key: ScoringCriterionKey, notes: string) {
    setCriteria((prev) => ({ ...prev, [key]: { ...prev[key], notesRo: notes } }));
  }

  async function save() {
    if (!selectedId) return;
    setSaving(true);
    setError(null);
    setOk(null);
    try {
      const saved = await putTolerance(selectedId, { criteria });
      setCriteria(saved);
      setHasExisting(true);
      setOk("Profilul de toleranțe a fost publicat.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nu am putut salva toleranțele.");
    } finally {
      setSaving(false);
    }
  }

  const selectedDish = dishes.find((d) => d.id === selectedId);

  return (
    <div>
      <div className={styles.head}>
        <div>
          <span className="eyebrow eyebrow--ink">Bucătar-șef · versionat</span>
          <h1>Toleranțe</h1>
          <p className={styles.intro}>
            Cât de aproape de etalon trebuie să fie montajul pe fiecare criteriu. Aceste praguri
            definesc ce înseamnă „abatere” pentru AI; fiecare evaluare reține profilul cu care a
            fost scorată.
          </p>
        </div>
      </div>

      {loadingDishes ? (
        <div className={styles.state}>Se încarcă preparatele…</div>
      ) : dishes.length === 0 ? (
        <div className={styles.state}>Adaugă întâi preparate în meniu.</div>
      ) : (
        <>
          <label className="field" style={{ maxWidth: 420, marginBottom: 22 }}>
            <span className="field-label">Preparat</span>
            <select
              className="input"
              value={selectedId ?? ""}
              onChange={(e) => setSelectedId(e.target.value || null)}
            >
              {dishes.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name.ro}
                </option>
              ))}
            </select>
          </label>

          <div className={`card ${styles.block}`}>
            <div className={styles.blockHead}>
              <div>
                <h3>{selectedDish?.name.ro ?? "Preparat"}</h3>
                <div style={{ marginTop: 8 }}>
                  <span className={hasExisting ? "chip chip--gold" : "chip"}>
                    {hasExisting ? "Profil de toleranțe activ" : "Fără profil — valori implicite"}
                  </span>
                </div>
              </div>
            </div>

            {loadingTol ? (
              <p className={styles.spinner}>Se încarcă…</p>
            ) : (
              <>
                <div>
                  {SCORING_CRITERIA.map((crit) => {
                    const key = crit.key;
                    const value = criteria[key];
                    return (
                      <div key={key} className={styles.tolRow}>
                        <div>
                          <div className={styles.tolName}>{crit.labelRo}</div>
                          <p className={styles.tolDesc}>{crit.descriptionRo}</p>
                        </div>
                        <div className={styles.segmented}>
                          {VARIANTS.map((v) => (
                            <button
                              key={v.key}
                              type="button"
                              className={value.allowedVariance === v.key ? styles.segOn : ""}
                              aria-pressed={value.allowedVariance === v.key}
                              onClick={() => setVariance(key, v.key)}
                            >
                              {v.label}
                            </button>
                          ))}
                        </div>
                        <label className="field">
                          <span className="field-label">Notă bucătar-șef</span>
                          <textarea
                            className="textarea"
                            value={value.notesRo}
                            placeholder="Observații pentru acest criteriu (opțional)"
                            onChange={(e) => setNotes(key, e.target.value)}
                          />
                        </label>
                      </div>
                    );
                  })}
                </div>

                {error ? (
                  <p className="form-error" style={{ marginTop: 16 }}>
                    {error}
                  </p>
                ) : null}
                {ok ? (
                  <p className="form-ok" style={{ marginTop: 16 }}>
                    {ok}
                  </p>
                ) : null}

                <div className={styles.formActions}>
                  <button type="button" className="btn btn--gold" disabled={saving} onClick={save}>
                    {saving ? "Se publică…" : "Publică versiunea"}
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
