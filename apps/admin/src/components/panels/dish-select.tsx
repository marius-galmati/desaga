"use client";

import type { AdminCategory, AdminDishListItem } from "@boca/contracts";
import styles from "./panels.module.css";

/**
 * Cascading category -> dish picker. Fully derived from props: the selected
 * category is the category of the current dish; picking a category jumps to its
 * first dish. Categories with no dishes are hidden. Used by the references and
 * tolerances panels so the (large) dish list is filtered one category at a time.
 */
export function DishSelect({
  categories,
  dishes,
  value,
  onChange,
}: {
  categories: AdminCategory[];
  dishes: AdminDishListItem[];
  value: string | null;
  onChange: (dishId: string) => void;
}) {
  const currentCat = dishes.find((d) => d.id === value)?.categoryId ?? null;
  const nonEmpty = categories.filter((c) => dishes.some((d) => d.categoryId === c.id));
  const inCat = dishes.filter((d) => d.categoryId === currentCat);

  return (
    <div className={styles.dishSelect}>
      <label className="field">
        <span className="field-label">Categorie</span>
        <select
          className="input"
          value={currentCat ?? ""}
          onChange={(e) => {
            const first = dishes.find((d) => d.categoryId === e.target.value);
            if (first) onChange(first.id);
          }}
        >
          {nonEmpty.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name.ro}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">Preparat</span>
        <select
          className="input"
          value={value ?? ""}
          onChange={(e) => {
            if (e.target.value) onChange(e.target.value);
          }}
        >
          {inCat.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name.ro}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
