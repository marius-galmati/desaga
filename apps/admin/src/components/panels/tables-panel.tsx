"use client";

import type { AdminTable } from "@boca/contracts";
import { type FormEvent, useEffect, useState } from "react";
import { closeTable, createTable, deleteTable, listTables } from "@/lib/api";
import styles from "./panels.module.css";

// Baked at build (compose passes NEXT_PUBLIC_GUEST_ORIGIN = the guest host).
const GUEST_ORIGIN = process.env.NEXT_PUBLIC_GUEST_ORIGIN || "";

export function TablesPanel() {
  const [tables, setTables] = useState<AdminTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [seats, setSeats] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  async function refresh() {
    setTables(await listTables());
  }

  useEffect(() => {
    listTables()
      .then(setTables)
      .catch((err) => setError(err instanceof Error ? err.message : "Nu am putut încărca mesele."))
      .finally(() => setLoading(false));
  }, []);

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await createTable({
        label: label.trim(),
        ...(seats ? { seats: Number(seats) } : {}),
      });
      setLabel("");
      setSeats("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nu am putut crea masa.");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    if (!window.confirm("Ștergi masa? Codul QR curent nu va mai funcționa.")) return;
    setError(null);
    try {
      await deleteTable(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nu am putut șterge masa.");
    }
  }

  async function onClose(id: string) {
    if (
      !window.confirm(
        "Eliberezi masa? Sesiunea curentă se închide, iar următorul client pornește o comandă nouă.",
      )
    ) {
      return;
    }
    setError(null);
    try {
      await closeTable(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nu am putut elibera masa.");
    }
  }

  function tableUrl(slug: string): string {
    return `${GUEST_ORIGIN}/t/${slug}`;
  }

  async function copy(slug: string) {
    try {
      await navigator.clipboard.writeText(tableUrl(slug));
      setCopied(slug);
      setTimeout(() => setCopied((c) => (c === slug ? null : c)), 1500);
    } catch {
      /* clipboard blocked — user can select the text manually */
    }
  }

  return (
    <div>
      <div className={styles.head}>
        <div>
          <span className="eyebrow eyebrow--ink">Sală · QR</span>
          <h1>Mese</h1>
          <p className={styles.intro}>
            Fiecare masă are un link/QR unic. Tipărește codul QR și lipește-l pe masă — clientul îl
            scanează și comandă direct de la masa lui.
          </p>
        </div>
      </div>

      <form className={`card ${styles.block}`} onSubmit={onCreate} style={{ marginBottom: 22 }}>
        <div className={styles.formGrid}>
          <label className="field">
            <span className="field-label">Nume masă</span>
            <input
              className="input"
              value={label}
              placeholder="ex. Masa 1, Terasă 3"
              onChange={(e) => setLabel(e.target.value)}
              required
            />
          </label>
          <label className="field">
            <span className="field-label">Locuri (opțional)</span>
            <input
              className="input"
              type="number"
              min={1}
              max={50}
              value={seats}
              onChange={(e) => setSeats(e.target.value)}
            />
          </label>
        </div>
        <div className={styles.formActions}>
          <button type="submit" className="btn btn--gold btn--sm" disabled={busy || !label.trim()}>
            {busy ? "Se creează…" : "+ Adaugă masă"}
          </button>
        </div>
      </form>

      {error ? (
        <p className="form-error" style={{ marginBottom: 18 }}>
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className={styles.state}>Se încarcă…</div>
      ) : tables.length === 0 ? (
        <div className={styles.state}>Nicio masă încă. Adaugă prima masă mai sus.</div>
      ) : (
        <div className={`card ${styles.block}`}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Masă</th>
                <th>Locuri</th>
                <th>Stare</th>
                <th>Link comandă (QR)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tables.map((t) => (
                <tr key={t.id}>
                  <td>
                    <strong>{t.label}</strong>
                  </td>
                  <td>{t.seats ?? "—"}</td>
                  <td>
                    {t.occupied ? (
                      <span className="chip chip--gold">Ocupată</span>
                    ) : (
                      <span className="chip chip--pine">Liberă</span>
                    )}
                  </td>
                  <td>
                    {t.qrSlug ? (
                      <span className={styles.tableLink}>{tableUrl(t.qrSlug)}</span>
                    ) : (
                      <span className="faint">fără QR</span>
                    )}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <div style={{ display: "inline-flex", gap: 8, justifyContent: "flex-end" }}>
                      {t.occupied ? (
                        <button type="button" className="btn btn--sm" onClick={() => onClose(t.id)}>
                          Eliberează masa
                        </button>
                      ) : null}
                      {t.qrSlug ? (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => copy(t.qrSlug ?? "")}
                        >
                          {copied === t.qrSlug ? "Copiat ✓" : "Copiază link"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => onDelete(t.id)}
                      >
                        Șterge
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="faint" style={{ marginTop: 12, fontSize: "0.84rem" }}>
            Generează un cod QR din fiecare link (orice generator QR) și tipărește-l pentru masă.
          </p>
        </div>
      )}
    </div>
  );
}
