// No-DB repository smoke tests: a recording Kysely dialect (DummyDriver-style
// connection) runs every query through the real Postgres query compiler and
// captures compiled SQL + parameters, while feeding scripted result rows back.
// Proves the builders compile and the tx chains sequence correctly on CI
// without a live Postgres.

import type { CompiledQuery, DatabaseConnection, Driver, QueryResult } from "kysely";
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from "kysely";
import { describe, expect, it } from "vitest";
import type { DB } from "../src/generated/db";
import {
  activateReferenceSet,
  createDemoDish,
  createQueuedEvaluation,
  createReferenceSet,
  ensureDefaultToleranceProfile,
  ensureDemoFixtures,
  getActiveReferenceSetForDishVersion,
  getEvaluationById,
  insertPassPhoto,
  listDishesWithReferenceStatus,
  updateEvaluationCompleted,
  updateEvaluationFailed,
  updateEvaluationNotScoreable,
  updateEvaluationRunning,
} from "../src/index";
import type { TenantTransaction } from "../src/tenant";

interface ScriptedResult {
  rows?: unknown[];
  numAffectedRows?: bigint;
}

function createRecordingTrx(results: ScriptedResult[] = []) {
  const executed: CompiledQuery[] = [];
  const queue = [...results];

  const connection: DatabaseConnection = {
    async executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
      executed.push(compiled);
      const next = queue.shift() ?? {};
      return {
        rows: (next.rows ?? []) as R[],
        ...(next.numAffectedRows !== undefined ? { numAffectedRows: next.numAffectedRows } : {}),
      };
    },
    // biome-ignore lint/correctness/useYield: streaming is unsupported in tests
    async *streamQuery(): AsyncIterableIterator<QueryResult<never>> {
      throw new Error("streamQuery is not supported by the recording connection");
    },
  };

  const driver: Driver = {
    async init() {},
    async acquireConnection() {
      return connection;
    },
    async beginTransaction() {},
    async commitTransaction() {},
    async rollbackTransaction() {},
    async releaseConnection() {},
    async destroy() {},
  };

  const db = new Kysely<DB>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (kysely) => new PostgresIntrospector(kysely),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });

  // Repositories only ever receive the tx handed out by withTenant; the cast
  // gives them the same query surface without opening a real transaction.
  return { trx: db as unknown as TenantTransaction, executed };
}

const TENANT = "00000000-0000-0000-0000-00000000000a";
const USER = "00000000-0000-0000-0000-00000000000b";
const LOCATION = "00000000-0000-0000-0000-00000000000c";

const PINNED_CONFIG = {
  modelId: "claude-sonnet-5",
  promptVersion: "eval-ro-v1",
  promptHash: "sha256:abc",
  preprocessingVersion: "prep-v1",
};

describe("menu repository", () => {
  it("createDemoDish inserts dish, version v1, then repoints current_version_id", async () => {
    const { trx, executed } = createRecordingTrx([
      { rows: [{ id: "dish-1" }] },
      { rows: [{ id: "ver-1" }] },
      { numAffectedRows: 1n },
    ]);

    const created = await createDemoDish(trx, {
      tenantId: TENANT,
      menuCategoryId: "cat-1",
      stationId: "station-1",
      createdBy: USER,
      name: { ro: "Dorada demo", en: "Demo sea bream" },
      priceMinor: 12500,
      vatRateBp: 900,
    });

    expect(created).toEqual({ dishId: "dish-1", dishVersionId: "ver-1", versionNo: 1 });
    expect(executed).toHaveLength(3);
    expect(executed[0]?.sql).toContain('insert into "dish"');
    expect(executed[1]?.sql).toContain('insert into "dish_version"');
    expect(executed[1]?.parameters).toContain(
      JSON.stringify({ ro: "Dorada demo", en: "Demo sea bream" }),
    );
    expect(executed[2]?.sql).toContain('update "dish" set "current_version_id"');
  });

  it("listDishesWithReferenceStatus compiles left joins against active sets", async () => {
    const { trx, executed } = createRecordingTrx([{ rows: [] }]);

    await expect(listDishesWithReferenceStatus(trx)).resolves.toEqual([]);
    const sql = executed[0]?.sql ?? "";
    expect(sql).toContain('from "dish" as "d"');
    expect(sql).toContain('left join "reference_set" as "rs"');
    expect(sql).toContain('left join "tolerance_profile" as "tp"');
    expect(sql).toContain('"d"."archived_at" is null');
  });
});

