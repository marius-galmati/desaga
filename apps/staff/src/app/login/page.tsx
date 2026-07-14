"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
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
          <span className={styles.brandName}>Desaga</span>
        </div>
        <p className="eyebrow" style={{ marginTop: 22 }}>
          Panou de administrare
        </p>
        <h1 className={styles.title}>No, zîua bună!</h1>
        <p className={styles.lede}>
          Autentifică-te pentru a administra meniul, fotografiile și standardele AI ale
          restaurantului.
        </p>

        <form className={styles.form} onSubmit={onSubmit}>
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
