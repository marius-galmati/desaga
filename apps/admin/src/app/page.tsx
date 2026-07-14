"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { MenuPanel } from "@/components/panels/menu-panel";
import { OrdersPanel } from "@/components/panels/orders-panel";
import { PhotosPanel } from "@/components/panels/photos-panel";
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
  | "meniu"
  | "fotografii"
  | "referinte"
  | "tolerante"
  | "utilizatori"
  | "setari";

const NAV: { key: NavKey; label: string }[] = [
  { key: "comenzi", label: "Comenzi" },
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

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <Wordmark />
        </div>

        <nav className={styles.nav} aria-label="Secțiuni administrare">
          <span className={`eyebrow eyebrow--ink ${styles.navHeading}`}>Secțiuni</span>
          {NAV.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`${styles.navItem} ${nav === item.key ? styles.navItemActive : ""}`}
              aria-current={nav === item.key ? "page" : undefined}
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
        {nav === "comenzi" && <OrdersPanel />}
        {nav === "meniu" && <MenuPanel />}
        {nav === "fotografii" && <PhotosPanel />}
        {nav === "referinte" && <ReferencesPanel />}
        {nav === "tolerante" && <TolerancesPanel />}
        {nav === "utilizatori" && <UsersPanel />}
        {nav === "setari" && <SettingsPanel />}
      </main>
    </div>
  );
}