describe("references repository", () => {
  it("createReferenceSet computes the next version and inserts photos in bulk", async () => {
    const { trx, executed } = createRecordingTrx([
      { rows: [{ max_version: 2 }] },
      { rows: [{ id: "set-1" }] },
      { rows: [{ id: "photo-1" }, { id: "photo-2" }, { id: "photo-3" }] },
    ]);

    const created = await createReferenceSet(trx, {
      tenantId: TENANT,
      dishId: "dish-1",
      dishVersionId: "ver-1",
      createdBy: USER,
      photos: [1, 2, 3].map((n) => ({
        role: "primary" as const,
        storageKey: `tenant/t/reference/ref${n}.jpg`,
        captureDeviceId: "device-1",
        captureProfileVersion: "demo-manual-v1",
        shotAt: new Date("2026-07-13T10:00:00Z"),
      })),
    });

    expect(created.versionNo).toBe(3);
    expect(created.photoIds).toHaveLength(3);
    expect(executed[1]?.parameters).toContain(3); // version_no
    expect(executed[2]?.sql).toContain('insert into "reference_photo"');
  });

  it("activateReferenceSet rejects a draft that misses the required primary count", async () => {
    const { trx } = createRecordingTrx([
      { rows: [{ id: "set-1", dish_id: "dish-1", dish_version_id: "ver-1", status: "draft" }] },
      { rows: [{ role: "primary" }, { role: "primary" }] },
    ]);

    await expect(
      activateReferenceSet(trx, {
        referenceSetId: "set-1",
        approvedBy: USER,
        requiredPrimaryCount: 3,
      }),
    ).rejects.toThrow(/2 primary photos, expected exactly 3/);
  });

  it("activateReferenceSet rejects a draft with zero primary photos", async () => {
    const { trx } = createRecordingTrx([
      { rows: [{ id: "set-1", dish_id: "dish-1", dish_version_id: "ver-1", status: "draft" }] },
      { rows: [{ role: "holdout" }] },
    ]);

    await expect(
      activateReferenceSet(trx, { referenceSetId: "set-1", approvedBy: USER }),
    ).rejects.toThrow(/0 primary photos, expected 1..5/);
  });

  it("activateReferenceSet accepts a single primary photo (per-tenant count 1)", async () => {
    const { trx } = createRecordingTrx([
      { rows: [{ id: "set-3", dish_id: "dish-1", dish_version_id: "ver-1", status: "draft" }] },
      { rows: [{ role: "primary" }] },
      { numAffectedRows: 1n }, // retire previous active
      { numAffectedRows: 1n }, // activate this draft
      { numAffectedRows: 1n }, // dish.refs_stale = false
    ]);

    const activated = await activateReferenceSet(trx, {
      referenceSetId: "set-3",
      approvedBy: USER,
      requiredPrimaryCount: 1,
    });
    expect(activated.referenceSetId).toBe("set-3");
  });

  it("activateReferenceSet retires the old set, activates, and clears refs_stale", async () => {
    const { trx, executed } = createRecordingTrx([
      { rows: [{ id: "set-2", dish_id: "dish-1", dish_version_id: "ver-1", status: "draft" }] },
      { rows: [{ role: "primary" }, { role: "primary" }, { role: "primary" }] },
      { numAffectedRows: 1n }, // retire previous active
      { numAffectedRows: 1n }, // activate this draft
      { numAffectedRows: 1n }, // dish.refs_stale = false
    ]);

    const activated = await activateReferenceSet(trx, {
      referenceSetId: "set-2",
      approvedBy: USER,
    });

    expect(activated).toEqual({
      referenceSetId: "set-2",
      dishId: "dish-1",
      dishVersionId: "ver-1",
    });
    expect(executed[2]?.sql).toContain('update "reference_set"');
    expect(executed[2]?.parameters).toContain("retired");
    expect(executed[3]?.parameters).toContain("active");
    expect(executed[4]?.sql).toContain('update "dish" set "refs_stale"');
  });

  it("getActiveReferenceSetForDishVersion returns undefined when no active set exists", async () => {
    const { trx } = createRecordingTrx([{ rows: [] }]);
    await expect(getActiveReferenceSetForDishVersion(trx, "ver-1")).resolves.toBeUndefined();
  });

  it("ensureDefaultToleranceProfile is a no-op when an active profile exists", async () => {
    const { trx, executed } = createRecordingTrx([{ rows: [{ id: "tol-1" }] }]);

    await expect(
      ensureDefaultToleranceProfile(trx, { tenantId: TENANT, dishId: "dish-1", createdBy: USER }),
    ).resolves.toBe("tol-1");
    expect(executed).toHaveLength(1);
  });

  it("ensureDefaultToleranceProfile inserts an active v1 with all 6 criterion keys", async () => {
    const { trx, executed } = createRecordingTrx([
      { rows: [] },
      { rows: [{ max_version: null }] },
      { rows: [{ id: "tol-1" }] },
    ]);

    await expect(
      ensureDefaultToleranceProfile(trx, { tenantId: TENANT, dishId: "dish-1", createdBy: USER }),
    ).resolves.toBe("tol-1");
    const criteriaParam = executed[2]?.parameters.find(
      (p) => typeof p === "string" && p.includes("allowed_variance"),
    );
    expect(criteriaParam).toBeDefined();
    const parsed = JSON.parse(criteriaParam as string) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual([
      "arrangement",
      "cleanliness",
      "color",
      "components",
      "portion",
      "sauce",
    ]);
  });
});

