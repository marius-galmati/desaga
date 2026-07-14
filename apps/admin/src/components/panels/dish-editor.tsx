"use client";

import type { AdminAllergen, AdminCategory, AdminStation } from "@boca/contracts";
import { type FormEvent, useEffect, useState } from "react";
import { createDish, getDish, updateDish } from "@/lib/api";
import { minorToLeiInput, parseLeiToMinor } from "@/lib/format";
import { Dropzone } from "../uploader";
import styles from "./panels.module.css";

interface EditorState {
  nameRo: string;
  nameEn: string;
  descRo: string;
  descEn: string;
  storyRo: string;
  storyEn: string;
  price: string;
  categoryId: string;
  stationId: string;
  allergenCodes: string[];
  nonScoreable: boolean;
  heroUrl: string | null;
  heroMediaId: string | null;
}

const EMPTY = (categoryId: string, stationId: string): EditorState => ({
  nameRo: "",
  nameEn: "",
  descRo: "",
  descEn: "",
  storyRo: "",
  storyEn: "",
  price: "",
  categoryId,
  stationId,
  allergenCodes: [],
  nonScoreable: false,
  heroUrl: null,
  heroMediaId: null,
});

/** Create (dishId === null) or edit a dish. On save it calls the API and, on
 *  success, invokes onSaved so the menu can refresh. */
