"use client";

import type { BrandColorKey, BrandColors, PlatformAdmin, PlatformTenant } from "@boca/contracts";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  addDomain,
  clearToken,
  createTenant,
  deleteDomain,
  listTenants,
  login,
  PlatformUnauthorizedError,
  storedToken,
  updateBranding,
} from "@/lib/api";
import { Emblem } from "@/lib/emblem";
import styles from "./page.module.css";

const SURFACE_LABEL: Record<string, string> = { guest: "Guest", admin: "Admin", staff: "Staff" };

const DEFAULT_COLORS: Record<BrandColorKey, string> = {
  vin: "#7a2231",
  "vin-deep": "#5e1824",
  "vin-wash": "#f0dcd8",
  ochre: "#b8791e",
  "ochre-soft": "#d9a441",
  "ochre-wash": "#f4e6c9",
  pine: "#33502f",
  "pine-soft": "#4d6f45",
  "pine-wash": "#dde5d3",
};

const COLOR_GROUPS: { title: string; keys: { key: BrandColorKey; label: string }[] }[] = [
  {
    title: "Accent principal",
    keys: [
      { key: "vin", label: "Bază" },
      { key: "vin-deep", label: "Intens" },
      { key: "vin-wash", label: "Fundal" },
    ],
  },
  {
    title: "Auriu",
    keys: [
      { key: "ochre", label: "Bază" },
      { key: "ochre-soft", label: "Deschis" },
      { key: "ochre-wash", label: "Fundal" },
    ],
  },
  {
    title: "Verde",
    keys: [
      { key: "pine", label: "Bază" },
      { key: "pine-soft", label: "Deschis" },
      { key: "pine-wash", label: "Fundal" },
    ],
  },
];

