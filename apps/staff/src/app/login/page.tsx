"use client";

import { hostTenantSchema } from "@boca/contracts";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { Emblem } from "@/design/emblem";
import { login } from "@/lib/auth";
import styles from "./login.module.css";

export default function LoginPage() {
  const router = useRouter();
  const [tenantSlug, setTenantSlug] = useState("desaga");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Multi-domain: when this hostname is registered to a tenant, the slug is
  // resolved automatically and the field hidden; unknown hosts (local dev)
  // keep the manual field.
  const [resolvedName, setResolvedName] = useState<string | null>(null);
  const [resolvedGreeting, setResolvedGreeting] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/guest/tenant-context")
      .then((r) => (r.ok ? r.json() : null))
      .then((raw) => {
        if (cancelled || !raw) return;
        const ctx = hostTenantSchema.parse(raw);
        setTenantSlug(ctx.tenantSlug);
        setResolvedName(ctx.branding.displayName ?? ctx.tenantName);
        setResolvedGreeting(ctx.branding.greeting);
      })
      .catch(() => {
        /* unresolved host — manual slug stays */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login({ tenantSlug, email, password });
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Autentificarea a eșuat.");
      setBusy(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <section className={`card ${styles.panel}`}>
        <div className={styles.brand}>
          <Emblem size={40} tone="var(--ochre)" />
          <span className={styles.brandName}>{resolvedName ?? "Desaga"}</span>
        </div>
        <p className="eyebrow" style={{ marginTop: 22 }}>
          Panou de administrare
        </p>
        <h1 className={styles.title}>
          {resolvedName === null ? "No, zîua bună!" : (resolvedGreeting ?? "Bine ați venit!")}
        </h1>
        <p className={styles.lede}>
          Autentifică-te pentru a administra meniul, fotografiile și standardele AI ale
          restaurantului.
        </p>

        <form className={styles.form} onSubmit={onSubmit}>
          {resolvedName === null ? (
            <div className="field">
              <label className="field-label" htmlFor="tenant">
                Restaurant
              </label>
              <input
                id="tenant"
                className="input"
                value={tenantSlug}
                onChange={(e) => setTenantSlug(e.target.value)}
                autoComplete="organization"
                required
              />
            </div>
          ) : null}
          <div className="field">
            <label className="field-label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              placeholder="admin@desaga.ro"
              required
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="password">
              Parolă
            </label>
            <input
              id="password"
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          {error ? <p className="form-error">{error}</p> : null}

          <button className="btn btn--block" type="submit" disabled={busy}>
            {busy ? "Se autentifică…" : "Intră în cont"}
          </button>
        </form>
      </section>
    </div>
  );
}
