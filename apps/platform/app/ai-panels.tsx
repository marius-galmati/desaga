"use client";

import type { AiCostPeriod, AiCostReport, AiModelPrice, AiSettings } from "@boca/contracts";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { getAiCosts, getAiSettings, updateAiPrices, updateAiSettings } from "@/lib/api";
import styles from "./page.module.css";

const MODEL_PRESETS = [
  "google/gemini-2.5-flash",
  "google/gemini-2.5-flash-lite",
  "deepseek/deepseek-chat-v3",
  "qwen/qwen2.5-vl-72b-instruct",
  "z-ai/glm-4.5v",
  "anthropic/claude-sonnet-5",
];

const usd = (n: number) => `$${n.toFixed(n < 10 ? 4 : 2)}`;
const int = (n: number) => n.toLocaleString("ro-RO");

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
            <span className="field-label">Model</span>
            <input
              className="input"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="google/gemini-2.5-flash"
              list="ai-model-presets"
            />
            <datalist id="ai-model-presets">
              {MODEL_PRESETS.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
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
