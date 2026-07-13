import { randomUUID } from "node:crypto";

// Demo upload keys: tenant/{tenantId}/demo/{uuid}/original.jpg is the photoKey
// persisted in DB rows (reference_photo.storage_key / pass_photo.storage_key);
// the ai.jpg sibling is the pre-built model-input derivative (~1024px q80).
// The derivative is a storage convention, never stored in the DB — workers
// derive it via aiInputKeyFor() and fall back to re-encoding the original.

const ORIGINAL_SUFFIX = "/original.jpg";
const AI_INPUT_SUFFIX = "/ai.jpg";

export interface DemoPhotoKeys {
  photoKey: string;
  aiInputKey: string;
}

export function mintDemoPhotoKeys(tenantId: string): DemoPhotoKeys {
  const base = `tenant/${tenantId}/demo/${randomUUID()}`;
  return { photoKey: `${base}${ORIGINAL_SUFFIX}`, aiInputKey: `${base}${AI_INPUT_SUFFIX}` };
}

export function aiInputKeyFor(photoKey: string): string {
  if (photoKey.endsWith(ORIGINAL_SUFFIX)) {
    return `${photoKey.slice(0, -ORIGINAL_SUFFIX.length)}${AI_INPUT_SUFFIX}`;
  }
  // Non-demo keys (future real pass photos) have no pre-built derivative.
  return `${photoKey}.ai.jpg`;
}

/**
 * A client-supplied photoKey may only reference the caller's own tenant demo
 * space — anything else could leak cross-tenant objects into an evaluation.
 */
export function isOwnDemoPhotoKey(tenantId: string, photoKey: string): boolean {
  return photoKey.startsWith(`tenant/${tenantId}/demo/`) && photoKey.endsWith(ORIGINAL_SUFFIX);
}
