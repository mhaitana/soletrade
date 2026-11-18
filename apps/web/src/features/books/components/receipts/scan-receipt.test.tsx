import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { ScanReceipt } from "@/features/books/components/receipts/scan-receipt";

const extractReceiptActionMock = vi.fn();
const refreshMock = vi.fn();
const fetchMock = vi.fn<typeof fetch>();

vi.mock("@/features/books/api/receipts/actions", () => ({
  extractReceiptAction: (...args: unknown[]) => extractReceiptActionMock(...args),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

function fileInput(container: HTMLElement): HTMLInputElement {
  return container.querySelector('input[type="file"]') as HTMLInputElement;
}

const receipt = () => new File(["bytes"], "fuel.jpg", { type: "image/jpeg" });

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (url) =>
    String(url) === "/api/files/upload-url"
      ? new Response(JSON.stringify({ fileId: "file-1", uploadUrl: "https://storage.test/put" }))
      : new Response(null, { status: 200 }),
  );
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("ScanReceipt", () => {
  it("uploads the file, asks the server to read it, then refreshes the queue", async () => {
    extractReceiptActionMock.mockResolvedValue({ ok: true, extractionId: "ext-1" });
    const { container } = render(<ScanReceipt />);

    await userEvent.upload(fileInput(container), receipt());

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, upload] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(upload?.body))).toMatchObject({
      fileName: "fuel.jpg",
      mimeType: "image/jpeg",
      entityType: "receipt",
    });
    expect(fetchMock.mock.calls[1]![0]).toBe("https://storage.test/put");
    expect(extractReceiptActionMock).toHaveBeenCalledWith({ fileId: "file-1" });
    expect(toast.success).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /scan a receipt/i })).toBeEnabled();
  });

  it("shows the server's reason when the receipt could not be read", async () => {
    extractReceiptActionMock.mockResolvedValue({
      ok: false,
      error: "That receipt could not be read.",
    });
    const { container } = render(<ScanReceipt />);

    await userEvent.upload(fileInput(container), receipt());

    expect(await screen.findByRole("alert")).toHaveTextContent("That receipt could not be read.");
    expect(toast.success).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("does not read anything when the upload fails", async () => {
    fetchMock.mockImplementation(async (url) =>
      String(url) === "/api/files/upload-url"
        ? new Response(JSON.stringify({ fileId: "file-1", uploadUrl: "https://storage.test/put" }))
        : new Response(null, { status: 500 }),
    );
    const { container } = render(<ScanReceipt />);

    await userEvent.upload(fileInput(container), receipt());

    expect(await screen.findByRole("alert")).toHaveTextContent(/upload failed/i);
    expect(extractReceiptActionMock).not.toHaveBeenCalled();
  });

  it("rejects an unsupported file type before uploading", async () => {
    const { container } = render(<ScanReceipt />);

    await userEvent.upload(
      fileInput(container),
      new File(["x"], "notes.txt", { type: "text/plain" }),
      { applyAccept: false },
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(/image or PDF/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("states the credit cost when scans are charged", () => {
    render(<ScanReceipt costLabel="$0.10" />);
    expect(screen.getByText(/may use \$0\.10 of workspace credit/i)).toBeInTheDocument();
  });
});
