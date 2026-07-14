"use client";

import {
  MEDIA_UPLOAD_ALLOWED_CONTENT_TYPES,
  MEDIA_UPLOAD_MAX_BYTES,
  type UploadMediaResponse,
} from "@boca/contracts";
import { type DragEvent, type ReactNode, useId, useRef, useState } from "react";
import { uploadMedia } from "@/lib/api";
import styles from "./panels/panels.module.css";

/** Client-side pre-flight mirroring the server limits, RO messages. */
export function validateMediaFile(file: File): string | null {
  if (!(MEDIA_UPLOAD_ALLOWED_CONTENT_TYPES as readonly string[]).includes(file.type)) {
    return "Format neacceptat — folosește JPEG, PNG sau WebP.";
  }
  if (file.size > MEDIA_UPLOAD_MAX_BYTES) {
    const mib = Math.round(MEDIA_UPLOAD_MAX_BYTES / (1024 * 1024));
    return `Fișierul depășește limita de ${mib} MB.`;
  }
  return null;
}

/**
 * Drag/drop + browse dropzone. Uploads every accepted file through the multipart
 * media route and reports each result upward. `multiple` allows batch uploads.
 */
export function Dropzone({
  onUploaded,
  onError,
  multiple = false,
  title = "Încarcă fotografii",
  hint = "Trage fișierele aici sau răsfoiește. JPEG, PNG sau WebP, până la 15 MB.",
  children,
}: {
  onUploaded: (asset: UploadMediaResponse) => void;
  onError?: (message: string) => void;
  multiple?: boolean;
  title?: string;
  hint?: string;
  children?: ReactNode;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const list = multiple ? Array.from(files) : [files[0]];
    setBusy(true);
    try {
      for (const file of list) {
        if (!file) continue;
        const invalid = validateMediaFile(file);
        if (invalid) {
          onError?.(invalid);
          continue;
        }
        try {
          const asset = await uploadMedia(file);
          onUploaded(asset);
        } catch (err) {
          onError?.(err instanceof Error ? err.message : "Încărcarea a eșuat.");
        }
      }
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function onDrop(e: DragEvent<HTMLElement>) {
    e.preventDefault();
    setDragging(false);
    void handleFiles(e.dataTransfer.files);
  }

  return (
    <div>
      <label
        htmlFor={inputId}
        className={`${styles.dropzone} ${dragging ? styles.dropzoneActive : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {children ?? (
          <>
            <h4>{busy ? "Se încarcă…" : title}</h4>
            <p className={styles.dropzoneSub}>{hint}</p>
            <span className="btn btn--outline-gold btn--sm">Răsfoiește fișiere</span>
          </>
        )}
      </label>
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept={MEDIA_UPLOAD_ALLOWED_CONTENT_TYPES.join(",")}
        multiple={multiple}
        hidden
        disabled={busy}
        onChange={(e) => handleFiles(e.target.files)}
      />
    </div>
  );
}
