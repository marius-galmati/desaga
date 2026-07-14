/* Minimal typed client for the LIVE evaluation flow. Talks to the running Boca
   API through the same-origin /api proxy (next.config rewrite). For the owner
   demo it auto-logs-in with the seeded demo admin — no login wall. Types are
   local (the shapes the API returns); no zod runtime needed for a demo. */

// The AI evaluation demo now runs on the REAL Desaga tenant — dishes and
// reference sets come from the functional admin panel, not synthetic fixtures.
const DEMO = { tenantSlug: "desaga", email: "admin@desaga.ro", password: "Desaga-2026!" };
// Bumped when the demo tenant changed (demo -> desaga) so a stale cross-tenant
// refresh token from a prior session is ignored and a fresh login happens.
const REFRESH_KEY = "boca.showcase.refreshToken.desaga";

let accessToken: string | null = null;

export type CriterionKey =
  | "components"
  | "arrangement"
  | "sauce"
  | "cleanliness"
  | "color"
  | "portion";

export type CriterionScore = { score: number; justification: string; confidence: number };
export type EvaluationReport = {
  criteria: Record<CriterionKey, CriterionScore>;
  overall: { median: number; lowAgreement: boolean };
  dishMismatch?: boolean;
};
export type EvalConfig = {
  model: string;
  promptVersion: string;
  referenceSetVersion: number | null;
  toleranceVersion: number | null;
  preprocessingVersion: string;
  ensembleSize: number;
};
export type AiEvaluation = {
  id: string;
  status: "queued" | "running" | "completed" | "not_scoreable" | "eval_failed";
  notScoreableReason: string | null;
  report: EvaluationReport | null;
  evalConfig: EvalConfig;
  createdAt: string;
  completedAt: string | null;
};
export type DemoDish = {
  id: string;
  name: { ro: string; en: string };
  referenceSet: { versionNo: number; status: string; photoCount: number } | null;
};

async function raw(path: string, init: RequestInit = {}, auth = true): Promise<Response> {
  const headers = new Headers(init.headers);
  if (auth && accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  return fetch(`/api${path}`, { ...init, headers });
}

function storeTokens(payload: { tokens: { accessToken: string; refreshToken: string } }): void {
  accessToken = payload.tokens.accessToken;
  try {
    window.localStorage.setItem(REFRESH_KEY, payload.tokens.refreshToken);
  } catch {
    /* memory-only */
  }
}

/** Auto-login with the seeded demo admin; restores via refresh token if present. */
export async function ensureDemoSession(): Promise<void> {
  if (accessToken) return;
  let refresh: string | null = null;
  try {
    refresh = window.localStorage.getItem(REFRESH_KEY);
  } catch {
    /* ignore */
  }
  if (refresh) {
    const r = await raw("/auth/refresh", jsonInit({ refreshToken: refresh }), false);
    if (r.ok) {
      storeTokens(await r.json());
      return;
    }
  }
  const res = await raw("/auth/login", jsonInit(DEMO), false);
  if (!res.ok) throw new Error("Nu m-am putut conecta la server. Pornește API-ul (:3000).");
  storeTokens(await res.json());
}

function jsonInit(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `Cererea a eșuat (${res.status}).`;
    try {
      const b = (await res.json()) as { message?: string };
      if (b.message) msg = b.message;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

type AdminDishItem = {
  id: string;
  name: { ro: string; en: string };
  referenceSet: { versionNo: number; status: string; photoCount: number } | null;
};

export async function listDishes(): Promise<DemoDish[]> {
  // Real menu from the admin panel; the setup screen filters to active reference sets.
  const items = await jsonOrThrow<AdminDishItem[]>(await raw("/admin/dishes", { method: "GET" }));
  return items.map((d) => ({ id: d.id, name: d.name, referenceSet: d.referenceSet }));
}

export async function uploadPhoto(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const res = await raw("/admin/uploads", { method: "POST", body: form });
  const body = await jsonOrThrow<{ photoKey: string }>(res);
  return body.photoKey;
}

export async function startEvaluation(dishId: string, candidatePhotoKey: string): Promise<string> {
  const res = await raw("/admin/demo/evaluations", jsonInit({ dishId, candidatePhotoKey }));
  const body = await jsonOrThrow<{ evaluationId: string }>(res);
  return body.evaluationId;
}

export async function getEvaluation(id: string): Promise<AiEvaluation> {
  return jsonOrThrow<AiEvaluation>(await raw(`/admin/demo/evaluations/${id}`, { method: "GET" }));
}

/** Plain-Romanian copy for a not_scoreable reason code. */
export function notScoreableCopy(reason: string | null): string {
  switch (reason) {
    case "quality_gate_failed":
      return "Fotografia nu trece pragul de calitate — prea întunecată, neclară sau farfuria nu e complet în cadru. Refotografiază montajul.";
    case "refs_stale":
      return "Setul de referință al preparatului nu mai e valabil. Actualizează-l în Administrare.";
    case "non_scoreable_dish":
      return "Acest preparat e marcat ca nefotografiabil (finisat la masă).";
    default:
      return "Montajul nu a putut fi evaluat.";
  }
}