describe("pass photo repository", () => {
  it("insertPassPhoto marks uploaded_at when the object is already uploaded", async () => {
    const { trx, executed } = createRecordingTrx([{ rows: [{ id: "photo-1" }] }]);

    await expect(
      insertPassPhoto(trx, {
        tenantId: TENANT,
        locationId: LOCATION,
        orderItemId: "item-1",
        storageKey: "tenant/t/pass/2026-07-13/photo.jpg",
      }),
    ).resolves.toBe("photo-1");
    const sql = executed[0]?.sql ?? "";
    expect(sql).toContain('insert into "pass_photo"');
    expect(sql).toContain('"uploaded_at"');
    expect(executed[0]?.parameters).toContain("uploaded");
  });
});

describe("evaluations repository", () => {
  const queuedChainResults = (overrides: {
    referenceSetRows: unknown[];
    toleranceRows: unknown[];
    nonScoreable?: boolean;
    evaluationRow: Record<string, unknown>;
  }): ScriptedResult[] => [
    {
      rows: [
        {
          id: "ver-1",
          dish_id: "dish-1",
          name: { ro: "Dorada", en: "Sea bream" },
          price_minor: 12500,
          vat_rate_bp: 900,
          non_scoreable: overrides.nonScoreable ?? false,
        },
      ],
    },
    { rows: [{ id: "order-1" }] },
    { rows: [{ id: "item-1" }] },
    { rows: [{ id: "photo-1" }] },
    { rows: overrides.referenceSetRows },
    // reference photos are only fetched when a set row came back
    ...(overrides.referenceSetRows.length > 0 ? [{ rows: [] }] : []),
    { rows: overrides.toleranceRows },
    { rows: [overrides.evaluationRow] },
  ];

  it("createQueuedEvaluation persists the whole synthetic chain and pins config", async () => {
    const { trx, executed } = createRecordingTrx(
      queuedChainResults({
        referenceSetRows: [{ id: "set-1", dish_version_id: "ver-1", status: "active" }],
        toleranceRows: [{ id: "tol-1" }],
        evaluationRow: { id: "eval-1", status: "queued" },
      }),
    );

    const result = await createQueuedEvaluation(trx, {
      tenantId: TENANT,
      locationId: LOCATION,
      tableSessionId: "session-1",
      dishVersionId: "ver-1",
      photo: { storageKey: "tenant/t/pass/2026-07-13/photo.jpg" },
      mode: "shadow",
      config: PINNED_CONFIG,
    });

    expect(result.orderId).toBe("order-1");
    expect(result.orderItemId).toBe("item-1");
    expect(result.passPhotoId).toBe("photo-1");
    expect(result.evaluation).toMatchObject({ id: "eval-1", status: "queued" });

    const evalInsert = executed[executed.length - 1];
    expect(evalInsert?.sql).toContain('insert into "ai_evaluation"');
    expect(evalInsert?.parameters).toEqual(
      expect.arrayContaining([
        "queued",
        "claude-sonnet-5",
        "eval-ro-v1",
        "sha256:abc",
        "prep-v1",
        "set-1",
        "tol-1",
      ]),
    );
    expect(executed[1]?.sql).toContain('insert into "guest_order"');
    expect(executed[2]?.sql).toContain('insert into "order_item"');
    expect(executed[2]?.parameters).toContain(12500); // snapshot from dish_version
  });

  it("createQueuedEvaluation inserts not_scoreable/refs_stale when no active reference set exists", async () => {
    const { trx, executed } = createRecordingTrx(
      queuedChainResults({
        referenceSetRows: [],
        toleranceRows: [{ id: "tol-1" }],
        evaluationRow: { id: "eval-1", status: "not_scoreable" },
      }),
    );

    const result = await createQueuedEvaluation(trx, {
      tenantId: TENANT,
      locationId: LOCATION,
      tableSessionId: "session-1",
      dishVersionId: "ver-1",
      photo: { storageKey: "k" },
      mode: "shadow",
      config: PINNED_CONFIG,
    });

    expect(result.evaluation.status).toBe("not_scoreable");
    const evalInsert = executed[executed.length - 1];
    expect(evalInsert?.parameters).toEqual(expect.arrayContaining(["not_scoreable", "refs_stale"]));
  });

  it("updateEvaluationRunning only claims rows still queued", async () => {
    const { trx, executed } = createRecordingTrx([{ numAffectedRows: 0n }]);

    await expect(updateEvaluationRunning(trx, "eval-1")).resolves.toBe(false);
    const sql = executed[0]?.sql ?? "";
    expect(sql).toContain('update "ai_evaluation"');
    expect(executed[0]?.parameters).toEqual(expect.arrayContaining(["running", "queued"]));
  });

  it("updateEvaluationCompleted writes scores + full pinned config + completed_at in one statement", async () => {
    const { trx, executed } = createRecordingTrx([{ numAffectedRows: 1n }]);

    await expect(
      updateEvaluationCompleted(trx, {
        evaluationId: "eval-1",
        config: PINNED_CONFIG,
        referenceSetId: "set-1",
        toleranceProfileId: "tol-1",
        criterionScores: {
          components: { score: 4, justification_ro: "Toate componentele.", confidence: 0.9 },
        },
        overallScore: 4.0,
        rawEnsemble: [{ run: 1 }, { run: 2 }, { run: 3 }],
        ensembleSize: 3,
        latencyMs: 4210,
      }),
    ).resolves.toBe(true);

    const sql = executed[0]?.sql ?? "";
    expect(sql).toContain('"completed_at"');
    expect(sql).toContain('"criterion_scores"');
    expect(executed[0]?.parameters).toEqual(
      expect.arrayContaining(["completed", "set-1", "tol-1", "claude-sonnet-5", 3, 4210]),
    );
  });

  it("updateEvaluationNotScoreable and updateEvaluationFailed set their terminal states", async () => {
    const notScoreable = createRecordingTrx([{ numAffectedRows: 1n }]);
    await expect(
      updateEvaluationNotScoreable(notScoreable.trx, {
        evaluationId: "eval-1",
        reason: "quality_gate_failed",
      }),
    ).resolves.toBe(true);
    expect(notScoreable.executed[0]?.parameters).toEqual(
      expect.arrayContaining(["not_scoreable", "quality_gate_failed"]),
    );

    const failed = createRecordingTrx([{ numAffectedRows: 1n }]);
    await expect(
      updateEvaluationFailed(failed.trx, {
        evaluationId: "eval-1",
        failureDetail: "anthropic: overloaded",
      }),
    ).resolves.toBe(true);
    expect(failed.executed[0]?.parameters).toEqual(
      expect.arrayContaining(["eval_failed", "anthropic: overloaded"]),
    );
  });

  it("getEvaluationById joins photo, order item and pinned dish version", async () => {
    const { trx, executed } = createRecordingTrx([{ rows: [] }]);

    await expect(getEvaluationById(trx, "eval-1")).resolves.toBeUndefined();
    const sql = executed[0]?.sql ?? "";
    expect(sql).toContain('inner join "pass_photo" as "p"');
    expect(sql).toContain('inner join "order_item" as "oi"');
    expect(sql).toContain('inner join "dish_version" as "dv"');
  });
});

