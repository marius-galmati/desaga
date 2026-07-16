"use client";

import { hostTenantSchema } from "@boca/contracts";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PassView } from "@/components/pass-view";
import { SalaView } from "@/components/sala-view";
import { BRAND } from "@/design/brand";
import { Wordmark } from "@/design/emblem";
import { ensureSession, getCurrentUser, logout } from "@/lib/auth";
import styles from "./staff.module.css";

type Section = "sala" | "pass";

const SECTION_LABEL: Record<Section, string> = { sala: "Sală", pass: "Pass" };

const ROLE_LABEL: Record<string, string> = {
  tenant_admin: "Administrator",
  manager: "Manager locație",
  waiter: "Ospătar",
  kitchen_pass: "Bucătar la pass",
  management_viewer: "Vizualizare management",
};

// Which staff sections each role may use.
function sectionsFor(role: string | undefined): Section[] {
  if (role === "tenant_admin" || role === "manager") return ["sala", "pass"];
  if (role === "waiter") return ["sala"];
  if (role === "kitchen_pass") return ["pass"];
  return [];
}

export default function StaffApp() {
  const router = useRouter();
  const [phase, setPhase] = useState<"checking" | "ready">("checking");
  const [section, setSection] = useState<Section>("sala");
  // Multi-brand: the footer shows the resolved tenant's identity; unresolved
  // hosts keep the baked default.
  const [brandFoot, setBrandFoot] = useState<{ name: string; locations: string[] }>({
    name: BRAND.full,
    locations: [...BRAND.locations],
  });

  useEffect(() => {
    let cancelled = false;
    void ensureSession().then((ok) => {
      if (cancelled) return;
      if (ok) setPhase("ready");
      else router.replace("/login");
    });
    fetch("/api/guest/tenant-context")
      .then((r) => (r.ok ? r.json() : null))
      .then((raw) => {
        if (cancelled || !raw) return;
        const ctx = hostTenantSchema.parse(raw);
        setBrandFoot({ name: ctx.tenantName, locations: ctx.branding.locations });
      })
      .catch(() => {
        /* baked default stays */
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function onLogout() {
    await logout();
    router.replace("/login");
  }

  if (phase === "checking") {
    return <p className={styles.state}>Se încarcă…</p>;
  }

  const user = getCurrentUser();
  const sections = sectionsFor(user?.role);
  const active = sections.includes(section) ? section : (sections[0] ?? "sala");

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <Wordmark />
        <div className={styles.userBox}>
          {user ? <span className={styles.userName}>{user.fullName}</span> : null}
          <button type="button" className="btn btn--ghost btn--sm" onClick={onLogout}>
            Ieșire
          </button>
        </div>
      </header>

      {sections.length === 0 ? (
        <div className={styles.main}>
          <div className={styles.lead}>
            <span className="eyebrow eyebrow--ink">Acces restricționat</span>
            <h1>Acest cont nu are acces aici</h1>
            <p>
              Rolul „{ROLE_LABEL[user?.role ?? ""] ?? user?.role}” nu folosește aplicația de
              personal.
            </p>
          </div>
        </div>
      ) : (
        <>
          {sections.length > 1 ? (
            <div className={styles.sectionNav} role="group" aria-label="Secțiune">
              {sections.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={active === s ? styles.sectionOn : ""}
                  onClick={() => setSection(s)}
                >
                  {SECTION_LABEL[s]}
                </button>
              ))}
            </div>
          ) : null}

          {active === "sala" ? <SalaView /> : <PassView />}
        </>
      )}

      <footer className={styles.foot}>
        {[brandFoot.name, ...brandFoot.locations].join(" · ")}
      </footer>
    </div>
  );
}