export function DishEditor({
  dishId,
  categories,
  stations,
  allergens,
  defaultCategoryId,
  onClose,
  onSaved,
}: {
  dishId: string | null;
  categories: AdminCategory[];
  stations: AdminStation[];
  allergens: AdminAllergen[];
  defaultCategoryId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const firstStation = stations[0]?.id ?? "";
  const [state, setState] = useState<EditorState>(() => EMPTY(defaultCategoryId, firstStation));
  const [loading, setLoading] = useState<boolean>(dishId !== null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (dishId === null) return;
    let cancelled = false;
    setLoading(true);
    getDish(dishId)
      .then((d) => {
        if (cancelled) return;
        setState({
          nameRo: d.name.ro,
          nameEn: d.name.en,
          descRo: d.description?.ro ?? "",
          descEn: d.description?.en ?? "",
          storyRo: d.story?.ro ?? "",
          storyEn: d.story?.en ?? "",
          price: minorToLeiInput(d.priceMinor),
          categoryId: d.categoryId,
          stationId: d.stationId,
          allergenCodes: d.allergenCodes,
          nonScoreable: d.non_scoreable,
          heroUrl: d.heroPhotoUrl,
          heroMediaId: null,
        });
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Nu am putut încărca preparatul.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dishId]);

  function patch(next: Partial<EditorState>) {
    setState((prev) => ({ ...prev, ...next }));
  }

  function toggleAllergen(code: string) {
    setState((prev) => ({
      ...prev,
      allergenCodes: prev.allergenCodes.includes(code)
        ? prev.allergenCodes.filter((c) => c !== code)
        : [...prev.allergenCodes, code],
    }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const priceMinor = parseLeiToMinor(state.price);
    if (priceMinor === null) {
      setError("Introdu un preț valid (ex. 48 sau 48,50).");
      return;
    }
    if (state.nameRo.trim() === "") {
      setError("Denumirea în română este obligatorie.");
      return;
    }
    if (state.categoryId === "" || state.stationId === "") {
      setError("Alege o categorie și o stație.");
      return;
    }

    const name = { ro: state.nameRo.trim(), en: state.nameEn.trim() };
    const description = { ro: state.descRo.trim(), en: state.descEn.trim() };
    const story = { ro: state.storyRo.trim(), en: state.storyEn.trim() };

    setSaving(true);
    try {
      if (dishId === null) {
        await createDish({
          categoryId: state.categoryId,
          name,
          description,
          story,
          priceMinor,
          stationId: state.stationId,
          allergenCodes: state.allergenCodes,
          non_scoreable: state.nonScoreable,
          ...(state.heroMediaId ? { heroMediaId: state.heroMediaId } : {}),
        });
      } else {
        await updateDish(dishId, {
          categoryId: state.categoryId,
          name,
          description,
          story,
          priceMinor,
          stationId: state.stationId,
          allergenCodes: state.allergenCodes,
          non_scoreable: state.nonScoreable,
          ...(state.heroMediaId ? { heroMediaId: state.heroMediaId } : {}),
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Salvarea a eșuat.");
      setSaving(false);
    }
  }

  return (
    <div className={styles.overlay}>
      <button type="button" className={styles.backdrop} aria-label="Închide" onClick={onClose} />
      <div className={styles.drawer} role="dialog" aria-modal="true">
        <div className={styles.drawerHead}>
          <div>
            <span className="eyebrow eyebrow--ink">Preparat · versionat</span>
            <h2 style={{ fontSize: "1.7rem", marginTop: 4 }}>
              {dishId === null ? "Adaugă preparat" : "Editează preparatul"}
            </h2>
          </div>
          <button type="button" className={styles.closeBtn} aria-label="Închide" onClick={onClose}>
            ×
          </button>
        </div>

        {loading ? (
          <p className={styles.spinner}>Se încarcă…</p>
        ) : (
          <form className={styles.drawerForm} onSubmit={onSubmit}>
            {/* hero photo */}
            <div className="field">
              <span className="field-label">Fotografie principală</span>
              <div className={styles.heroUploader}>
                <div className={styles.heroPreview}>
                  {state.heroUrl ? (
                    <img src={state.heroUrl} alt="Fotografia preparatului" />
                  ) : (
                    <div className={styles.heroPreviewEmpty}>Fără fotografie</div>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <Dropzone
                    title="Încarcă fotografia"
                    hint="Se salvează pe preparat când apeși „Salvează”."
                    onUploaded={(asset) =>
                      patch({ heroUrl: asset.url, heroMediaId: asset.mediaId })
                    }
                    onError={(m) => setError(m)}
                  />
                </div>
              </div>
            </div>

            <div className={styles.formGrid}>
              <label className="field">
                <span className="field-label">Denumire (RO)</span>
                <input
                  className="input"
                  value={state.nameRo}
                  onChange={(e) => patch({ nameRo: e.target.value })}
                  required
                />
              </label>
              <label className="field">
                <span className="field-label">Denumire (EN)</span>
                <input
                  className="input"
                  value={state.nameEn}
                  onChange={(e) => patch({ nameEn: e.target.value })}
                />
              </label>
            </div>

            <div className={styles.formGrid}>
              <label className="field">
                <span className="field-label">Descriere (RO)</span>
                <textarea
                  className="textarea"
                  value={state.descRo}
                  onChange={(e) => patch({ descRo: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="field-label">Descriere (EN)</span>
                <textarea
                  className="textarea"
                  value={state.descEn}
                  onChange={(e) => patch({ descEn: e.target.value })}
                />
              </label>
            </div>

            <div className={styles.formGrid}>
              <label className="field">
                <span className="field-label">Preț (lei)</span>
                <input
                  className="input"
                  inputMode="decimal"
                  value={state.price}
                  onChange={(e) => patch({ price: e.target.value })}
                  placeholder="48"
                  required
                />
              </label>
              <label className="field">
                <span className="field-label">Categorie</span>
                <select
                  className="select"
                  value={state.categoryId}
                  onChange={(e) => patch({ categoryId: e.target.value })}
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name.ro}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Stație</span>
                <select
                  className="select"
                  value={state.stationId}
                  onChange={(e) => patch({ stationId: e.target.value })}
                >
                  {stations.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.name.ro}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="field">
              <span className="field-label">Alergeni</span>
              <div className={styles.allergenGrid}>
                {allergens.map((a) => {
                  const on = state.allergenCodes.includes(a.code);
                  return (
                    <button
                      key={a.code}
                      type="button"
                      className={`${styles.allergen} ${on ? styles.allergenOn : ""}`}
                      aria-pressed={on}
                      onClick={() => toggleAllergen(a.code)}
                    >
                      {a.name.ro}
                    </button>
                  );
                })}
                {allergens.length === 0 ? (
                  <span className="faint">Niciun alergen definit.</span>
                ) : null}
              </div>
            </div>

            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={state.nonScoreable}
                onChange={(e) => patch({ nonScoreable: e.target.checked })}
              />
              <span>Preparat neevaluabil AI (fără scor de montaj)</span>
            </label>

            {error ? <p className="form-error">{error}</p> : null}

            <div className={styles.formActions}>
              <button type="submit" className="btn" disabled={saving}>
                {saving ? "Se salvează…" : "Salvează"}
              </button>
              <button type="button" className="btn btn--ghost" onClick={onClose} disabled={saving}>
                Anulează
              </button>
              {dishId !== null ? (
                <span className="faint" style={{ fontSize: "0.8rem" }}>
                  Salvarea creează o versiune nouă a preparatului.
                </span>
              ) : null}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
