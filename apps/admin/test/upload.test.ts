import { UPLOAD_MAX_BYTES } from "@boca/contracts";
import { describe, expect, it } from "vitest";
import { validateUploadFile } from "../src/lib/upload";

describe("validateUploadFile", () => {
  it("accepts the three allowed image types at the size limit", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      expect(validateUploadFile({ type, size: UPLOAD_MAX_BYTES })).toBeNull();
    }
  });

  it("rejects disallowed content types with RO copy", () => {
    expect(validateUploadFile({ type: "image/gif", size: 1024 })).toMatch(/Format neacceptat/);
    expect(validateUploadFile({ type: "application/pdf", size: 1024 })).toMatch(
      /Format neacceptat/,
    );
  });

  it("rejects files over the published byte limit", () => {
    expect(validateUploadFile({ type: "image/jpeg", size: UPLOAD_MAX_BYTES + 1 })).toMatch(
      /limita de 15 MB/,
    );
  });
});
