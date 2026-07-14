"use client";

import type { GuestMenu, GuestOrder, GuestSession } from "@boca/contracts";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchMenu, formatLei, TENANT_SLUG } from "@/lib/menu";
import {
  listOrders,
  placeOrder,
  serviceRequest,
  startSession,
  STATUS_RO,
  storedToken,
} from "@/lib/order";
import styles from "./table.module.css";

type Lang = "ro" | "en";
type Cart = Record<string, number>; // dishId -> quantity

export default function TableOrderPage() {
  const params = useParams<{ slug: string }>();
  const qrSlug = params.slug;

  const [session, setSession] = useState<GuestSession | null>(null);
  const [menu, setMenu] = useState<GuestMenu | null>(null);
  const [orders, setOrders] = useState<GuestOrder[]>([]);
  const [cart, setCart] = useState<Cart>({});
  const [lang, setLang] = useState<Lang>("ro");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const token = session?.token ?? (typeof window !== "undefined" ? storedToken(qrSlug) : null);

  const refreshOrders = useCallback(async (tok: string) => {
    try {
      setOrders(await listOrders(tok));
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [ses, m] = await Promise.all([startSession(qrSlug), fetchMenu(TENANT_SLUG)]);
        if (cancelled) return;
        setSession(ses);
        setMenu(m);
        void refreshOrders(ses.token);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Nu am putut deschide masa.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [qrSlug, refreshOrders]);

  const dishById = useMemo(() => {
    const map = new Map<string, { name: { ro: string; en: string }; priceMinor: number }>();
    for (const c of menu?.categories ?? [])
      for (const d of c.dishes) map.set(d.id, { name: d.name, priceMinor: d.priceMinor });
    return map;
  }, [menu]);

  const cartLines = Object.entries(cart).filter(([, q]) => q > 0);
  const cartCount = cartLines.reduce((n, [, q]) => n + q, 0);
  const cartTotal = cartLines.reduce(
    (sum, [id, q]) => sum + (dishById.get(id)?.priceMinor ?? 0) * q,
    0,
  );

  function setQty(dishId: string, qty: number) {
    setCart((prev) => ({ ...prev, [dishId]: Math.max(0, qty) }));
  }

  async function submit() {
    if (!token || cartLines.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await placeOrder(token, {
        items: cartLines.map(([dishId, quantity]) => ({ dishId, quantity })),
      });
      setCart({});
      setCartOpen(false);
      setNotice("Comanda a fost trimisă către bucătărie.");
      await refreshOrders(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nu am putut trimite comanda.");
    } finally {
      setSubmitting(false);
    }
  }

  async function callService(kind: "call_waiter" | "request_bill") {
    if (!token) return;
    setError(null);
    try {
      await serviceRequest(token, kind);
      setNotice(kind === "call_waiter" ? "Ospătarul a fost anunțat." : "Nota a fost solicitată.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cererea nu a putut fi trimisă.");
    }
  }

  if (error && !menu) {
    return <p className={styles.center}>{error}</p>;
  }
  if (!menu || !session) {
    return <p className={styles.center}>Se deschide masa…</p>;
  }

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.table}>
          <span className={styles.tableEmoji} aria-hidden>
            {session.guest.emoji}
          </span>
          <div>
            <div className={styles.tableLabel}>{session.tableLabel}</div>
            <div className={styles.tableSub}>{session.guest.displayName}</div>
          </div>
        </div>
        <div className={styles.langToggle} role="group" aria-label="Limbă">
          {(["ro", "en"] as const).map((l) => (
            <button
              key={l}
              type="button"
              className={lang === l ? styles.langOn : ""}
              onClick={() => setLang(l)}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      <div className={styles.service}>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => callService("call_waiter")}
        >
          Cheamă ospătarul
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => callService("request_bill")}
        >
          Cere nota
        </button>
      </div>

      {notice ? (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className={styles.err} role="alert">
          {error}
        </p>
      ) : null}

      {orders.length > 0 ? (
        <section className={styles.orders}>
          <h2>Comenzile mele</h2>
          {orders.map((o) => (
            <div key={o.id} className={styles.orderCard}>
              <div className={styles.orderHead}>
                <span className={`chip chip--gold`}>{STATUS_RO[o.status] ?? o.status}</span>
                <span className={styles.orderTotal}>{formatLei(o.totalMinor)}</span>
              </div>
              <ul>
                {o.items.map((it) => (
                  <li key={it.id}>
                    <span>
                      {it.quantity}× {it.name[lang] || it.name.ro}
                    </span>
                    <span className={styles.itemStatus}>{STATUS_RO[it.status] ?? it.status}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ) : null}

      <main className={styles.menu}>
        {menu.categories.map((cat) => (
          <section key={cat.id} className={styles.category}>
            <h2 className={styles.catTitle}>{cat.name[lang] || cat.name.ro}</h2>
            {cat.dishes.map((dish) => {
              const qty = cart[dish.id] ?? 0;
              return (
                <div key={dish.id} className={styles.dish}>
                  {dish.heroPhotoUrl ? (
                    // biome-ignore lint/performance/noImgElement: presigned URL, not next/image
                    <img className={styles.thumb} src={dish.heroPhotoUrl} alt="" loading="lazy" />
                  ) : (
                    <div className={`${styles.thumb} ${styles.thumbEmpty}`} aria-hidden />
                  )}
                  <div className={styles.dishBody}>
                    <div className={styles.dishName}>{dish.name[lang] || dish.name.ro}</div>
                    {dish.description ? (
                      <p className={styles.desc}>{dish.description[lang] || dish.description.ro}</p>
                    ) : null}
                    <div className={styles.dishFoot}>
                      <span className={styles.price}>{formatLei(dish.priceMinor)}</span>
                      {qty === 0 ? (
                        <button
                          type="button"
                          className={styles.add}
                          onClick={() => setQty(dish.id, 1)}
                        >
                          + Adaugă
                        </button>
                      ) : (
                        <div className={styles.stepper}>
                          <button
                            type="button"
                            onClick={() => setQty(dish.id, qty - 1)}
                            aria-label="Scade"
                          >
                            −
                          </button>
                          <span>{qty}</span>
                          <button
                            type="button"
                            onClick={() => setQty(dish.id, qty + 1)}
                            aria-label="Adaugă"
                          >
                            +
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </section>
        ))}
      </main>

      {cartCount > 0 ? (
        <button type="button" className={styles.cartBar} onClick={() => setCartOpen(true)}>
          <span>
            {cartCount} {cartCount === 1 ? "produs" : "produse"}
          </span>
          <span>Vezi comanda · {formatLei(cartTotal)}</span>
        </button>
      ) : null}

      {cartOpen ? (
        <div className={styles.sheet} role="dialog" aria-modal="true">
          <div className={styles.sheetInner}>
            <div className={styles.sheetHead}>
              <h2>Comanda ta</h2>
              <button
                type="button"
                className={styles.close}
                onClick={() => setCartOpen(false)}
                aria-label="Închide"
              >
                ✕
              </button>
            </div>
            <ul className={styles.cartList}>
              {cartLines.map(([id, q]) => {
                const d = dishById.get(id);
                return (
                  <li key={id}>
                    <span>
                      {q}× {d?.name[lang] || d?.name.ro}
                    </span>
                    <span>{formatLei((d?.priceMinor ?? 0) * q)}</span>
                  </li>
                );
              })}
            </ul>
            <div className={styles.cartTotalRow}>
              <span>Total</span>
              <span>{formatLei(cartTotal)}</span>
            </div>
            <button
              type="button"
              className="btn btn--gold btn--block"
              disabled={submitting}
              onClick={submit}
            >
              {submitting ? "Se trimite…" : "Trimite comanda"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
