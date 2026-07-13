// Client-side pre-flight for the multipart upload route — mirrors the server
// limits published in @boca/contracts so users get instant RO feedback instead
// of a 400 round-trip. Pure (takes {type,size}) so it unit-tests in node.

import { UPLOAD_ALLOWED_CONTENT_TYPES, UPLOAD_MAX_BYTES } from "@boca/contracts";

export interface FileCheck {
  type: string;
  size: number;
}

/** Returns a Romanian error message, or null when the file is acceptable. */
export function validateUploadFile(file: FileCheck): string | null {
  if (!(UPLOAD_ALLOWED_CONTENT_TYPES as readonly string[]).includes(file.type)) {
    return "Format neacceptat — folosește JPEG, PNG sau WebP.";
  }
  if (file.size > UPLOAD_MAX_BYTES) {
    const mib = Math.round(UPLOAD_MAX_BYTES / (1024 * 1024));
    return `Fișierul depășește limita de ${mib} MB.`;
  }
  return null;
}

export const REFERENCE_MIN = 3;
export const REFERENCE_MAX = 5;