export default function PlatformPage() {
  const [authed, setAuthed] = useState(false);
  const [admin, setAdmin] = useState<PlatformAdmin | null>(null);
  const [tenants, setTenants] = useState<PlatformTenant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const flash = useCallback((message: string) => {
    setOk(message);
    setError(null);
    setTimeout(() => setOk(null), 2500);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setTenants(await listTenants());
      setError(null);
    } catch (err) {
      if (err instanceof PlatformUnauthorizedError) {
        setAuthed(false);
        return;
      }
      setError(err instanceof Error ? err.message : "Nu am putut încărca restaurantele.");
    }
  }, []);

  useEffect(() => {
    if (storedToken()) {
      setAuthed(true);
    }
  }, []);

  useEffect(() => {
    if (authed) void refresh();
  }, [authed, refresh]);

  function onLogout() {
    clearToken();
    setAuthed(false);
    setAdmin(null);
    setTenants(null);
  }

  if (!authed) {
    return (
      <LoginCard
        onLoggedIn={(a) => {
          setAdmin(a);
          setAuthed(true);
        }}
      />
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <div>
          <span className="eyebrow">Platformă · super-admin</span>
          <h1 className={styles.topTitle}>Restaurante</h1>
        </div>
        <div className={styles.topMeta}>
          {admin ? <span>{admin.email}</span> : null}
          <button type="button" className="btn btn--ghost btn--sm" onClick={onLogout}>
            Deconectare
          </button>
        </div>
      </header>

      {error ? (
        <p className="form-error" style={{ marginTop: 12 }}>
          {error}
        </p>
      ) : null}
      {ok ? (
        <p className="form-ok" style={{ marginTop: 12 }}>
          {ok}
        </p>
      ) : null}

      <section className={styles.section}>
        <CreateTenantCard
          onCreated={async () => {
            await refresh();
            flash("Restaurantul a fost creat.");
          }}
          onError={setError}
        />
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <span className="eyebrow eyebrow--ink">Restaurante înrolate</span>
        </div>
        {tenants === null ? (
          <div className={styles.state}>Se încarcă…</div>
        ) : tenants.length === 0 ? (
          <div className={`card ${styles.state}`}>Niciun restaurant încă.</div>
        ) : (
          <div className={styles.tenantList}>
            {tenants.map((t) => (
              <TenantCard
                key={t.id}
                tenant={t}
                onChanged={refresh}
                onFlash={flash}
                onError={setError}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function LoginCard({ onLoggedIn }: { onLoggedIn: (admin: PlatformAdmin) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await login(email, password);
      onLoggedIn(res.admin);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Autentificarea a eșuat.");
      setBusy(false);
    }
  }

  return (
    <div className={styles.loginWrap}>
      <section className={`card ${styles.loginCard}`}>
        <div className={styles.loginBrand}>
          <Emblem size={36} tone="var(--ochre)" />
          <span className="eyebrow">Platformă</span>
        </div>
        <h1 className={styles.loginTitle}>Administrarea platformei</h1>
        <p className="faint" style={{ fontSize: "0.88rem" }}>
          Doar operatorii platformei. Accesul e jurnalizat.
        </p>
        <form className={styles.loginForm} onSubmit={onSubmit}>
          <label className="field">
            <span className="field-label">Email</span>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label className="field">
            <span className="field-label">Parolă</span>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <button type="submit" className="btn btn--block" disabled={busy}>
            {busy ? "Se autentifică…" : "Intră"}
          </button>
        </form>
      </section>
    </div>
  );
}

function CreateTenantCard({
  onCreated,
  onError,
}: {
  onCreated: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [guestDomain, setGuestDomain] = useState("");
  const [adminDomain, setAdminDomain] = useState("");
  const [staffDomain, setStaffDomain] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      await createTenant({
        slug: slug.trim().toLowerCase(),
        name: name.trim(),
        adminEmail: adminEmail.trim(),
        adminPassword,
        domains: {
          ...(guestDomain.trim() ? { guest: guestDomain.trim().toLowerCase() } : {}),
          ...(adminDomain.trim() ? { admin: adminDomain.trim().toLowerCase() } : {}),
          ...(staffDomain.trim() ? { staff: staffDomain.trim().toLowerCase() } : {}),
        },
      });
      setSlug("");
      setName("");
      setAdminEmail("");
      setAdminPassword("");
      setGuestDomain("");
      setAdminDomain("");
      setStaffDomain("");
      setOpen(false);
      await onCreated();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Crearea a eșuat.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn btn--gold" onClick={() => setOpen(true)}>
        + Adaugă restaurant
      </button>
    );
  }

  return (
    <form className={`card ${styles.block}`} onSubmit={onSubmit}>
      <h3 style={{ marginBottom: 14 }}>Restaurant nou</h3>
      <div className={styles.formGrid}>
        <label className="field">
          <span className="field-label">Identificator (slug)</span>
          <input
            className="input"
            value={slug}
            placeholder="ex. brandx"
            onChange={(e) => setSlug(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span className="field-label">Denumire</span>
          <input
            className="input"
            value={name}
            placeholder="ex. Restaurant Brand X"
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span className="field-label">Email admin</span>
          <input
            className="input"
            type="email"
            value={adminEmail}
            onChange={(e) => setAdminEmail(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span className="field-label">Parolă admin (min. 8)</span>
          <input
            className="input"
            type="text"
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
            minLength={8}
            required
          />
        </label>
        <label className="field">
          <span className="field-label">Domeniu guest (clienți)</span>
          <input
            className="input"
            value={guestDomain}
            placeholder="app.brandx.ro"
            onChange={(e) => setGuestDomain(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">Domeniu admin</span>
          <input
            className="input"
            value={adminDomain}
            placeholder="brandx-admin.platforma.ro"
            onChange={(e) => setAdminDomain(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">Domeniu staff</span>
          <input
            className="input"
            value={staffDomain}
            placeholder="brandx-staff.platforma.ro"
            onChange={(e) => setStaffDomain(e.target.value)}
          />
        </label>
      </div>
      <p className="faint" style={{ marginTop: 12, fontSize: "0.82rem" }}>
        Nu uita: aceleași domenii trebuie adăugate și în Dokploy (serviciile guest/admin/staff) și
        în DNS. Vezi runbook-ul docs/onboarding-brand.md.
      </p>
      <div className={styles.formActions}>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(false)}>
          Renunță
        </button>
        <button type="submit" className="btn btn--gold btn--sm" disabled={busy}>
          {busy ? "Se creează…" : "Creează restaurantul"}
        </button>
      </div>
    </form>
  );
}

function TenantCard({
  tenant,
  onChanged,
  onFlash,
  onError,
}: {
  tenant: PlatformTenant;
  onChanged: () => Promise<void>;
  onFlash: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [newDomain, setNewDomain] = useState("");
  const [newSurface, setNewSurface] = useState<"guest" | "admin" | "staff">("guest");
  const [busy, setBusy] = useState(false);
  const [editBranding, setEditBranding] = useState(false);

  async function onAddDomain() {
    if (!newDomain.trim()) return;
    setBusy(true);
    try {
      await addDomain(tenant.id, {
        domain: newDomain.trim().toLowerCase(),
        surface: newSurface,
      });
      setNewDomain("");
      await onChanged();
      onFlash("Domeniul a fost adăugat.");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Adăugarea a eșuat.");
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteDomain(id: string, domain: string) {
    if (!window.confirm(`Ștergi domeniul ${domain}? Rutarea lui va înceta imediat.`)) return;
    try {
      await deleteDomain(id);
      await onChanged();
      onFlash("Domeniul a fost șters.");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Ștergerea a eșuat.");
    }
  }

  return (
    <article className={`card ${styles.tenantCard}`}>
      <div className={styles.tenantHead}>
        <div>
          <span className={styles.tenantName}>{tenant.name}</span>{" "}
          <span className="chip chip--gold">{tenant.slug}</span>
          {tenant.archivedAt ? <span className="chip chip--vin">arhivat</span> : null}
        </div>
        <span className={styles.tenantMeta}>
          din {new Date(tenant.createdAt).toLocaleDateString("ro-RO")}
        </span>
      </div>

      <div className={styles.domains}>
        {tenant.domains.length === 0 ? (
          <span className="faint" style={{ fontSize: "0.86rem" }}>
            Niciun domeniu înregistrat — aplicațiile nu pot rezolva acest brand.
          </span>
        ) : (
          tenant.domains.map((d) => (
            <div key={d.id} className={styles.domainRow}>
              <span className={styles.domainSurface}>{SURFACE_LABEL[d.surface] ?? d.surface}</span>
              <span className={styles.domainName}>{d.domain}</span>
              {d.isPrimary ? <span className="chip chip--pine">principal</span> : null}
              <button
                type="button"
                className={styles.domainDel}
                aria-label={`Șterge ${d.domain}`}
                onClick={() => void onDeleteDomain(d.id, d.domain)}
              >
                ✕
              </button>
            </div>
          ))
        )}
        <div className={styles.addDomain}>
          <input
            className="input"
            value={newDomain}
            placeholder="ex. app.brandx.ro"
            onChange={(e) => setNewDomain(e.target.value)}
          />
          <select
            className="select"
            value={newSurface}
            onChange={(e) => setNewSurface(e.target.value as "guest" | "admin" | "staff")}
          >
            <option value="guest">Guest</option>
            <option value="admin">Admin</option>
            <option value="staff">Staff</option>
          </select>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={busy || !newDomain.trim()}
            onClick={() => void onAddDomain()}
          >
            Adaugă domeniu
          </button>
        </div>
      </div>

      <div className={styles.brandingToggle}>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => setEditBranding((v) => !v)}
        >
          {editBranding ? "Închide identitatea" : "Identitate brand"}
        </button>
      </div>
      {editBranding ? (
        <BrandingEditor tenant={tenant} onSaved={onChanged} onFlash={onFlash} onError={onError} />
      ) : null}
    </article>
  );
}

function BrandingEditor({
  tenant,
  onSaved,
  onFlash,
  onError,
}: {
  tenant: PlatformTenant;
  onSaved: () => Promise<void>;
  onFlash: (m: string) => void;
  onError: (m: string) => void;
}) {
  const b = tenant.branding;
  const [displayName, setDisplayName] = useState(b?.displayName ?? "");
  const [tagline, setTagline] = useState(b?.tagline ?? "");
  const [greeting, setGreeting] = useState(b?.greeting ?? "");
  const [promise, setPromise] = useState(b?.promise ?? "");
  const [locationsText, setLocationsText] = useState((b?.locations ?? []).join(", "));
  const [colors, setColors] = useState<BrandColors>(b?.colors ?? {});
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      const norm = (v: string) => (v.trim() === "" ? null : v.trim());
      await updateBranding(tenant.id, {
        displayName: norm(displayName),
        tagline: norm(tagline),
        greeting: norm(greeting),
        promise: norm(promise),
        locations: locationsText
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 6),
        colors,
      });
      await onSaved();
      onFlash("Identitatea a fost salvată.");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Salvarea a eșuat.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.branding} onSubmit={onSubmit}>
      {b?.hasLogo ? (
        <p className="faint" style={{ fontSize: "0.8rem", margin: 0 }}>
          Logo-ul e gestionat de restaurant din panoul lui de administrare.
        </p>
      ) : null}
      <div className={styles.formGrid}>
        <label className="field">
          <span className="field-label">Nume scurt</span>
          <input
            className="input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">Slogan</span>
          <input className="input" value={tagline} onChange={(e) => setTagline(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Salut</span>
          <input className="input" value={greeting} onChange={(e) => setGreeting(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Orașe (virgulă)</span>
          <input
            className="input"
            value={locationsText}
            onChange={(e) => setLocationsText(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">Promisiunea</span>
          <input className="input" value={promise} onChange={(e) => setPromise(e.target.value)} />
        </label>
      </div>

      <div className={styles.colorGroups}>
        {COLOR_GROUPS.map((group) => (
          <div key={group.title} className={styles.colorGroup}>
            <span className={styles.colorGroupTitle}>{group.title}</span>
            <div className={styles.colorRow}>
              {group.keys.map(({ key, label }) => (
                <label key={key} className={styles.colorPick}>
                  <input
                    type="color"
                    value={colors[key] ?? DEFAULT_COLORS[key]}
                    onChange={(e) => setColors((c) => ({ ...c, [key]: e.target.value }))}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className={styles.formActions}>
        {Object.keys(colors).length > 0 ? (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setColors({})}>
            Culori standard
          </button>
        ) : null}
        <button type="submit" className="btn btn--sm" disabled={busy}>
          {busy ? "Se salvează…" : "Salvează identitatea"}
        </button>
      </div>
    </form>
  );
}
