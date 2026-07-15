"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { MenuPanel } from "@/components/panels/menu-panel";
import { OrdersPanel } from "@/components/panels/orders-panel";
import { PhotosPanel } from "@/components/panels/photos-panel";
import { TablesPanel } from "@/components/panels/tables-panel";
import { ReferencesPanel } from "@/components/panels/references-panel";
import { SettingsPanel } from "@/components/panels/settings-panel";
import { TolerancesPanel } from "@/components/panels/tolerances-panel";
import { UsersPanel } from "@/components/panels/users-panel";
import { BRAND } from "@/design/brand";
import { Wordmark } from "@/design/emblem";
import { ensureSession, getCurrentUser, logout } from "@/lib/auth";
import styles from "./admin.module.css";

type NavKey =
  | "comenzi"
  | "mese"
  | "meniu"
  | "fotografii"
  | "referinte"
  | "tolerante"
  | "utilizatori"
  | "setari";

const NAV: { key: NavKey; label: string }[] = [
  { key: "comenzi", label: "Comenzi" },
  { key: "mese", label: "Mese" },
  { key: "meniu", label: "Meniu" },
  { key: "fotografii", label: "Fotografii" },
  { key: "referinte", label: "Seturi de referință" },
  { key: "tolerante", label: "Toleranțe" },
  { key: "utilizatori", label: "Utilizatori" },
  { key: "setari", label: "Setări" },
];

const ROLE_LABEL: Record<string, string> = {
  tenant_admin: "Administrator",
  manager: "Manager locație",
  waiter: "Ospătar",
  kitchen_pass: "Bucătar la pass",
  management_viewer: "Vizualizare management",
};

export default function AdminHome() {
  const router = useRouter();
  const [phase, setPhase] = useState<"checking" | "ready">("checking");
  const [nav, setNav] = useState<NavKey>("meniu");

  useEffect(() => {
    let cancelled = false;
    void ensureSession().then((ok) => {
      if (cancelled) return;
      if (ok) setPhase("ready");
      else router.replace("/login");
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (phase === "checking") {
    return (
      <div className={styles.boot}>
        <p className="eyebrow">Se încarcă…</p>
      </div>
    );
  }

  const user = getCurrentUser();

  async function onLogout() {
    await logout();
    router.replace("/login");
  }

  // Role-based access to the ADMIN app (back-office):
  //  - tenant_admin / manager -> everything
  //  - management_viewer       -> read-only, sees Comenzi (live floor)
  //  - waiter / kitchen_pass   -> no admin surface; they use the STAFF app
  const role = user?.role;
  const allowedNav =
    role === "tenant_admin" || role === "manager"
      ? NAV
      : role === "management_viewer"
        ? NAV.filter((n) => n.key === "comenzi")
        : [];
  const activeNav = allowedNav.some((n) => n.key === nav) ? nav : (allowedNav[0]?.key ?? "comenzi");

  if (allowedNav.length === 0) {
    const isStaff = role === "waiter" || role === "kitchen_pass";
    return (
      <div className={styles.boot}>
        <div style={{ maxWidth: 440, textAlign: "center", padding: 24 }}>
          <span className="eyebrow eyebrow--ink">Acces restricționat</span>
          <h2 style={{ fontFamily: "var(--font-display)", margin: "10px 0" }}>
            Acest cont nu are acces la administrare
          </h2>
          <p className="faint" style={{ marginBottom: 18 }}>
            Rolul „{ROLE_LABEL[role ?? ""] ?? role}” nu poate folosi panoul de administrare.
            {isStaff ? " Folosește aplicația de personal." : ""}
          </p>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onLogout}>
            Deconectare
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <Wordmark />
        </div>

        <nav className={styles.nav} aria-label="Secțiuni administrare">
          <span className={`eyebrow eyebrow--ink ${styles.navHeading}`}>Secțiuni</span>
          {allowedNav.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`${styles.navItem} ${activeNav === item.key ? styles.navItemActive : ""}`}
              aria-current={activeNav === item.key ? "page" : undefined}
              onClick={() => setNav(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className={styles.sidebarFoot}>
          {user ? (
            <div className={styles.userBox}>
              <div className={styles.userName}>{user.fullName}</div>
              <div className={styles.userMeta}>{ROLE_LABEL[user.role] ?? user.role}</div>
              <div className={styles.userMeta}>{user.email}</div>
            </div>
          ) : null}
          <button type="button" className="btn btn--ghost btn--sm btn--block" onClick={onLogout}>
            Deconectare
          </button>
          <p className={styles.brandFoot}>
            {BRAND.full}
            <br />
            {BRAND.locations.join(" · ")}
          </p>
        </div>
      </aside>

      <main className={styles.content}>
        {activeNav === "comenzi" && <OrdersPanel />}
        {activeNav === "mese" && <TablesPanel />}
        {activeNav === "meniu" && <MenuPanel />}
        {activeNav === "fotografii" && <PhotosPanel />}
        {activeNav === "referinte" && <ReferencesPanel />}
        {activeNav === "tolerante" && <TolerancesPanel />}
        {activeNav === "utilizatori" && <UsersPanel />}
        {activeNav === "setari" && <SettingsPanel />}
      </main>
    </div>
  );
}
