import { ReferenceField } from "@/components/reference-field";
import { Action, Copy, ErrorNotice, Field, Group, Screen, Toggle } from "@/components/ui";
import { type Entity, useResource } from "@/lib/resources";
import { useSession } from "@/lib/session";
import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useState } from "react";
import { Alert } from "react-native";

export function LegalScreen() {
  const { bootstrap, request, closeAccount, userId } = useSession();
  const [confirmation, setConfirmation] = useState("");
  const [closeIds, setCloseIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recipient, setRecipient] = useState("");
  const [message, setMessage] = useState("");
  const active = bootstrap?.activeWorkspace;
  const deleteAccount = () =>
    Alert.alert(
      "Permanently delete your account?",
      "Access is revoked immediately. Owned workspaces selected below will close. Personal and closed-workspace content is purged within 30 days.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete account",
          style: "destructive",
          onPress: () => {
            setBusy(true);
            void request("/me/deletion", {
              method: "POST",
              body: { confirmation, closeWorkspaceIds: closeIds },
              idempotencyKey: Crypto.randomUUID(),
            })
              .then(closeAccount)
              .then(() => router.replace("/sign-in"))
              .catch((cause) => setError(String(cause)))
              .finally(() => setBusy(false));
          },
        },
      ],
    );
  return (
    <Screen>
      <Copy variant="title">Privacy and your account</Copy>
      <Group title="Your information">
        <Copy>
          Precise routes are private to the recorder. Only reviewed mileage summaries are shared
          with the workspace. Route syncing starts off. Manage route history and device permissions
          in Device and privacy.
        </Copy>
        <Action
          title="Read privacy policy"
          secondary
          onPress={() => void Linking.openURL(`${process.env.EXPO_PUBLIC_API_URL}/privacy`)}
        />
        <Action
          title="Read terms"
          secondary
          onPress={() => void Linking.openURL(`${process.env.EXPO_PUBLIC_API_URL}/terms`)}
        />
      </Group>
      {active?.role === "owner" && (
        <Group title="Transfer workspace ownership">
          <Copy>
            Choose an existing member. They must accept the transfer before you can leave ownership
            behind.
          </Copy>
          <ReferenceField
            label="Accepting team member"
            resource="members"
            excludeIds={[userId]}
            value={recipient}
            onChange={setRecipient}
          />
          <Action
            title="Request ownership transfer"
            disabled={!recipient || busy}
            onPress={() => {
              setBusy(true);
              void request("/me/ownership-transfers", {
                method: "POST",
                body: { workspaceId: active.id, toUserId: recipient },
                idempotencyKey: Crypto.randomUUID(),
              })
                .then(() => setMessage("Transfer requested. The recipient must accept it."))
                .catch((cause) => setError(String(cause)))
                .finally(() => setBusy(false));
            }}
          />
        </Group>
      )}
      <OwnershipTransfers />
      <Group title="Delete account">
        <Copy>
          Export business records first. Transfer each workspace you own to an accepting member or
          select it for closure. Shared business records remain with anonymised attribution. Cancel
          store subscriptions in Apple or Google subscription settings; deleting the account does
          not stop a store renewal. Backup copies expire under the privacy policy.
        </Copy>
        {bootstrap?.workspaces
          .filter((workspace) => workspace.role === "owner")
          .map((workspace) => (
            <Toggle
              key={workspace.workspaceId}
              label={`Close ${workspace.name}`}
              value={closeIds.includes(workspace.workspaceId)}
              onChange={(checked) =>
                setCloseIds((previous) =>
                  checked
                    ? [...previous, workspace.workspaceId]
                    : previous.filter((id) => id !== workspace.workspaceId),
                )
              }
            />
          ))}
        <Copy muted>
          Reauthenticate using your password or email link, then submit within 10 minutes.
        </Copy>
        <Action
          title="Reauthenticate"
          secondary
          onPress={() => router.push({ pathname: "/sign-in", params: { returnTo: "back" } })}
        />
        <Field
          label="Type DELETE to confirm"
          value={confirmation}
          autoCapitalize="characters"
          onChangeText={setConfirmation}
        />
        <Action
          title="Delete my account"
          disabled={confirmation !== "DELETE"}
          busy={busy}
          onPress={deleteAccount}
        />
      </Group>
      {message && <Copy>{message}</Copy>}
      {error && <ErrorNotice message={error} />}
    </Screen>
  );
}

export function OwnershipTransfers() {
  const { request, refreshBootstrap } = useSession();
  const state = useResource<{ items: Entity[] }>("/me/ownership-transfers");
  const [error, setError] = useState("");
  return state.data?.items.length ? (
    <Group title="Ownership requests">
      {state.data.items.map((item) => (
        <Action
          key={item.id}
          title="Accept workspace ownership"
          onPress={() => {
            void request(`/me/ownership-transfers/${item.id}/accept`, {
              method: "POST",
              body: {},
              idempotencyKey: Crypto.randomUUID(),
            })
              .then(() => refreshBootstrap())
              .then(() => state.refresh())
              .catch((cause) => setError(String(cause)));
          }}
        />
      ))}
      {error && <ErrorNotice message={error} />}
    </Group>
  ) : null;
}
