import { describe, expect, it } from "vitest";
import {
  ALLOWED_UPLOAD_MIME_TYPES,
  isAllowedUploadMime,
  UPLOAD_ACCEPT,
} from "@/config/file-upload";

describe("file-upload MIME allowlist", () => {
  describe("isAllowedUploadMime", () => {
    it("accepts every type in the allowlist", () => {
      for (const mime of ALLOWED_UPLOAD_MIME_TYPES) {
        expect(isAllowedUploadMime(mime)).toBe(true);
      }
    });

    it("accepts image/png and application/pdf", () => {
      expect(isAllowedUploadMime("image/png")).toBe(true);
      expect(isAllowedUploadMime("application/pdf")).toBe(true);
    });

    it("rejects image/svg+xml (script risk)", () => {
      expect(isAllowedUploadMime("image/svg+xml")).toBe(false);
    });

    it("rejects archives, executables, and arbitrary application types", () => {
      expect(isAllowedUploadMime("application/zip")).toBe(false);
      expect(isAllowedUploadMime("application/x-msdownload")).toBe(false);
      expect(isAllowedUploadMime("application/octet-stream")).toBe(false);
      expect(isAllowedUploadMime("text/html")).toBe(false);
    });

    it("rejects an empty string", () => {
      expect(isAllowedUploadMime("")).toBe(false);
    });

    it("trims surrounding whitespace before checking", () => {
      expect(isAllowedUploadMime("  image/png  ")).toBe(true);
      expect(isAllowedUploadMime(" image/jpeg")).toBe(true);
    });
  });

  describe("UPLOAD_ACCEPT", () => {
    it("is a comma-joined list of every allowed type", () => {
      expect(UPLOAD_ACCEPT).toBe(
        [
          "image/png",
          "image/jpeg",
          "image/webp",
          "image/gif",
          "image/heic",
          "image/heif",
          "image/avif",
          "application/pdf",
        ].join(","),
      );
    });

    it("contains no svg entry", () => {
      expect(UPLOAD_ACCEPT).not.toContain("image/svg+xml");
    });
  });
});
