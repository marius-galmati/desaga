"use client";

import type {
  AdminSettings,
  AdminSettingsLocation,
  AdminStation,
  BrandColorKey,
  BrandColors,
} from "@boca/contracts";
import { type FormEvent, useEffect, useState } from "react";
import {
  createStation,
  getSettings,
  updateBranding,
  updateLocation,
  updateStation,
  updateTenant,
  uploadMedia,
} from "@/lib/api";
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

      <h3 style={{ margin: "24px 0 12px" }}>Identitate brand</h3>
      <BrandingBlock
        settings={settings}
        onSaved={(s) => {
          setSettings(s);
          flash("Identitatea brandului a fost salvată.");
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

// Design-system defaults (globals.css) — shown in the pickers until overridden.
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
      { key: "vin", label: "De bază" },
      { key: "vin-deep", label: "Intens" },
      { key: "vin-wash", label: "Fundal" },
    ],
  },
  {
    title: "Accent auriu",
    keys: [
      { key: "ochre", label: "De bază" },
      { key: "ochre-soft", label: "Deschis" },
      { key: "ochre-wash", label: "Fundal" },
    ],
  },
  {
    title: "Accent verde",
    keys: [
      { key: "pine", label: "De bază" },
      { key: "pine-soft", label: "Deschis" },
      { key: "pine-wash", label: "Fundal" },
    ],
  },
];

function BrandingBlock({
  settings,
  onSaved,
  onError,
}: {
  settings: AdminSettings;
  onSaved: (s: AdminSettings) => void;
  onError: (m: string) => void;
}) {
  const b = settings.branding;
  const [displayName, setDisplayName] = useState(b.displayName ?? "");
  const [tagline, setTagline] = useState(b.tagline ?? "");
  const [greeting, setGreeting] = useState(b.greeting ?? "");
  const [promise, setPromise] = useState(b.promise ?? "");
  const [locationsText, setLocationsText] = useState(b.locations.join(", "));
  const [logoMediaId, setLogoMediaId] = useState<string | null>(b.logoMediaId);
  const [logoUrl, setLogoUrl] = useState<string | null>(b.logoUrl);
  const [colors, setColors] = useState<BrandColors>(b.colors);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function onLogoFile(file: File) {
    setUploading(true);
    try {
      const res = await uploadMedia(file);
      setLogoMediaId(res.mediaId);
      setLogoUrl(res.url);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Nu am putut încărca logo-ul.");
    } finally {
      setUploading(false);
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      const norm = (v: string) => (v.trim() === "" ? null : v.trim());
      onSaved(
        await updateBranding({
          displayName: norm(displayName),
          tagline: norm(tagline),
          greeting: norm(greeting),
          promise: norm(promise),
          locations: locationsText
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 6),
          logoMediaId,
          colors,
        }),
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : "Nu am putut salva identitatea.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={`card ${styles.block}`} onSubmit={onSubmit}>
      <p className="faint" style={{ marginBottom: 16, fontSize: "0.86rem" }}>
        Cum apare restaurantul în aplicația clienților: nume, salut, culori și logo. Câmpurile goale
        folosesc varianta standard.
      </p>
      <div className={styles.formGrid}>
        <label className="field">
          <span className="field-label">Nume scurt (brand)</span>
          <input
            className="input"
            value={displayName}
            placeholder="ex. Desaga"
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">Slogan</span>
          <input
            className="input"
            value={tagline}
            placeholder="ex. Gust Autentic"
            onChange={(e) => setTagline(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">Salut (meniul clientului)</span>
          <input
            className="input"
            value={greeting}
            placeholder="ex. No, zîua bună!"
            onChange={(e) => setGreeting(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">Orașe / locații (separate prin virgulă)</span>
          <input
            className="input"
            value={locationsText}
            placeholder="ex. Cluj-Napoca, Topa Mică"
            onChange={(e) => setLocationsText(e.target.value)}
          />
        </label>
        <label className={`field ${styles.formGridFull}`}>
          <span className="field-label">Promisiunea (subtitlul paginii principale)</span>
          <input
            className="input"
            value={promise}
            placeholder="ex. Peste 100 de preparate tradiționale…"
            onChange={(e) => setPromise(e.target.value)}
          />
        </label>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 16 }}>
        {logoUrl ? (
          <img
            src={logoUrl}
            alt="Logo"
            style={{
              height: 44,
              width: "auto",
              borderRadius: 8,
              border: "1px solid var(--line)",
              background: "#fff",
              padding: 4,
            }}
          />
        ) : (
          <span className="faint" style={{ fontSize: "0.86rem" }}>
            Fără logo — se folosește emblema standard.
          </span>
        )}
        <label className="btn btn--ghost btn--sm" style={{ cursor: "pointer" }}>
          {uploading ? "Se încarcă…" : logoUrl ? "Schimbă logo-ul" : "Încarcă logo (PNG/WebP)"}
          <input
            type="file"
            accept="image/png,image/webp,image/jpeg"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void onLogoFile(f);
            }}
          />
        </label>
        {logoUrl ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              setLogoMediaId(null);
              setLogoUrl(null);
            }}
          >
            Elimină
          </button>
        ) : null}
      </div>

      <div style={{ marginTop: 18 }}>
        <span className="field-label" style={{ display: "block", marginBottom: 10 }}>
          Paleta de culori
        </span>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          {COLOR_GROUPS.map((group) => (
            <div key={group.title}>
              <div className="faint" style={{ fontSize: "0.78rem", marginBottom: 6 }}>
                {group.title}
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                {group.keys.map(({ key, label }) => (
                  <label
                    key={key}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 4,
                      fontSize: "0.7rem",
                      color: "var(--ink-faint)",
                    }}
                  >
                    <input
                      type="color"
                      value={colors[key] ?? DEFAULT_COLORS[key]}
                      style={{
                        width: 40,
                        height: 30,
                        border: "1px solid var(--line)",
                        borderRadius: 6,
                        padding: 0,
                        cursor: "pointer",
                        background: "transparent",
                      }}
                      onChange={(e) => setColors((c) => ({ ...c, [key]: e.target.value }))}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
        {Object.keys(colors).length > 0 ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            style={{ marginTop: 10 }}
            onClick={() => setColors({})}
          >
            Revino la culorile standard
          </button>
        ) : null}
      </div>

      <div className={styles.formActions}>
        <button type="submit" className="btn btn--sm" disabled={busy || uploading}>
          {busy ? "Se salvează…" : "Salvează identitatea"}
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
