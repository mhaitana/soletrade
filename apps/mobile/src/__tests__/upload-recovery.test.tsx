import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { UploadScreen } from "@/screens/upload";
import { fetch } from "expo/fetch";
import { router } from "expo-router";
import { retireCompletedCapture, writeState } from "@/offline/store";

const mockStates = new Map<string, unknown>();
const mockRequest = jest.fn();
let mockBinding = { userId: "user", workspaceId: "workspace" };
let mockSequence = 0;
jest.mock("expo-router", () => ({ router: { back: jest.fn() } }));
jest.mock("expo-crypto", () => ({ randomUUID: () => `uuid-${++mockSequence}` }));
jest.mock("expo-document-picker", () => ({
  getDocumentAsync: jest.fn(async () => ({
    canceled: false,
    assets: [{ uri: "cache://file", name: "receipt.pdf", mimeType: "application/pdf" }],
  })),
}));
jest.mock("expo-file-system", () => ({ File: class {} }));
jest.mock("expo/fetch", () => ({ fetch: jest.fn() }));
jest.mock("@/lib/session", () => ({
  useSession: () => ({ ...mockBinding, request: mockRequest }),
}));
jest.mock("@/offline/store", () => ({
  durableFile: jest.fn(async () => ({
    uri: "document://file",
    name: "receipt.pdf",
    mimeType: "application/pdf",
    sizeBytes: 123,
    uploadOperationId: "journal-upload-operation",
    completionOperationId: "journal-completion-operation",
  })),
  retireCompletedCapture: jest.fn(async () => {}),
  readState: jest.fn(async (key: string) => mockStates.get(key) ?? null),
  writeState: jest.fn(async (key: string, value: unknown) => {
    mockStates.set(key, JSON.parse(JSON.stringify(value)));
  }),
}));
jest.mock("@/components/ui", () => {
  const React = jest.requireActual("react");
  const { View, Text, Pressable } = jest.requireActual("react-native");
  return {
    Screen: ({ children }: any) => <View>{children}</View>,
    Copy: ({ children }: any) => <Text>{children}</Text>,
    ErrorNotice: ({ message }: any) => <Text>{message}</Text>,
    Action: ({ title, disabled, onPress }: any) => (
      <Pressable disabled={disabled} onPress={onPress}>
        <Text>{title}</Text>
      </Pressable>
    ),
  };
});
beforeEach(() => {
  mockStates.clear();
  mockRequest.mockReset();
  jest.mocked(retireCompletedCapture).mockReset();
  jest.mocked(retireCompletedCapture).mockResolvedValue(undefined);
  jest.mocked(writeState).mockClear();
  jest.mocked(fetch).mockReset();
  jest.mocked(router.back).mockClear();
  mockBinding = { userId: "user", workspaceId: "workspace" };
});
it("renews an expired URL after remount, retaining file and operation IDs until explicit upload", async () => {
  let renewal = 0;
  mockRequest.mockImplementation(async (path: string) => {
    if (path.endsWith("/upload")) return { fileId: "file-id", uploadUrl: "expired" };
    if (path.endsWith("/upload-url"))
      return {
        fileId: "file-id",
        storagePath: "path",
        completed: false,
        uploadUrl: `fresh-url-${++renewal}`,
      };
    return {};
  });
  jest
    .mocked(fetch)
    .mockResolvedValueOnce({ ok: false } as Awaited<ReturnType<typeof fetch>>)
    .mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof fetch>>);
  const first = await render(<UploadScreen />);
  await fireEvent.press(screen.getByText("Choose file"));
  await fireEvent.press(screen.getByText("Upload file"));
  await waitFor(() => expect(screen.getByText(/Upload interrupted/)).toBeTruthy());
  const uploadKey = mockRequest.mock.calls.find(([path]) => path.endsWith("/upload"))![1]
    .idempotencyKey;
  const persisted = [...mockStates.values()][0] as any;
  expect(persisted.fileId).toBe("file-id");
  expect(persisted.uploadOperationId).toBe(uploadKey);
  const completeKey = persisted.completionOperationId;
  await first.unmount();
  mockRequest.mockClear();
  await render(<UploadScreen />);
  await waitFor(() => expect(screen.getByText("receipt.pdf")).toBeTruthy());
  expect(mockRequest).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText("Upload file"));
  await waitFor(() => expect(router.back).toHaveBeenCalled());
  expect(mockRequest.mock.calls.some(([path]) => path.endsWith("/upload"))).toBe(false);
  expect(
    mockRequest.mock.calls.find(([path]) => path.endsWith("/complete"))![1].idempotencyKey,
  ).toBe(completeKey);
  expect(uploadKey).toBe("journal-upload-operation");
  expect(completeKey).toBe("journal-completion-operation");
  expect(fetch).toHaveBeenLastCalledWith("fresh-url-2", expect.anything());
});
it("recovers lost completion without uploading bytes again and never restores another binding", async () => {
  let completed = false;
  let completionKey: string | undefined;
  mockRequest.mockImplementation(async (path: string, options: any) => {
    if (path.endsWith("/upload")) return { fileId: "file-id", uploadUrl: "expired" };
    if (path.endsWith("/upload-url"))
      return { fileId: "file-id", completed, uploadUrl: completed ? null : "fresh-url" };
    completed = true;
    completionKey = options.idempotencyKey;
    throw new Error("Connection lost after completion");
  });
  jest.mocked(fetch).mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof fetch>>);
  const first = await render(<UploadScreen />);
  await fireEvent.press(screen.getByText("Choose file"));
  await fireEvent.press(screen.getByText("Upload file"));
  await waitFor(() => expect(screen.getByText("Connection lost after completion")).toBeTruthy());
  expect(completionKey).toBeTruthy();
  expect(retireCompletedCapture).not.toHaveBeenCalled();
  expect((mockStates.get("file-upload:user:workspace") as any).completed).not.toBe(true);
  await first.unmount();
  mockBinding = { userId: "other", workspaceId: "workspace" };
  const other = await render(<UploadScreen />);
  expect(screen.queryByText("receipt.pdf")).toBeNull();
  await other.unmount();
  mockBinding = { userId: "user", workspaceId: "workspace" };
  await render(<UploadScreen />);
  await waitFor(() => expect(screen.getByText("receipt.pdf")).toBeTruthy());
  await fireEvent.press(screen.getByText("Upload file"));
  await waitFor(() => expect(router.back).toHaveBeenCalled());
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(retireCompletedCapture).toHaveBeenCalledWith(
    { userId: "user", workspaceId: "workspace" },
    expect.objectContaining({ uri: "document://file" }),
    { fileId: "file-id", completed: true },
  );
  const retirementOrder = jest.mocked(retireCompletedCapture).mock.invocationCallOrder[0];
  const clearedIndex = jest.mocked(writeState).mock.calls.findIndex(([, value]) => value === null);
  expect(retirementOrder).toBeLessThan(
    jest.mocked(writeState).mock.invocationCallOrder[clearedIndex],
  );
});
it("replays the same durable create operation after its response was lost", async () => {
  mockRequest.mockRejectedValueOnce(new Error("Create response lost"));
  const first = await render(<UploadScreen />);
  await fireEvent.press(screen.getByText("Choose file"));
  await fireEvent.press(screen.getByText("Upload file"));
  await waitFor(() => expect(screen.getByText("Create response lost")).toBeTruthy());
  const createKey = mockRequest.mock.calls[0][1].idempotencyKey;
  await first.unmount();
  mockRequest.mockImplementation(async (path: string) =>
    path.endsWith("/upload")
      ? { fileId: "same-file", uploadUrl: "expired" }
      : { fileId: "same-file", storagePath: "original", completed: true, uploadUrl: null },
  );
  await render(<UploadScreen />);
  await waitFor(() => expect(screen.getByText("receipt.pdf")).toBeTruthy());
  expect(mockRequest).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByText("Upload file"));
  await waitFor(() => expect(router.back).toHaveBeenCalled());
  expect(mockRequest.mock.calls[1][1].idempotencyKey).toBe(createKey);
  expect(fetch).not.toHaveBeenCalled();
});
it("stops an old workspace upload before sending bytes after a binding change", async () => {
  let finish!: (value: unknown) => void;
  mockRequest.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = await render(<UploadScreen />);
  await fireEvent.press(screen.getByText("Choose file"));
  await fireEvent.press(screen.getByText("Upload file"));
  await waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(1));
  mockBinding = { userId: "user", workspaceId: "other-workspace" };
  await view.rerender(<UploadScreen />);
  finish({ fileId: "old-file", uploadUrl: "do-not-use" });
  await waitFor(() => expect(screen.queryByText("Restoring selected file…")).toBeNull());
  expect(fetch).not.toHaveBeenCalled();
  expect(router.back).not.toHaveBeenCalled();
  expect(mockRequest).toHaveBeenCalledTimes(1);
});

