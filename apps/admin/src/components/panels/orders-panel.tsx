"use client";

import type { AdminOrder } from "@boca/contracts";
import { useCallback, useEffect, useState } from "react";
import { acceptOrder, listOrders, serveOrder } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { formatPrice } from "@/lib/format";
import styles from "./panels.module.css";

const STATUS_LABEL: Record<string, string> = {
  submitted: "Nouă",
  accepted: "Acceptată",
  fired: "În pregătire",
  ready: "Gata",
  served: "Servită",
  voided: "Anulată",
};

function elapsed(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "acum";
  if (mins === 1) return "acum 1 min";
  return `acum ${mins} min`;
}

export function OrdersPanel() {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // management_viewer sees the floor read-only (no accept/serve).
  const readOnly = getCurrentUser()?.role === "management_viewer";

  const refresh = useCallback(async () => {
    try {
      setOrders(await listOrders());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nu am putut încărca comenzile.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 8000); // live floor view
    return () => clearInterval(t);
  }, [refresh]);

  async function act(id: string, fn: (id: string) => Promise<void>) {
    setBusyId(id);
    setError(null);
    try {
      await fn(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Acțiunea a eșuat.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className={styles.head}>
        <div>
          <span className="eyebrow eyebrow--ink">Sală · live</span>
          <h1>Comenzi</h1>
          <p className={styles.intro}>
            Comenzile trimise de la mese, în ordinea sosirii. Acceptă comanda, apoi marcheaz-o
            servită când ajunge la masă. Se actualizează automat.
          </p>
        </div>
      </div>

      {error ? (
        <p className="form-error" style={{ marginBottom: 16 }}>
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className={styles.state}>Se încarcă…</div>
      ) : orders.length === 0 ? (
        <div className={styles.state}>Nicio comandă activă în acest moment.</div>
      ) : (
        <div className={styles.orderGrid}>
          {orders.map((o) => (
            <article key={o.id} className={`card ${styles.orderCard}`}>
              <div className={styles.orderTop}>
                <div>
                  <div className={styles.orderTable}>
                    {o.guest ? <span aria-hidden>{o.guest.emoji} </span> : null}
                    {o.tableLabel}
                  </div>
                  <div className={styles.orderMeta}>
                    {elapsed(o.createdAt)}
                    {o.isFirstOfSession ? " · prima comandă" : ""}
                  </div>
                </div>
                <span className={`chip ${o.status === "submitted" ? "chip--gold" : "chip--pine"}`}>
                  {STATUS_LABEL[o.status] ?? o.status}
                </span>
              </div>

              <ul className={styles.orderItems}>
                {o.items.map((it) => (
                  <li key={it.id}>
                    <span>
                      <strong>{it.quantity}×</strong> {it.dishName.ro}
                      {it.note ? <em className={styles.orderNote}> — {it.note}</em> : null}
                    </span>
                    <span className={styles.tabular}>{formatPrice(it.lineTotalMinor)}</span>
                  </li>
                ))}
              </ul>

              <div className={styles.orderFoot}>
                <span className={styles.orderTotal}>{formatPrice(o.totalMinor)}</span>
                {readOnly ? null : (
                  <div className={styles.orderActions}>
                    {o.status === "submitted" ? (
                      <button
                        type="button"
                        className="btn btn--sm"
                        disabled={busyId === o.id}
                        onClick={() => void act(o.id, acceptOrder)}
                      >
                        Acceptă
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn--gold btn--sm"
                      disabled={busyId === o.id}
                      onClick={() => void act(o.id, serveOrder)}
                    >
                      Marchează servită
                    </button>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
