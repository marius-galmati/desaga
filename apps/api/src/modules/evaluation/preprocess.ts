import { EVAL_DEFAULTS, PREPROCESSING_VERSION, QUALITY_GATE_DEFAULTS } from "@boca/config";
import sharp from "sharp";

// Image preprocessing chain (versioned via PREPROCESSING_VERSION):
//  - upload re-encode: EXIF baked/stripped by sharp re-encode, original-ish
//    capped at 2560px long edge, model-input derivative at 1024px q80.
//  - quality gates (worker): min resolution, brightness clipping (histogram
//    extremes) and a variance-of-Laplacian blur heuristic. Failure => the
//    evaluation ends not_scoreable / quality_gate_failed and the machine-
//    readable detail lands in pass_photo.quality (its designed home, 0009).
// Pure functions — unit-tested with sharp-generated fixtures, no live deps.

export const ORIGINAL_MAX_EDGE_PX = 2560;
export const ORIGINAL_JPEG_QUALITY = 90;

export const QUALITY_GATE = {
  minShortEdgePx: QUALITY_GATE_DEFAULTS.minShortEdgePx,
  /** Grayscale level at/below which a pixel counts as clipped-dark. */
  darkLevel: 10,
  /** Grayscale level at/above which a pixel counts as clipped-bright. */
  brightLevel: 245,
  /** Fail when more than this fraction of pixels clips at either extreme. */
  clippedFractionMax: 0.6,
  /** Fail when variance of the Laplacian falls below this (0..255 scale). */
  blurVarianceMin: 10,
  /** Long-edge downscale used for the gate analysis (speed, scale-stability). */
  analysisEdgePx: 512,
} as const;

export type QualityGateCode = "min_resolution" | "brightness_clipping" | "blur";

export interface QualityGateFailure {
  code: QualityGateCode;
  detail: string;
}

export interface QualityGateMetrics {
  width: number;
  height: number;
  shortEdgePx: number;
  darkFraction: number;
  brightFraction: number;
  laplacianVariance: number;
}

export interface QualityGateResult {
  passed: boolean;
  failures: QualityGateFailure[];
  metrics: QualityGateMetrics;
  preprocessingVersion: string;
}

/** Upload-time "original-ish": orientation baked in, EXIF gone, ≤2560px edge. */
export async function toOriginalJpeg(image: Buffer): Promise<Buffer> {
  return sharp(image)
    .rotate()
    .resize({
      width: ORIGINAL_MAX_EDGE_PX,
      height: ORIGINAL_MAX_EDGE_PX,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: ORIGINAL_JPEG_QUALITY })
    .toBuffer();
}

/** Model-input derivative: ~1024px long edge, JPEG q80 (EVAL_DEFAULTS). */
export async function toAiInputJpeg(image: Buffer): Promise<Buffer> {
  return sharp(image)
    .rotate()
    .resize({
      width: EVAL_DEFAULTS.maxImageEdgePx,
      height: EVAL_DEFAULTS.maxImageEdgePx,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: EVAL_DEFAULTS.jpegQuality })
    .toBuffer();
}

/** Candidate-photo quality gates. Never throws on gate failure — reports it. */
export async function runQualityGates(image: Buffer): Promise<QualityGateResult> {
  const { data, info } = await sharp(image)
    .rotate()
    .greyscale()
    .resize({
      width: QUALITY_GATE.analysisEdgePx,
      height: QUALITY_GATE.analysisEdgePx,
      fit: "inside",
      withoutEnlargement: true,
    })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = await orientedDimensions(image);
  const shortEdgePx = Math.min(width, height);
  const { darkFraction, brightFraction } = clippedFractions(data);
  const laplacianVariance = laplacianVarianceOf(data, info.width, info.height);

  const failures: QualityGateFailure[] = [];
  if (shortEdgePx < QUALITY_GATE.minShortEdgePx) {
    failures.push({
      code: "min_resolution",
      detail: `short edge ${shortEdgePx}px < required ${QUALITY_GATE.minShortEdgePx}px`,
    });
  }
  if (darkFraction > QUALITY_GATE.clippedFractionMax) {
    failures.push({
      code: "brightness_clipping",
      detail: `${(darkFraction * 100).toFixed(1)}% of pixels clipped dark (<= ${QUALITY_GATE.darkLevel})`,
    });
  } else if (brightFraction > QUALITY_GATE.clippedFractionMax) {
    failures.push({
      code: "brightness_clipping",
      detail: `${(brightFraction * 100).toFixed(1)}% of pixels clipped bright (>= ${QUALITY_GATE.brightLevel})`,
    });
  }
  if (laplacianVariance < QUALITY_GATE.blurVarianceMin) {
    failures.push({
      code: "blur",
      detail: `laplacian variance ${laplacianVariance.toFixed(2)} < required ${QUALITY_GATE.blurVarianceMin}`,
    });
  }

  return {
    passed: failures.length === 0,
    failures,
    metrics: {
      width,
      height,
      shortEdgePx,
      darkFraction: round4(darkFraction),
      brightFraction: round4(brightFraction),
      laplacianVariance: round4(laplacianVariance),
    },
    preprocessingVersion: PREPROCESSING_VERSION,
  };
}

async function orientedDimensions(image: Buffer): Promise<{ width: number; height: number }> {
  const meta = await sharp(image).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  // EXIF orientations 5..8 are 90°/270° rotations: swap the reported axes.
  if (meta.orientation !== undefined && meta.orientation >= 5) {
    return { width: height, height: width };
  }
  return { width, height };
}

function clippedFractions(pixels: Buffer): { darkFraction: number; brightFraction: number } {
  let dark = 0;
  let bright = 0;
  for (const value of pixels) {
    if (value <= QUALITY_GATE.darkLevel) {
      dark += 1;
    } else if (value >= QUALITY_GATE.brightLevel) {
      bright += 1;
    }
  }
  const total = pixels.length || 1;
  return { darkFraction: dark / total, brightFraction: bright / total };
}

/** Variance of a 3x3 Laplacian over the interior pixels (signed, unclamped). */
function laplacianVarianceOf(pixels: Buffer, width: number, height: number): number {
  if (width < 3 || height < 3) {
    return 0;
  }
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    const row = y * width;
    for (let x = 1; x < width - 1; x += 1) {
      const index = row + x;
      const lap =
        4 * (pixels[index] ?? 0) -
        (pixels[index - 1] ?? 0) -
        (pixels[index + 1] ?? 0) -
        (pixels[index - width] ?? 0) -
        (pixels[index + width] ?? 0);
      sum += lap;
      sumSq += lap * lap;
      count += 1;
    }
  }
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
