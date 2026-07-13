"use client";

import { type ChangeEvent, type DragEvent, useId, useState } from "react";
import styles from "./photo-drop.module.css";

export interface PhotoPreview {
  url: string;
  name: string;
}

interface PhotoDropProps {
  prompt: string;
  hint: string;
  multiple: boolean;
  disabled: boolean;
  previews: PhotoPreview[];
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
}

/**
 * Drag-and-drop photo picker with thumbnails. Object URLs are owned by the
 * parent (created on add, revoked on remove/reset) — this stays presentational.
 */
export function PhotoDrop({
  prompt,
  hint,
  multiple,
  disabled,
  previews,
  onAdd,
  onRemove,
}: PhotoDropProps) {
  const inputId = useId();
  const [dragOver, setDragOver] = useState(false);

  function handleInput(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files ? Array.from(event.target.files) : [];
    if (files.length > 0) onAdd(files);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragOver(false);
    if (disabled) return;
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) onAdd(files);
  }

  return (
    <div className={styles.wrap}>
      <label
        htmlFor={inputId}
        className={styles.zone}
        data-dragover={dragOver || undefined}
        data-disabled={disabled || undefined}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <span className={styles.zoneIcon} aria-hidden>
          ◈
        </span>
        <span className={styles.zonePrompt}>{prompt}</span>
        <span className={styles.zoneHint}>{hint}</span>
        <input
          id={inputId}
          className={styles.input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple={multiple}
          disabled={disabled}
          onChange={handleInput}
        />
      </label>

      {previews.length > 0 ? (
        <ul className={styles.thumbs}>
          {previews.map((p, i) => (
            <li key={p.url} className={styles.thumb}>
              {/* biome-ignore lint/performance/noImgElement: blob: object URLs — next/image cannot optimize them */}
              <img src={p.url} alt={p.name} />
              {!disabled ? (
                <button
                  type="button"
                  className={styles.remove}
                  aria-label={`Elimină ${p.name}`}
                  onClick={() => onRemove(i)}
                >
                  ×
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
