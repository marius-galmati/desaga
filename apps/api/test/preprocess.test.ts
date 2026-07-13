import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  QUALITY_GATE,
  runQualityGates,
  toAiInputJpeg,
  toOriginalJpeg,
} from "../src/modules/evaluation/preprocess";

// sharp-generated fixtures only — no live services, no image files on disk.

async function solidJpeg(width: number, height: number, value: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: value, g: value, b: value } },
  })
    .jpeg()
    .toBuffer();
}

/** Deterministic high-frequency noise: sharp AND far from both histogram ends. */
async function noiseJpeg(width: number, height: number): Promise<Buffer> {
  const raw = Buffer.alloc(width * height);
  let state = 41;
  for (let i = 0; i < raw.length; i += 1) {
    state = (state * 75 + 74) % 65537; // Lehmer-style PRNG, deterministic
    raw[i] = 40 + (state % 176); // 40..215 — no clipping at either end
  }
  return sharp(raw, { raw: { width, height, channels: 1 } })
    .jpeg({ quality: 95 })
    .toBuffer();
}

describe("runQualityGates", () => {
  it("fails min_resolution below the 800px short edge", async () => {
    const image = await noiseJpeg(1024, 600);
    const result = await runQualityGates(image);
    expect(result.passed).toBe(false);
    expect(result.failures.map((f) => f.code)).toContain("min_resolution");
    expect(result.metrics.shortEdgePx).toBe(600);
  });

  it("fails brightness_clipping and blur on a solid near-black image", async () => {
    const image = await solidJpeg(1200, 900, 2);
    const result = await runQualityGates(image);
    const codes = result.failures.map((f) => f.code);
    expect(result.passed).toBe(false);
    expect(codes).toContain("brightness_clipping");
    expect(codes).toContain("blur");
    expect(result.metrics.darkFraction).toBeGreaterThan(QUALITY_GATE.clippedFractionMax);
  });

  it("fails brightness_clipping on a blown-out near-white image", async () => {
    const image = await solidJpeg(1200, 900, 254);
    const result = await runQualityGates(image);
    expect(result.failures.map((f) => f.code)).toContain("brightness_clipping");
    expect(result.metrics.brightFraction).toBeGreaterThan(QUALITY_GATE.clippedFractionMax);
  });

  it("passes a sharp, well-exposed image and reports metrics + version", async () => {
    const image = await noiseJpeg(1600, 1200);
    const result = await runQualityGates(image);
    expect(result.failures).toEqual([]);
    expect(result.passed).toBe(true);
    expect(result.metrics.laplacianVariance).toBeGreaterThan(QUALITY_GATE.blurVarianceMin);
    expect(result.preprocessingVersion).toBe("v1");
  });
});

describe("image derivatives", () => {
  it("toAiInputJpeg downscales to a 1024px long edge JPEG", async () => {
    const image = await noiseJpeg(2000, 1500);
    const output = await toAiInputJpeg(image);
    const meta = await sharp(output).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(1024);
  });

  it("toOriginalJpeg never enlarges and strips metadata by re-encode", async () => {
    const image = await noiseJpeg(1000, 800);
    const output = await toOriginalJpeg(image);
    const meta = await sharp(output).metadata();
    expect(meta.width).toBe(1000);
    expect(meta.height).toBe(800);
    expect(meta.exif).toBeUndefined();
  });
});
