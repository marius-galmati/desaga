"use client";

import type { AdminOrder, AdminTable } from "@boca/contracts";
import { useCallback, useEffect, useState } from "react";
import { acceptOrder, closeTable, listOrders, listTables, serveOrder } from "@/lib/api";
import { formatPrice } from "@/lib/format";
import styles from "./sala-view.module.css";

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
  return mins === 1 ? "acum 1 min" : `acum ${mins} min`;
}

/** Waiter floor view: live orders (accept/serve) + tables (clear a finished tab). */
export function SalaView() {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [tables, setTables] = useState<AdminTable[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [o, t] = await Promise.all([listOrders(), listTables()]);
      setOrders(o);
      setTables(t);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nu am putut încărca sala.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 8000);
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

  async function onClear(t: AdminTable) {
    if (!window.confirm(`Eliberezi ${t.label}? Următorul client pornește o comandă nouă.`)) return;
    await act(t.id, closeTable);
  }

  return (
    <div className={styles.wrap}>
      {error ? (
        <p className={styles.err} role="alert">
          {error}
        </p>
      ) : null}

      <section>
        <h2 className={styles.h2}>Comenzi</h2>
        {loading ? (
          <p className={styles.state}>Se încarcă…</p>
        ) : orders.length === 0 ? (
          <p className={styles.state}>Nicio comandă activă.</p>
        ) : (
          <div className={styles.orders}>
            {orders.map((o) => (
              <article key={o.id} className={styles.orderCard}>
                <div className={styles.orderTop}>
                  <div className={styles.orderTable}>
                    {o.guest ? <span aria-hidden>{o.guest.emoji} </span> : null}
                    {o.tableLabel}
                    <span className={styles.orderMeta}>
                      {" · "}
                      {elapsed(o.createdAt)}
                      {o.isFirstOfSession ? " · prima comandă" : ""}
                    </span>
                  </div>
                  <span
                    className={`chip ${o.status === "submitted" ? "chip--gold" : "chip--pine"}`}
                  >
                    {STATUS_LABEL[o.status] ?? o.status}
                  </span>
                </div>
                <ul className={styles.items}>
                  {o.items.map((it) => (
                    <li key={it.id}>
                      <span>
                        <strong>{it.quantity}×</strong> {it.dishName.ro}
                        {it.note ? <em className={styles.note}> — {it.note}</em> : null}
                      </span>
                      <span>{formatPrice(it.lineTotalMinor)}</span>
                    </li>
                  ))}
                </ul>
                <div className={styles.orderFoot}>
                  <span className={styles.total}>{formatPrice(o.totalMinor)}</span>
                  <div className={styles.actions}>
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
                      Servită
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className={styles.tablesSection}>
        <h2 className={styles.h2}>Mese</h2>
        {tables.length === 0 ? (
          <p className={styles.state}>Nicio masă configurată.</p>
        ) : (
          <div className={styles.tables}>
            {tables.map((t) => (
              <div key={t.id} className={`${styles.tableChip} ${t.occupied ? styles.occ : ""}`}>
                <span className={styles.tableLabel}>{t.label}</span>
                <span className={styles.tableState}>{t.occupied ? "Ocupată" : "Liberă"}</span>
                {t.occupied ? (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={busyId === t.id}
                    onClick={() => void onClear(t)}
                  >
                    Eliberează
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
