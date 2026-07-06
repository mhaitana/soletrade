import { describe, expect, it } from "vitest";
import { branded } from "@/shared/types/ids";
import { buildStoragePath } from "./index";
import { formatBytes } from "@/shared/lib/format";

describe("buildStoragePath", () => {
  const ws = branded<"WorkspaceId">("00000000-0000-4000-8000-0000000000e1");
  const file = branded<"FileId">("00000000-0000-4000-8000-0000000000e2");

  it("namespaces by workspace so a listing never leaks across workspaces", () => {
    const path = buildStoragePath({
      workspaceId: ws,
      fileId: file,
      fileName: "receipt.pdf",
      entityType: "book_transaction",
      entityId: "txn-123",
    });
    expect(path).toBe(`workspaces/${ws}/book_transaction/txn-123/${file}/receipt.pdf`);
  });

  it("falls back to misc/unlinked segments when no entity is supplied", () => {
    const path = buildStoragePath({
      workspaceId: ws,
      fileId: file,
      fileName: "doc.pdf",
    });
    expect(path).toBe(`workspaces/${ws}/misc/unlinked/${file}/doc.pdf`);
  });

  it("keeps the workspace segment first regardless of entity values", () => {
    const path = buildStoragePath({
      workspaceId: ws,
      fileId: file,
      fileName: "x.pdf",
      entityType: "invoice",
      entityId: "inv-9",
    });
    expect(path.startsWith(`workspaces/${ws}/`)).toBe(true);
  });
});

describe("formatBytes", () => {
  it("renders bytes below 1 KiB as B", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("renders KiB and MiB with one decimal under 100", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
  });

  it("rounds once the value crosses 100 of a unit", () => {
    expect(formatBytes(100 * 1024)).toBe("100 KB");
    expect(formatBytes(123 * 1024)).toBe("123 KB");
  });
});