it("keeps confirmed upload state when retirement fails and retries cleanup without uploading again", async () => {
  mockRequest.mockImplementation(async (path: string) =>
    path.endsWith("/upload") ? { fileId: "completed-file", completed: true, uploadUrl: null } : {},
  );
  jest.mocked(retireCompletedCapture).mockRejectedValueOnce(new Error("Local cleanup interrupted"));
  await render(<UploadScreen />);
  await fireEvent.press(screen.getByText("Choose file"));
  await fireEvent.press(screen.getByText("Upload file"));
  await waitFor(() => expect(screen.getByText("Local cleanup interrupted")).toBeTruthy());
  expect(router.back).not.toHaveBeenCalled();
  expect(mockStates.get("file-upload:user:workspace")).toEqual(
    expect.objectContaining({ completed: true, fileId: "completed-file" }),
  );
  await fireEvent.press(screen.getByText("Upload file"));
  await waitFor(() => expect(router.back).toHaveBeenCalled());
  expect(mockRequest).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
});
it("retires an already-completed selection before replacing its persisted upload state", async () => {
  mockStates.set("file-upload:user:workspace", {
    userId: "user",
    workspaceId: "workspace",
    file: {
      uri: "document://previous",
      name: "previous.pdf",
      mimeType: "application/pdf",
      sizeBytes: 50,
    },
    fileId: "previous-file",
    completed: true,
    uploadOperationId: "previous-upload",
    completionOperationId: "previous-complete",
  });
  await render(<UploadScreen />);
  await waitFor(() => expect(screen.getByText("previous.pdf")).toBeTruthy());
  await fireEvent.press(screen.getByText("Choose file"));
  await waitFor(() => expect(screen.getByText("receipt.pdf")).toBeTruthy());
  expect(retireCompletedCapture).toHaveBeenCalledWith(
    { userId: "user", workspaceId: "workspace" },
    expect.objectContaining({ uri: "document://previous" }),
    { fileId: "previous-file", completed: true },
  );
  expect(jest.mocked(retireCompletedCapture).mock.invocationCallOrder[0]).toBeLessThan(
    jest.mocked(writeState).mock.invocationCallOrder[0],
  );
  expect(mockStates.get("file-upload:user:workspace")).toEqual(
    expect.objectContaining({
      uploadOperationId: "journal-upload-operation",
      completionOperationId: "journal-completion-operation",
    }),
  );
});
