"use client";

import type { AdminSettingsLocation, AdminUser, UserRole } from "@boca/contracts";
import { type FormEvent, useEffect, useState } from "react";
import { createUser, deactivateUser, getSettings, listUsers } from "@/lib/api";
import styles from "./panels.module.css";

const ROLES: { key: UserRole; label: string }[] = [
  { key: "tenant_admin", label: "Administrator" },
  { key: "manager", label: "Manager locație" },
  { key: "waiter", label: "Ospătar" },
  { key: "kitchen_pass", label: "Bucătar la pass" },
  { key: "management_viewer", label: "Vizualizare management" },
];

const ROLE_LABEL: Record<string, string> = Object.fromEntries(ROLES.map((r) => [r.key, r.label]));

export function UsersPanel() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [locations, setLocations] = useState<AdminSettingsLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function refresh() {
    setError(null);
    try {
      const [u, s] = await Promise.all([listUsers(), getSettings()]);
      setUsers(u);
      setLocations(s.locations);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nu am putut încărca utilizatorii.");
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [u, s] = await Promise.all([listUsers(), getSettings()]);
        if (cancelled) return;
        setUsers(u);
        setLocations(s.locations);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Nu am putut încărca utilizatorii.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onDeactivate(id: string) {
    setError(null);
    try {
      await deactivateUser(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nu am putut dezactiva utilizatorul.");
    }
  }

  return (
    <div>
      <div className={styles.head}>
        <div>
          <span className="eyebrow eyebrow--ink">Echipă · acces</span>
          <h1>Utilizatori</h1>
          <p className={styles.intro}>
            Conturile echipei și rolurile lor. Administratorii pot crea utilizatori noi și îi pot
            dezactiva.
          </p>
        </div>
        <div className={styles.headActions}>
          <button
            type="button"
            className="btn btn--gold btn--sm"
            onClick={() => setAdding((v) => !v)}
          >
            + Adaugă utilizator
          </button>
        </div>
      </div>

      {adding ? (
        <AddUserForm
          locations={locations}
          onCreated={async () => {
            setAdding(false);
            await refresh();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : null}

      {error ? (
        <p className="form-error" style={{ marginBottom: 18 }}>
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className={styles.state}>Se încarcă…</div>
      ) : (
        <div className={`card ${styles.block}`}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Email</th>
                <th>Nume</th>
                <th>Rol</th>
                <th>Stare</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={u.isActive ? "" : styles.inactiveRow}>
                  <td>{u.email}</td>
                  <td>{u.fullName}</td>
                  <td>{ROLE_LABEL[u.role] ?? u.role}</td>
                  <td>
                    {u.isActive ? (
                      <span className="chip chip--pine">Activ</span>
                    ) : (
                      <span className="chip chip--vin">Inactiv</span>
                    )}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {u.isActive ? (
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => onDeactivate(u.id)}
                      >
                        Dezactivează
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="faint">
                    Niciun utilizator.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AddUserForm({
  locations,
  onCreated,
  onCancel,
}: {
  locations: AdminSettingsLocation[];
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<UserRole>("waiter");
  const [locationId, setLocationId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Parola trebuie să aibă cel puțin 8 caractere.");
      return;
    }
    setBusy(true);
    try {
      await createUser({
        email: email.trim(),
        fullName: fullName.trim(),
        role,
        password,
        ...(locationId ? { locationId } : {}),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nu am putut crea utilizatorul.");
      setBusy(false);
    }
  }

  return (
    <form className={`card ${styles.block}`} onSubmit={onSubmit} style={{ marginBottom: 22 }}>
      <h3 style={{ marginBottom: 16 }}>Utilizator nou</h3>
      <div className={styles.formGrid}>
        <label className="field">
          <span className="field-label">Email</span>
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span className="field-label">Nume complet</span>
          <input
            className="input"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span className="field-label">Rol</span>
          <select
            className="select"
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
          >
            {ROLES.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Locație (opțional)</span>
          <select
            className="select"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
          >
            <option value="">— fără —</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Parolă (min. 8 caractere)</span>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
      </div>
      {error ? (
        <p className="form-error" style={{ marginTop: 12 }}>
          {error}
        </p>
      ) : null}
      <div className={styles.formActions}>
        <button type="submit" className="btn btn--sm" disabled={busy}>
          {busy ? "Se creează…" : "Creează utilizatorul"}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel} disabled={busy}>
          Anulează
        </button>
      </div>
    </form>
  );
}