describe("demo fixtures repository", () => {
  it("ensureDemoFixtures reuses every existing standing row", async () => {
    const { trx, executed } = createRecordingTrx([
      { rows: [{ id: "cat-1" }] },
      { rows: [{ id: "station-1" }] },
      { rows: [{ id: "device-1" }] },
      { rows: [{ id: "section-1" }] },
      { rows: [{ id: "table-1" }] },
      { rows: [{ id: "session-1" }] },
    ]);

    await expect(
      ensureDemoFixtures(trx, { tenantId: TENANT, locationId: LOCATION }),
    ).resolves.toEqual({
      menuCategoryId: "cat-1",
      stationId: "station-1",
      captureDeviceId: "device-1",
      floorSectionId: "section-1",
      diningTableId: "table-1",
      tableSessionId: "session-1",
    });
    expect(executed).toHaveLength(6);
    expect(executed.every((q) => q.sql.startsWith("select"))).toBe(true);
  });

  it("ensureDemoFixtures creates missing rows in dependency order", async () => {
    const { trx, executed } = createRecordingTrx([
      { rows: [] },
      { rows: [{ id: "cat-1" }] },
      { rows: [] },
      { rows: [{ id: "station-1" }] },
      { rows: [] },
      { rows: [{ id: "device-1" }] },
      { rows: [] },
      { rows: [{ id: "section-1" }] },
      { rows: [] },
      { rows: [{ id: "table-1" }] },
      { rows: [] },
      { rows: [{ id: "session-1" }] },
    ]);

    const fixtures = await ensureDemoFixtures(trx, { tenantId: TENANT, locationId: LOCATION });

    expect(fixtures.tableSessionId).toBe("session-1");
    const inserts = executed.filter((q) => q.sql.startsWith("insert")).map((q) => q.sql);
    expect(inserts[0]).toContain('"menu_category"');
    expect(inserts[1]).toContain('"station"');
    expect(inserts[2]).toContain('"capture_device"');
    expect(inserts[3]).toContain('"floor_section"');
    expect(inserts[4]).toContain('"dining_table"');
    expect(inserts[5]).toContain('"table_session"');
  });
});
