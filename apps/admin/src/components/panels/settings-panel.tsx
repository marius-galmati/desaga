"use client";

import type { AdminSettings, AdminSettingsLocation, AdminStation } from "@boca/contracts";
import { type FormEvent, useEffect, useState } from "react";
import { createStation, getSettings, updateLocation, updateStation, updateTenant } from "@/lib/api";
import styles from "./panels.module.css";

export function SettingsPanel() {
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSettings()
      .then((s) => {
        if (!cancelled) setSettings(s);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Nu am putut încărca setările.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function flash(message: string) {
    setOk(message);
    setError(null);
    setTimeout(() => setOk(null), 2500);
  }

  if (loading) return <div className={styles.state}>Se încarcă setările…</div>;
  if (!settings) return <div className={`${styles.state} ${styles.stateError}`}>{error}</div>;

  return (
    <div>
      <div className={styles.head}>
        <div>
          <span className="eyebrow eyebrow--ink">Cont · locații</span>
          <h1>Setări</h1>
          <p className={styles.intro}>Datele restaurantului, locațiile și stațiile de bucătărie.</p>
        </div>
      </div>

      {error ? (
        <p className="form-error" style={{ marginBottom: 18 }}>
          {error}
        </p>
      ) : null}
      {ok ? (
        <p className="form-ok" style={{ marginBottom: 18 }}>
          {ok}
        </p>
      ) : null}

      <TenantBlock
        settings={settings}
        onSaved={(s) => {
          setSettings(s);
          flash("Datele restaurantului au fost salvate.");
        }}
        onError={setError}
      />

      <h3 style={{ margin: "24px 0 12px" }}>Locații</h3>
      {settings.locations.map((loc) => (
        <LocationBlock
          key={loc.id}
          location={loc}
          onSaved={(s) => {
            setSettings(s);
            flash("Locația a fost salvată.");
          }}
          onError={setError}
        />
      ))}

      <h3 style={{ margin: "24px 0 12px" }}>Stații de bucătărie</h3>
      {settings.stations.map((st) => (
        <StationBlock
          key={st.id}
          station={st}
          onSaved={() => flash("Stația a fost salvată.")}
          onError={setError}
        />
      ))}
      <AddStationForm
        onCreated={async () => {
          const s = await getSettings();
          setSettings(s);
          flash("Stația a fost adăugată.");
        }}
        onError={setError}
      />
    </div>
  );
}

function TenantBlock({
  settings,
  onSaved,
  onError,
}: {
  settings: AdminSettings;
  onSaved: (s: AdminSettings) => void;
  onError: (m: string) => void;
}) {
  const [name, setName] = useState(settings.tenant.name);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      onSaved(await updateTenant({ name: name.trim() }));
    } catch (err) {
      onError(err instanceof Error ? err.message : "Nu am putut salva.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={`card ${styles.block}`} onSubmit={onSubmit}>
      <h3 style={{ marginBottom: 16 }}>Restaurant</h3>
      <div className={styles.formGrid}>
        <label className="field">
          <span className="field-label">Denumire</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span className="field-label">Identificator (slug)</span>
          <input className="input" value={settings.tenant.slug} disabled />
        </label>
      </div>
      <div className={styles.formActions}>
        <button type="submit" className="btn btn--sm" disabled={busy}>
          {busy ? "Se salvează…" : "Salvează"}
        </button>
      </div>
    </form>
  );
}

function LocationBlock({
  location,
  onSaved,
  onError,
}: {
  location: AdminSettingsLocation;
  onSaved: (s: AdminSettings) => void;
  onError: (m: string) => void;
}) {
  const [name, setName] = useState(location.name);
  const [timezone, setTimezone] = useState(location.timezone);
  const [address, setAddress] = useState(location.address ?? "");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      onSaved(
        await updateLocation(location.id, {
          name: name.trim(),
          timezone: timezone.trim(),
          address: address.trim() === "" ? null : address.trim(),
        }),
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : "Nu am putut salva locația.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={`card ${styles.block}`} onSubmit={onSubmit}>
      <div className={styles.formGrid}>
        <label className="field">
          <span className="field-label">Nume locație</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span className="field-label">Fus orar</span>
          <input
            className="input"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            required
          />
        </label>
        <label className={`field ${styles.formGridFull}`}>
          <span className="field-label">Adresă</span>
          <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
        </label>
      </div>
      <div className={styles.formActions}>
        <button type="submit" className="btn btn--sm" disabled={busy}>
          {busy ? "Se salvează…" : "Salvează locația"}
        </button>
      </div>
    </form>
  );
}

function StationBlock({
  station,
  onSaved,
  onError,
}: {
  station: AdminStation;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const [code, setCode] = useState(station.code);
  const [ro, setRo] = useState(station.name.ro);
  const [en, setEn] = useState(station.name.en);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      await updateStation(station.id, {
        code: code.trim(),
        name: { ro: ro.trim(), en: en.trim() },
      });
      onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Nu am putut salva stația.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={`card ${styles.block}`} onSubmit={onSubmit}>
      <div className={styles.formGrid}>
        <label className="field">
          <span className="field-label">Cod</span>
          <input
            className="input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span className="field-label">Nume (RO)</span>
          <input className="input" value={ro} onChange={(e) => setRo(e.target.value)} required />
        </label>
        <label className="field">
          <span className="field-label">Nume (EN)</span>
          <input className="input" value={en} onChange={(e) => setEn(e.target.value)} />
        </label>
      </div>
      <div className={styles.formActions}>
        <button type="submit" className="btn btn--sm" disabled={busy}>
          {busy ? "Se salvează…" : "Salvează stația"}
        </button>
      </div>
    </form>
  );
}

function AddStationForm({
  onCreated,
  onError,
}: {
  onCreated: () => void;
  onError: (m: string) => void;
}) {
  const [code, setCode] = useState("");
  const [ro, setRo] = useState("");
  const [en, setEn] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      await createStation({ code: code.trim(), name: { ro: ro.trim(), en: en.trim() } });
      setCode("");
      setRo("");
      setEn("");
      onCreated();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Nu am putut adăuga stația.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={`card ${styles.block}`} onSubmit={onSubmit}>
      <h3 style={{ marginBottom: 16 }}>Adaugă stație</h3>
      <div className={styles.formGrid}>
        <label className="field">
          <span className="field-label">Cod</span>
          <input
            className="input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="grill"
            required
          />
        </label>
        <label className="field">
          <span className="field-label">Nume (RO)</span>
          <input className="input" value={ro} onChange={(e) => setRo(e.target.value)} required />
        </label>
        <label className="field">
          <span className="field-label">Nume (EN)</span>
          <input className="input" value={en} onChange={(e) => setEn(e.target.value)} />
        </label>
      </div>
      <div className={styles.formActions}>
        <button type="submit" className="btn btn--sm" disabled={busy}>
          {busy ? "Se adaugă…" : "Adaugă stația"}
        </button>
      </div>
    </form>
  );
}
