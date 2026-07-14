"use client";

import type {
  AdminAllergen,
  AdminCategory,
  AdminDishListItem,
  AdminSettingsLocation,
  AdminStation,
} from "@boca/contracts";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  archiveCategory,
  archiveDish,
  createCategory,
  getSettings,
  listAllergens,
  listCategories,
  listDishes,
  listStations,
  setDishAvailability,
} from "@/lib/api";
import { formatPrice } from "@/lib/format";
import { DishEditor } from "./dish-editor";
import styles from "./panels.module.css";

type EditorTarget = { dishId: string | null; categoryId: string } | null;

const REF_STATUS_LABEL: Record<string, string> = {
  draft: "Referințe ciornă",
  active: "Referințe active",
  retired: "Referințe retrase",
};

export function MenuPanel() {
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [dishes, setDishes] = useState<AdminDishListItem[]>([]);
  const [stations, setStations] = useState<AdminStation[]>([]);
  const [allergens, setAllergens] = useState<AdminAllergen[]>([]);
  const [locations, setLocations] = useState<AdminSettingsLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorTarget>(null);
  const [addingCategory, setAddingCategory] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [cats, dsh] = await Promise.all([listCategories(), listDishes()]);
      setCategories(cats);
      setDishes(dsh);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nu am putut încărca meniul.");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [cats, dsh, sts, alg, settings] = await Promise.all([
          listCategories(),
          listDishes(),
          listStations(),
          listAllergens(),
          getSettings(),
        ]);
        if (cancelled) return;
        setCategories(cats);
        setDishes(dsh);
        setStations(sts);
        setAllergens(alg);
        setLocations(settings.locations);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Nu am putut încărca meniul.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const primaryLocationId = locations[0]?.id ?? null;

  async function removeDish(dish: AdminDishListItem) {
    if (
      !window.confirm(
        `Ștergi „${dish.name.ro}” din meniu? Se arhivează (dispare din meniu, dar istoricul evaluărilor rămâne).`,
      )
    ) {
      return;
    }
    setError(null);
    try {
      await archiveDish(dish.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nu am putut șterge preparatul.");
    }
  }

  async function removeCategory(cat: AdminCategory) {
    if (!window.confirm(`Ștergi categoria „${cat.name.ro}”?`)) return;
    setError(null);
    try {
      await archiveCategory(cat.id);
      await refresh();
    } catch (err) {
      // 409 message ("categoria are N preparate active…") surfaces here.
      setError(err instanceof Error ? err.message : "Nu am putut șterge categoria.");
    }
  }

  async function toggleAvailability(dish: AdminDishListItem) {
    if (!primaryLocationId) return;
    const current = dish.availability.find((a) => a.locationId === primaryLocationId);
    const nextIs86 = !(current?.is86ed ?? false);
    // optimistic
    setDishes((prev) =>
      prev.map((d) =>
        d.id === dish.id
          ? {
              ...d,
              availability: [
                ...d.availability.filter((a) => a.locationId !== primaryLocationId),
                { locationId: primaryLocationId, is86ed: nextIs86 },
              ],
            }
          : d,
      ),
    );
    try {
      await setDishAvailability(dish.id, { locationId: primaryLocationId, is86ed: nextIs86 });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nu am putut schimba disponibilitatea.");
      void refresh();
    }
  }

  if (loading) {
    return <div className={styles.state}>Se încarcă meniul…</div>;
  }

  return (
    <div>
      <div className={styles.head}>
        <div>
          <span className="eyebrow eyebrow--ink">Conținut · versionat</span>
          <h1>Meniu</h1>
          <p className={styles.intro}>
            Preparatele publicate în aplicația oaspeților. Editează denumiri, prețuri, fotografii și
            disponibilitatea pe fiecare locație.
          </p>
        </div>
        <div className={styles.headActions}>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setAddingCategory((v) => !v)}
          >
            + Adaugă categorie
          </button>
          <button
            type="button"
            className="btn btn--gold btn--sm"
            disabled={categories.length === 0 || stations.length === 0}
            onClick={() => setEditor({ dishId: null, categoryId: categories[0]?.id ?? "" })}
          >
            + Adaugă preparat
          </button>
        </div>
      </div>

      {addingCategory ? (
        <AddCategoryForm
          onCreated={async () => {
            setAddingCategory(false);
            await refresh();
          }}
          onCancel={() => setAddingCategory(false)}
          nextSortOrder={categories.length}
        />
      ) : null}

      {error ? (
        <p className="form-error" style={{ marginBottom: 18 }}>
          {error}
        </p>
      ) : null}

      {categories.length === 0 ? (
        <div className={styles.state}>
          Niciun preparat încă. Adaugă întâi o categorie, apoi preparate.
        </div>
      ) : null}

      {categories.map((cat) => {
        const catDishes = dishes.filter((d) => d.categoryId === cat.id);
        return (
          <section key={cat.id} className={styles.category}>
            <div className={styles.categoryHead}>
              <h2>{cat.name.ro}</h2>
              <span className={styles.categoryCount}>{catDishes.length} preparate</span>
              <div className={styles.categoryActions}>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={stations.length === 0}
                  onClick={() => setEditor({ dishId: null, categoryId: cat.id })}
                >
                  + Preparat
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  title="Șterge categoria (trebuie să fie goală)"
                  onClick={() => void removeCategory(cat)}
                >
                  Șterge
                </button>
              </div>
            </div>

            {catDishes.length === 0 ? (
              <p className="faint" style={{ fontSize: "0.88rem" }}>
                Nicio poziție în această categorie.
              </p>
            ) : (
              <div className={styles.dishGrid}>
                {catDishes.map((dish) => {
                  const is86 =
                    primaryLocationId != null &&
                    (dish.availability.find((a) => a.locationId === primaryLocationId)?.is86ed ??
                      false);
                  return (
                    <article
                      key={dish.id}
                      className={`card ${styles.dishCard} ${is86 ? styles.dishCardOff : ""}`}
                    >
                      <button
                        type="button"
                        className={styles.dishOpen}
                        onClick={() => setEditor({ dishId: dish.id, categoryId: dish.categoryId })}
                      >
                        <div className={styles.thumb}>
                          {dish.heroPhotoUrl ? (
                            <img src={dish.heroPhotoUrl} alt={dish.name.ro} />
                          ) : (
                            <div className={styles.thumbEmpty}>Fără fotografie</div>
                          )}
                        </div>
                        <div className={styles.dishBody}>
                          <div>
                            <div className={styles.dishName}>{dish.name.ro}</div>
                            {dish.name.en ? (
                              <div className={styles.dishNameEn}>{dish.name.en}</div>
                            ) : null}
                          </div>
                          <div className={styles.dishChips}>
                            {dish.refsStale ? (
                              <span
                                className="chip chip--gold"
                                title="Setul de referință e învechit"
                              >
                                ◆ refs învechite
                              </span>
                            ) : null}
                            {dish.referenceSet ? (
                              <span className="chip chip--pine">
                                {REF_STATUS_LABEL[dish.referenceSet.status] ??
                                  dish.referenceSet.status}{" "}
                                · {dish.referenceSet.photoCount} foto
                              </span>
                            ) : (
                              <span className="chip">Fără referințe</span>
                            )}
                            {dish.non_scoreable ? (
                              <span className="chip chip--vin">Neevaluabil</span>
                            ) : null}
                          </div>
                        </div>
                      </button>
                      <div className={styles.dishFoot}>
                        <span className={styles.price}>{formatPrice(dish.priceMinor)}</span>
                        <div className={styles.dishFootActions}>
                          <button
                            type="button"
                            className={`${styles.avail} ${is86 ? styles.availOff : styles.availOn}`}
                            aria-pressed={!is86}
                            disabled={!primaryLocationId}
                            title={
                              primaryLocationId
                                ? "Comută disponibilitatea"
                                : "Nicio locație configurată"
                            }
                            onClick={() => void toggleAvailability(dish)}
                          >
                            {is86 ? "86" : "Disponibil"}
                            <span className={styles.availDot} aria-hidden />
                          </button>
                          <button
                            type="button"
                            className={styles.dishDelete}
                            title="Șterge preparatul din meniu"
                            aria-label="Șterge preparatul"
                            onClick={() => void removeDish(dish)}
                          >
                            Șterge
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}

      {editor ? (
        <DishEditor
          dishId={editor.dishId}
          categories={categories}
          stations={stations}
          allergens={allergens}
          defaultCategoryId={editor.categoryId}
          onClose={() => setEditor(null)}
          onSaved={async () => {
            setEditor(null);
            await refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function AddCategoryForm({
  onCreated,
  onCancel,
  nextSortOrder,
}: {
  onCreated: () => void;
  onCancel: () => void;
  nextSortOrder: number;
}) {
  const [ro, setRo] = useState("");
  const [en, setEn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await createCategory({ name: { ro: ro.trim(), en: en.trim() }, sortOrder: nextSortOrder });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nu am putut adăuga categoria.");
      setBusy(false);
    }
  }

  return (
    <form className={`card ${styles.block}`} onSubmit={onSubmit} style={{ marginBottom: 22 }}>
      <div className={styles.formGrid}>
        <label className="field">
          <span className="field-label">Denumire categorie (RO)</span>
          <input className="input" value={ro} onChange={(e) => setRo(e.target.value)} required />
        </label>
        <label className="field">
          <span className="field-label">Denumire categorie (EN)</span>
          <input className="input" value={en} onChange={(e) => setEn(e.target.value)} />
        </label>
      </div>
      {error ? (
        <p className="form-error" style={{ marginTop: 12 }}>
          {error}
        </p>
      ) : null}
      <div className={styles.formActions}>
        <button type="submit" className="btn btn--sm" disabled={busy}>
          {busy ? "Se adaugă…" : "Adaugă categoria"}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel} disabled={busy}>
          Anulează
        </button>
      </div>
    </form>
  );
}
