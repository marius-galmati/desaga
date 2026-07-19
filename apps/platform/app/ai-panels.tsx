"use client";

import type {
  AiCostPeriod,
  AiCostReport,
  AiModelOption,
  AiModelPrice,
  AiSettings,
} from "@boca/contracts";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  getAiCosts,
  getAiModels,
  getAiSettings,
  updateAiPrices,
  updateAiSettings,
} from "@/lib/api";
import styles from "./page.module.css";

const usd = (n: number) => `$${n.toFixed(n < 10 ? 4 : 2)}`;
const int = (n: number) => n.toLocaleString("ro-RO");

// "Gemini 2.5 Flash — $0.30/$2.50 /1M" (price appended only when known).
function modelLabel(m: AiModelOption): string {
  if (m.inputPerMillion == null || m.outputPerMillion == null) return m.label;
  return `${m.label} — $${m.inputPerMillion}/$${m.outputPerMillion} /1M`;
}

type PriceRow = AiModelPrice & { key: string };
let priceKeySeq = 0;
const newPriceKey = () => `p${priceKeySeq++}`;

/* ============================ AI settings ============================ */
export function AiSettingsPanel({
  onError,
  onFlash,
}: {
  onError: (m: string) => void;
  onFlash: (m: string) => void;
}) {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [provider, setProvider] = useState<"anthropic" | "openai">("openai");
  const [baseUrl, setBaseUrl] = useState("https://openrouter.ai/api/v1");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [prices, setPrices] = useState<PriceRow[]>([]);
  const [models, setModels] = useState<AiModelOption[]>([]);
  const [modelsSource, setModelsSource] = useState<"live" | "static" | null>(null);
  const [modelsNote, setModelsNote] = useState<string | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [manualModel, setManualModel] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await getAiSettings();
      setSettings(s);
      setProvider(s.provider);
      if (s.baseUrl) setBaseUrl(s.baseUrl);
      setModel(s.model ?? "");
      setPrices(s.prices.map((p) => ({ ...p, key: newPriceKey() })));
    } catch (err) {
      onError(err instanceof Error ? err.message : "Nu am putut încărca setările AI.");
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadModels = useCallback(async (prov: "anthropic" | "openai", base: string) => {
    setModelsLoading(true);
    try {
      const list = await getAiModels(prov, prov === "openai" ? base : undefined);
      setModels(list.models);
      setModelsSource(list.source);
      setModelsNote(list.note);
    } catch (err) {
      setModels([]);
      setModelsSource(null);
      setModelsNote(err instanceof Error ? err.message : "Nu am putut încărca lista de modele.");
    } finally {
      setModelsLoading(false);
    }
  }, []);

  // Reload the dropdown when provider or base URL changes — debounced so typing
  // a base URL doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      void loadModels(provider, baseUrl);
    }, 400);
    return () => clearTimeout(t);
  }, [provider, baseUrl, loadModels]);

  async function saveSettings(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      const s = await updateAiSettings({
        provider,
        baseUrl: provider === "openai" ? baseUrl.trim() || null : null,
        model: model.trim() || null,
        // Send the key only when the operator typed one (write-only).
        ...(apiKey !== "" ? { apiKey } : {}),
      });
      setSettings(s);
      setApiKey("");
      onFlash("Configurația AI a fost salvată.");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Salvarea a eșuat.");
    } finally {
      setBusy(false);
    }
  }

  async function clearKey() {
    if (!window.confirm("Ștergi cheia API stocată?")) return;
    setBusy(true);
    try {
      const s = await updateAiSettings({
        provider,
        baseUrl: provider === "openai" ? baseUrl.trim() || null : null,
        model: model.trim() || null,
        apiKey: "",
      });
      setSettings(s);
      onFlash("Cheia a fost ștearsă.");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Ștergerea a eșuat.");
    } finally {
      setBusy(false);
    }
  }

  async function savePrices() {
    setBusy(true);
    try {
      const s = await updateAiPrices({
        prices: prices
          .filter((p) => p.model.trim() !== "")
          .map((p) => ({
            model: p.model.trim(),
            label: p.label,
            inputPerMillion: p.inputPerMillion,
            outputPerMillion: p.outputPerMillion,
          })),
      });
      setSettings(s);
      setPrices(s.prices.map((p) => ({ ...p, key: newPriceKey() })));
      onFlash("Prețurile au fost salvate.");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Salvarea prețurilor a eșuat.");
    } finally {
      setBusy(false);
    }
  }

  function setPrice(i: number, patch: Partial<AiModelPrice>) {
    setPrices((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  // Copy the selected model's known price into the price table (add or update),
  // so cost tracking lines up without retyping the slug.
  function fillSelectedPrice() {
    const meta = models.find((m) => m.id === model);
    const input = meta?.inputPerMillion;
    const output = meta?.outputPerMillion;
    if (!meta || input == null || output == null) return;
    setPrices((rows) => {
      if (rows.some((r) => r.model.trim() === meta.id)) {
        return rows.map((r) =>
          r.model.trim() === meta.id
            ? { ...r, label: meta.label, inputPerMillion: input, outputPerMillion: output }
            : r,
        );
      }
      return [
        ...rows,
        {
          key: newPriceKey(),
          model: meta.id,
          label: meta.label,
          inputPerMillion: input,
          outputPerMillion: output,
        },
      ];
    });
    onFlash("Preț adăugat în tabel — nu uita să salvezi prețurile.");
  }

  const selectedMeta = models.find((m) => m.id === model);
  const selectedHasPrice =
    selectedMeta?.inputPerMillion != null && selectedMeta?.outputPerMillion != null;

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <span className="eyebrow eyebrow--ink">Model AI</span>
      </div>

      <form className={`card ${styles.block}`} onSubmit={saveSettings}>
        {settings && !settings.secretsConfigured ? (
          <p className="form-error" style={{ marginBottom: 14 }}>
            SECRETS_ENCRYPTION_KEY nu e setat — nu poți stoca chei din dashboard până nu-l adaugi în
            Dokploy (și redeploy). Modelul/prețurile se pot seta oricum.
          </p>
        ) : null}
        <div className={styles.formGrid}>
          <label className="field">
            <span className="field-label">Provider</span>
            <select
              className="select"
              value={provider}
              onChange={(e) => setProvider(e.target.value as "anthropic" | "openai")}
            >
              <option value="openai">OpenAI-compatibil (OpenRouter)</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </label>
          {provider === "openai" ? (
            <label className="field">
              <span className="field-label">Base URL</span>
              <input
                className="input"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://openrouter.ai/api/v1"
              />
            </label>
          ) : null}
          <label className="field">
            <span className="field-label">
              Model
              {modelsLoading
                ? " · se încarcă…"
                : modelsSource
                  ? ` · ${models.length} ${modelsSource === "live" ? "live" : "implicite"}`
                  : ""}
            </span>
            {manualModel ? (
              <input
                className="input"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={
                  provider === "openai" ? "ex. google/gemini-2.5-flash" : "ex. claude-sonnet-5"
                }
              />
            ) : (
              <select className="select" value={model} onChange={(e) => setModel(e.target.value)}>
                <option value="">— alege un model —</option>
                {model !== "" && !models.some((m) => m.id === model) ? (
                  <option value={model}>{model} (curent)</option>
                ) : null}
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {modelLabel(m)}
                  </option>
                ))}
              </select>
            )}
            <div className={styles.modelMeta}>
              <button
                type="button"
                className={styles.linkBtn}
                onClick={() => setManualModel((v) => !v)}
              >
                {manualModel ? "↤ Alege din listă" : "Scrie manual"}
              </button>
              <button
                type="button"
                className={styles.linkBtn}
                onClick={() => void loadModels(provider, baseUrl)}
              >
                ↻ Reîncarcă
              </button>
              {selectedHasPrice ? (
                <button type="button" className={styles.linkBtn} onClick={fillSelectedPrice}>
                  + Preț în tabel
                </button>
              ) : null}
            </div>
            {modelsNote ? <span className={styles.modelNote}>{modelsNote}</span> : null}
          </label>
          <label className="field">
            <span className="field-label">
              Cheie API {settings?.hasKey ? `(setată: …${settings.keyLast4})` : "(neconfigurată)"}
            </span>
            <input
              className="input"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={settings?.hasKey ? "lasă gol ca să păstrezi cheia" : "sk-..."}
              autoComplete="off"
            />
          </label>
        </div>
        <div className={styles.formActions}>
          {settings?.hasKey ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={busy}
              onClick={clearKey}
            >
              Șterge cheia
            </button>
          ) : null}
          <button type="submit" className="btn btn--sm" disabled={busy}>
            {busy ? "Se salvează…" : "Salvează model & cheie"}
          </button>
        </div>
      </form>

      <div className={`card ${styles.block}`} style={{ marginTop: 14 }}>
        <div className={styles.sectionHead}>
          <span className="eyebrow eyebrow--ink">Prețuri per model ($/1M tokeni)</span>
        </div>
        <p className="faint" style={{ fontSize: "0.82rem", marginBottom: 10 }}>
          Slug-ul modelului trebuie să fie EXACT cel din câmpul Model de mai sus, ca să se lege
          costurile. Folosit când providerul nu întoarce costul real.
        </p>
        {prices.map((p, i) => (
          <div key={p.key} className={styles.priceRow}>
            <input
              className="input"
              value={p.model}
              placeholder="slug model"
              onChange={(e) => setPrice(i, { model: e.target.value })}
            />
            <input
              className="input"
              value={p.label ?? ""}
              placeholder="etichetă"
              onChange={(e) => setPrice(i, { label: e.target.value || null })}
            />
            <input
              className="input"
              type="number"
              step="0.01"
              min="0"
              value={p.inputPerMillion}
              placeholder="input $/1M"
              onChange={(e) => setPrice(i, { inputPerMillion: Number(e.target.value) })}
            />
            <input
              className="input"
              type="number"
              step="0.01"
              min="0"
              value={p.outputPerMillion}
              placeholder="output $/1M"
              onChange={(e) => setPrice(i, { outputPerMillion: Number(e.target.value) })}
            />
            <button
              type="button"
              className={styles.domainDel}
              aria-label="Șterge rând"
              onClick={() => setPrices((rows) => rows.filter((_, idx) => idx !== i))}
            >
              ✕
            </button>
          </div>
        ))}
        <div className={styles.formActions} style={{ justifyContent: "space-between" }}>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() =>
              setPrices((rows) => [
                ...rows,
                {
                  key: newPriceKey(),
                  model: "",
                  label: null,
                  inputPerMillion: 0,
                  outputPerMillion: 0,
                },
              ])
            }
          >
            + Adaugă model
          </button>
          <button type="button" className="btn btn--sm" disabled={busy} onClick={savePrices}>
            {busy ? "Se salvează…" : "Salvează prețuri"}
          </button>
        </div>
      </div>
    </section>
  );
}

