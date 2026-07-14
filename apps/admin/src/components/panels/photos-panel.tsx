"use client";

import type { AdminMediaAsset } from "@boca/contracts";
import { useEffect, useState } from "react";
import { deleteMedia, listMedia } from "@/lib/api";
import { Dropzone } from "../uploader";
import styles from "./panels.module.css";

export function PhotosPanel() {
  const [media, setMedia] = useState<AdminMediaAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  async function remove(asset: AdminMediaAsset) {
    if (!window.confirm("Ștergi definitiv această fotografie? Acțiunea nu poate fi anulată.")) {
      return;
    }
    setRemovingId(asset.id);
    setError(null);
    try {
      await deleteMedia(asset.id);
      setMedia((prev) => prev.filter((m) => m.id !== asset.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nu am putut șterge fotografia.");
    } finally {
      setRemovingId(null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    listMedia()
      .then((m) => {
        if (!cancelled) setMedia(m);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Nu am putut încărca biblioteca.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <div className={styles.head}>
        <div>
          <span className="eyebrow eyebrow--ink">Bibliotecă</span>
          <h1>Fotografii</h1>
          <p className={styles.intro}>
            Fotografiile preparatelor. Încarcă imagini noi și folosește-le pentru fotografia
            principală a unui preparat sau pentru seturile de referință AI.
          </p>
        </div>
      </div>

      {error ? (
        <p className="form-error" style={{ marginBottom: 18 }}>
          {error}
        </p>
      ) : null}

      <div className={styles.photoGrid}>
        <Dropzone
          multiple
          title="Încarcă fotografii noi"
          hint="Trage fișierele aici sau răsfoiește. JPEG, PNG sau WebP, până la 15 MB."
          onUploaded={(asset) =>
            setMedia((prev) => [
              {
                id: asset.mediaId,
                url: asset.url,
                contentType: "image/jpeg",
                width: asset.width,
                height: asset.height,
                createdAt: new Date().toISOString(),
              },
              ...prev,
            ])
          }
          onError={(m) => setError(m)}
        />

        {loading ? (
          <div className={styles.state}>Se încarcă…</div>
        ) : (
          media.map((asset) => (
            <figure key={asset.id} className={styles.photoTile}>
              <img src={asset.url} alt="Fotografie preparat" />
              <button
                type="button"
                className={styles.photoDelete}
                disabled={removingId === asset.id}
                title="Șterge fotografia"
                aria-label="Șterge fotografia"
                onClick={() => void remove(asset)}
              >
                {removingId === asset.id ? "…" : "✕"}
              </button>
              <figcaption className={styles.photoCap}>
                <span>
                  {asset.width && asset.height ? `${asset.width} × ${asset.height}` : "imagine"}
                </span>
                <span>{asset.contentType.replace("image/", "").toUpperCase()}</span>
              </figcaption>
            </figure>
          ))
        )}
      </div>

      {!loading && media.length === 0 ? (
        <p className="faint" style={{ marginTop: 18, fontSize: "0.9rem" }}>
          Biblioteca e goală — încarcă prima fotografie.
        </p>
      ) : null}
    </div>
  );
}
