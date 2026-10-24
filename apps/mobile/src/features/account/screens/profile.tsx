import { Action, Copy, ErrorNotice, Field, Group, Screen } from "@/components/ui";
import { useSession } from "@/lib/session";
import * as Crypto from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
export function ProfileScreen() {
  const { bootstrap, request, refreshBootstrap } = useSession();
  const { fullName: prefill } = useLocalSearchParams<{ fullName?: string }>();
  const [name, setName] = useState(prefill ?? bootstrap?.user.fullName ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [operationId] = useState(() => Crypto.randomUUID());
  const save = async () => {
    if (!name.trim()) {
      setError("Enter your full name.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await request("/me/profile", {
        method: "PATCH",
        body: { fullName: name.trim() },
        idempotencyKey: operationId,
      });
      await refreshBootstrap();
      router.back();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update your profile.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen>
      <Copy variant="title">My account</Copy>
      <Group>
        <Copy variant="caption" muted>
          Email
        </Copy>
        <Copy>{bootstrap?.user.email}</Copy>
        <Field label="Full name *" value={name} onChangeText={setName} autoComplete="name" />
        {error && <ErrorNotice message={error} />}
        <Action title="Save profile" busy={busy} onPress={() => void save()} />
      </Group>
    </Screen>
  );
}