/* ============================ AI costs ============================ */
const PERIODS: { key: AiCostPeriod; label: string }[] = [
  { key: "day", label: "Zi" },
  { key: "week", label: "Săptămână" },
  { key: "month", label: "Lună" },
  { key: "all", label: "Tot" },
];

export function AiCostsPanel({ onError }: { onError: (m: string) => void }) {
  const [period, setPeriod] = useState<AiCostPeriod>("month");
  const [report, setReport] = useState<AiCostReport | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAiCosts(period)
      .then((r) => {
        if (!cancelled) setReport(r);
      })
      .catch((err) =>
        onError(err instanceof Error ? err.message : "Nu am putut încărca costurile."),
      );
    return () => {
      cancelled = true;
    };
  }, [period, onError]);

  return (
    <section className={styles.section}>
      <div
        className={styles.sectionHead}
        style={{ display: "flex", gap: 14, alignItems: "center" }}
      >
        <span className="eyebrow eyebrow--ink">Costuri AI</span>
        <div className={styles.periodChips}>
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`${styles.periodChip} ${period === p.key ? styles.periodChipOn : ""}`}
              onClick={() => setPeriod(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {report === null ? (
        <div className={styles.state}>Se încarcă…</div>
      ) : (
        <>
          <div className={`card ${styles.block}`} style={{ display: "flex", gap: 32 }}>
            <div>
              <div className="faint" style={{ fontSize: "0.76rem" }}>
                Cost total · {report.rangeLabel}
              </div>
              <div className={styles.costTotal}>{usd(report.totalCostUsd)}</div>
            </div>
            <div>
              <div className="faint" style={{ fontSize: "0.76rem" }}>
                Evaluări
              </div>
              <div className={styles.costTotal}>{int(report.totalCalls)}</div>
            </div>
          </div>

          <div className={`card ${styles.block}`} style={{ marginTop: 14 }}>
            <div className={styles.sectionHead}>
              <span className="eyebrow eyebrow--ink">Pe model</span>
            </div>
            {report.byModel.length === 0 ? (
              <p className="faint" style={{ fontSize: "0.86rem" }}>
                Nicio evaluare în interval.
              </p>
            ) : (
              <table className={styles.costTable}>
                <thead>
                  <tr>
                    <th>Model</th>
                    <th className={styles.num}>Evaluări</th>
                    <th className={styles.num}>Tokeni in/out</th>
                    <th className={styles.num}>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {report.byModel.map((m) => (
                    <tr key={m.model}>
                      <td>{m.label ?? m.model}</td>
                      <td className={styles.num}>{int(m.calls)}</td>
                      <td className={styles.num}>
                        {int(m.inputTokens)} / {int(m.outputTokens)}
                      </td>
                      <td className={styles.num}>{usd(m.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className={`card ${styles.block}`} style={{ marginTop: 14 }}>
            <div className={styles.sectionHead}>
              <span className="eyebrow eyebrow--ink">Pe restaurant</span>
            </div>
            {report.byTenant.length === 0 ? (
              <p className="faint" style={{ fontSize: "0.86rem" }}>
                Nicio evaluare în interval.
              </p>
            ) : (
              <table className={styles.costTable}>
                <thead>
                  <tr>
                    <th>Restaurant</th>
                    <th className={styles.num}>Evaluări</th>
                    <th className={styles.num}>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {report.byTenant.map((t) => (
                    <tr key={t.tenantId}>
                      <td>{t.name}</td>
                      <td className={styles.num}>{int(t.calls)}</td>
                      <td className={styles.num}>{usd(t.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </section>
  );
}
