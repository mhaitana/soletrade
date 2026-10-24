import { Note } from "@/components/native-ui";
import * as Haptics from "expo-haptics";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator } from "react-native";

export function useOperation() {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const running = useRef(false);
  const run = useCallback(async (work: () => Promise<string | void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await work();
      if (result) setMessage(result);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => undefined,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, []);
  return { busy, message, error, run };
}

export function Status({ operation }: { operation: ReturnType<typeof useOperation> }) {
  return (
    <>
      {operation.busy && <ActivityIndicator accessibilityLabel="Working" />}
      {operation.error && <Note error>{operation.error}</Note>}
      {operation.message && <Note>{operation.message}</Note>}
    </>
  );
}
