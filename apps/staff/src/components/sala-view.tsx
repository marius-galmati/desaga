"use client";

import type { AdminOrder, AdminServiceRequest, AdminTable } from "@boca/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  acceptOrder,
  closeTable,
  listOrders,
  listServiceRequests,
  listTables,
  resolveServiceRequest,
  serveOrder,
} from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { formatPrice } from "@/lib/format";
import s from "./floor.module.css";

type TStatus = "liber" | "ocupat" | "cere_nota" | "cheama";
const STATUS_META: Record<TStatus, { label: string; card: string; pill: string }> = {
  liber: { label: "Liber", card: s.stLiber ?? "", pill: s.pillLiber ?? "" },
  ocupat: { label: "Ocupat", card: s.stOcupat ?? "", pill: s.pillOcupat ?? "" },
  cere_nota: { label: "Cere nota", card: s.stCereNota ?? "", pill: s.pillCereNota ?? "" },
  cheama: { label: "Cheamă", card: s.stCheama ?? "", pill: s.pillCheama ?? "" },
};

function minsSince(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

export function SalaView() {
  const [tables, setTables] = useState<AdminTable[]>([]);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [requests, setRequests] = useState<AdminServiceRequest[]>([]);
  const [section, setSection] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [t, o, r] = await Promise.all([listTables(), listOrders(), listServiceRequests()]);
      setTables(t);
      setOrders(o);
      setRequests(r);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nu am putut încărca sala.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 8000);
    return () => clearInterval(t);
  }, [refresh]);

  const sections = useMemo(() => [...new Set(tables.map((t) => t.section))], [tables]);
  const activeSection = section && sections.includes(section) ? section : (sections[0] ?? null);

  const ordersByTable = useMemo(() => {
    const m = new Map<string, AdminOrder[]>();
    for (const o of orders) {
      const arr = m.get(o.tableLabel);
      if (arr) arr.push(o);
      else m.set(o.tableLabel, [o]);
    }
    return m;
  }, [orders]);

  const requestByTable = useMemo(() => {
    const m = new Map<string, AdminServiceRequest>();
    for (const r of requests) if (!m.has(r.tableLabel)) m.set(r.tableLabel, r);
    return m;
  }, [requests]);

  function statusOf(t: AdminTable): TStatus {
    const req = requestByTable.get(t.label);
    if (req?.kind === "request_bill") return "cere_nota";
    if (req?.kind === "call_waiter") return "cheama";
    return t.occupied ? "ocupat" : "liber";
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Acțiunea a eșuat.");
    } finally {
      setBusy(false);
    }
  }

  const user = getCurrentUser();
  const firstName = (user?.fullName ?? "").split(" ")[0] || "Ospătar";
  const tablesInSection = tables.filter((t) => t.section === activeSection);

  return (
    <div className={s.salaWrap}>
      <div className={s.screen}>
        <header className={s.wHead}>
          <div>
            <span className="eyebrow eyebrow--ink">Sala ta · serviciu</span>
            <h1 className={s.wTitle}>Bună, {firstName}</h1>
          </div>
          <span className={s.avatar} aria-hidden>
            {firstName.charAt(0)}
          </span>
        </header>

        {error ? <p className={s.banner + " " + s.bannerVin}>{error}</p> : null}

        {requests.length > 0 ? (
          <div className={s.banners}>
            {requests.map((r) =>
              r.kind === "call_waiter" ? (
                <div key={r.id} className={`${s.banner} ${s.bannerVin}`}>
                  <span className={s.bannerDot} aria-hidden />
                  <span className={s.bannerText}>{r.tableLabel} cheamă ospătarul</span>
                  <span className={`${s.bannerTime} tabular`}>{minsSince(r.createdAt)}′</span>
                </div>
              ) : (
                <div key={r.id} className={`${s.banner} ${s.bannerOchre}`}>
                  <span className={s.bannerText}>{r.tableLabel} cere nota</span>
                  <span className={`${s.bannerTime} tabular`}>{minsSince(r.createdAt)}′</span>
                </div>
              ),
            )}
          </div>
        ) : null}

        {sections.length > 1 ? (
          <div className={s.sections} role="tablist" aria-label="Secțiuni">
            {sections.map((sec) => (
              <button
                key={sec}
                type="button"
                role="tab"
                aria-selected={sec === activeSection}
                className={`${s.secBtn} ${sec === activeSection ? s.secBtnOn : ""}`}
                onClick={() => setSection(sec)}
              >
                {sec}
                <span className={s.secCount}>{tables.filter((t) => t.section === sec).length}</span>
              </button>
            ))}
          </div>
        ) : null}

        <div className={s.tables}>
          {tablesInSection.map((t) => {
            const st = statusOf(t);
            const meta = STATUS_META[st];
            const open = openId === t.id;
            const tOrders = ordersByTable.get(t.label) ?? [];
            const lines = tOrders.flatMap((o) => o.items);
            const total = tOrders.reduce((sum, o) => sum + o.totalMinor, 0);
            const oldest = tOrders.reduce<string | null>(
              (acc, o) => (acc && acc < o.createdAt ? acc : o.createdAt),
              null,
            );
            const req = requestByTable.get(t.label);
            const hasSubmitted = tOrders.some((o) => o.status === "submitted");
            const num = t.label.replace(/[^0-9]/g, "") || t.label.slice(0, 3);
            return (
              <div key={t.id} className={`${s.tcard} ${meta.card} ${open ? s.tcardOn : ""}`}>
                <button
                  type="button"
                  className={s.tcardBtn}
                  onClick={() => setOpenId(open ? null : t.id)}
                  aria-expanded={open}
                >
                  <span className={s.tnum}>
                    <span className={s.tnumBig}>{num}</span>
                    {t.seats != null ? <span className={s.tseats}>{t.seats} loc.</span> : null}
                  </span>
                  <span className={s.tbody}>
                    <span className={`${s.pill} ${meta.pill}`}>{meta.label}</span>
                    {st !== "liber" ? (
                      <span className={s.tmeta}>
                        <span>{tOrders.length} comenzi</span>
                        {oldest ? (
                          <>
                            <span aria-hidden>·</span>
                            <span className="tabular">acum {minsSince(oldest)}′</span>
                          </>
                        ) : null}
                      </span>
                    ) : (
                      <span className={s.tmeta}>Pregătită</span>
                    )}
                  </span>
                  <span className={s.tright}>
                    {total > 0 ? (
                      <span className={`${s.ttotal} tabular`}>{formatPrice(total)}</span>
                    ) : null}
                  </span>
                </button>

                {open && st !== "liber" ? (
                  <div className={s.detail}>
                    {lines.map((l) => (
                      <div key={l.id} className={s.oline}>
                        <span className={`${s.olQty} tabular`}>{l.quantity}×</span>
                        <span className={s.olName}>
                          {l.dishName.ro}
                          <span className={s.olCourse}>{l.status}</span>
                        </span>
                        <span className={`${s.olPrice} tabular`}>
                          {formatPrice(l.lineTotalMinor)}
                        </span>
                      </div>
                    ))}
                    <div className={s.ototal}>
                      <span>Total masă</span>
                      <span className="tabular">{formatPrice(total)}</span>
                    </div>
                    <div className={s.detailActions}>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={busy || tOrders.length === 0}
                        onClick={() =>
                          void run(async () => {
                            const targets = hasSubmitted
                              ? tOrders.filter((o) => o.status === "submitted")
                              : tOrders.filter(
                                  (o) => o.status === "submitted" || o.status === "accepted",
                                );
                            for (const o of targets) {
                              await (hasSubmitted ? acceptOrder(o.id) : serveOrder(o.id));
                            }
                          })
                        }
                      >
                        {hasSubmitted ? "Acceptă" : "Marchează servit"}
                      </button>
                      <button
                        type="button"
                        className="btn btn--gold btn--sm"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            if (req) await resolveServiceRequest(req.id);
                            if (!req || req.kind === "request_bill") await closeTable(t.id);
                          })
                        }
                      >
                        {req?.kind === "call_waiter"
                          ? "Am preluat masa"
                          : req?.kind === "request_bill"
                            ? "Închide masa"
                            : "Eliberează masa"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
          {tablesInSection.length === 0 ? (
            <p className={s.tmeta}>Nicio masă. Adaugă mese din Administrare.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
