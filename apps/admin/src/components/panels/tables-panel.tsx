"use client";

import type { AdminTable } from "@boca/contracts";
import { QRCodeCanvas, QRCodeSVG } from "qrcode.react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { closeTable, createTable, deleteTable, listTables } from "@/lib/api";
import styles from "./panels.module.css";

// Baked at build (compose passes NEXT_PUBLIC_GUEST_ORIGIN = the guest host).
const GUEST_ORIGIN = process.env.NEXT_PUBLIC_GUEST_ORIGIN || "";

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

export function TablesPanel() {
  const [tables, setTables] = useState<AdminTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [seats, setSeats] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [qrTable, setQrTable] = useState<AdminTable | null>(null);
  // Hi-res canvas mirror of the shown QR — the source for download + print.
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);

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

  function downloadQr() {
    const canvas = qrCanvasRef.current;
    if (!canvas || !qrTable) return;
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `qr-${qrTable.label.replace(/\s+/g, "-").toLowerCase()}.png`;
    link.click();
  }

  function printQr() {
    const canvas = qrCanvasRef.current;
    if (!canvas || !qrTable?.qrSlug) return;
    const dataUrl = canvas.toDataURL("image/png");
    const win = window.open("", "_blank", "width=420,height=600");
    if (!win) return; // popup blocked — the on-screen QR + download still work
    win.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>QR ${escapeHtml(qrTable.label)}</title></head>` +
        `<body style="margin:0;padding:36px;text-align:center;font-family:system-ui,sans-serif;color:#241c15">` +
        `<h2 style="font-family:Georgia,serif;font-weight:500;margin:0 0 6px">${escapeHtml(qrTable.label)}</h2>` +
        `<p style="margin:0 0 22px;color:#8a795f;font-size:13px">Scanează pentru a comanda de la masă</p>` +
        `<img src="${dataUrl}" alt="" style="width:300px;height:300px"/>` +
        `<p style="margin:20px 0 0;color:#8a795f;font-size:11px;word-break:break-all">${escapeHtml(tableUrl(qrTable.qrSlug))}</p>` +
        `<script>window.onload=function(){window.focus();window.print();}</script></body></html>`,
    );
    win.document.close();
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
                          className="btn btn--gold btn--sm"
                          onClick={() => setQrTable(t)}
                        >
                          Cod QR
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
            Apasă „Cod QR” la orice masă ca să vezi codul, apoi tipărește-l sau descarcă-l pentru
            masă.
          </p>
        </div>
      )}

      {qrTable?.qrSlug ? (
        <div className={styles.qrOverlay} role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label="Închide"
            className={styles.backdrop}
            onClick={() => setQrTable(null)}
          />
          <div className={styles.qrCard}>
            <div className={styles.qrHead}>
              <div>
                <div className={styles.qrTitle}>{qrTable.label}</div>
                <div className={styles.qrSub}>Scanează pentru a comanda de la masă</div>
              </div>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={() => setQrTable(null)}
                aria-label="Închide"
              >
                ✕
              </button>
            </div>
            <div className={styles.qrFrame}>
              <QRCodeSVG value={tableUrl(qrTable.qrSlug)} size={220} level="M" marginSize={2} />
            </div>
            <p className={styles.qrLink}>{tableUrl(qrTable.qrSlug)}</p>
            <div className={styles.qrActions}>
              <button type="button" className="btn btn--gold btn--sm" onClick={printQr}>
                Printează
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={downloadQr}>
                Descarcă PNG
              </button>
            </div>
            {/* Hi-res off-screen mirror used as the print/download source. */}
            <QRCodeCanvas
              ref={qrCanvasRef}
              value={tableUrl(qrTable.qrSlug)}
              size={1024}
              level="M"
              marginSize={2}
              style={{ display: "none" }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
