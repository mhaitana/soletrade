import {
  Action,
  Copy,
  ErrorNotice,
  Field,
  Group,
  Loading,
  Row,
  Screen,
  Toggle,
} from "@/components/ui";
import { prepareAssistantTurn, type AssistantTurn } from "@/features/assistant/lib/assistant-turn";
import { authenticatedFetch } from "@/lib/api";
import { navigateBusiness } from "@/lib/navigation/business";
import { useResource, useWorkspacePath } from "@/lib/resources";
import { token, useSession } from "@/lib/session";
import { radius, spacing, useTheme } from "@/theme/index";
import type { CollectionPage } from "@soletrade/contracts";
import * as Crypto from "expo-crypto";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";

type Conversation = {
  id: string;
  title: string;
  updatedAt: string;
  writeEnabled: boolean;
  messages: { role: string; content: string }[];
};
type ToolResult = {
  type?: string;
  href?: string;
  resource?: string;
  prefill?: Record<string, unknown>;
  label?: string;
  [key: string]: unknown;
};
export function parseStreamLine(line: string): Record<string, unknown> | null {
  if (!line.startsWith("data:")) return null;
  const data = line.slice(5).trim();
  if (data === "[DONE]") return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}
export function AssistantScreen() {
  const { request, workspaceId } = useSession();
  const theme = useTheme();
  const base = useWorkspacePath("assistant/conversations");
  const conversations = useResource<CollectionPage<Conversation>>(base);
  const [selected, setSelected] = useState("");
  const detail = useResource<Conversation>(base && selected ? `${base}/${selected}` : null);
  const [text, setText] = useState("");
  const [answer, setAnswer] = useState("");
  const [tools, setTools] = useState<ToolResult[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [rename, setRename] = useState("");
  const generation = useRef(0);
  const createOperation = useRef(Crypto.randomUUID());
  const pendingTurn = useRef<AssistantTurn | null>(null);
  // Workspace changes intentionally clear private conversation state before the next paint.
  useEffect(() => {
    generation.current++;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Clear private state when workspace binding changes.
    setSelected("");
    setAnswer("");
    setTools([]);
    setText("");
  }, [workspaceId]);
  const create = async () => {
    if (!base) return "";
    const conversation = await request<Conversation>(base, {
      method: "POST",
      body: { title: text.trim().slice(0, 80) || "New conversation" },
      idempotencyKey: createOperation.current,
    });
    createOperation.current = Crypto.randomUUID();
    setSelected(conversation.id);
    await conversations.refresh();
    return conversation.id;
  };
  const send = async () => {
    if (!text.trim() || busy || !base) return;
    setBusy(true);
    setError("");
    setAnswer("");
    setTools([]);
    const current = ++generation.current;
    let accepted = false;
    try {
      const id = selected || (await create());
      const turn = prepareAssistantTurn(pendingTurn.current, id, text, Crypto.randomUUID);
      pendingTurn.current = turn;
      const response = await authenticatedFetch(`${base}/${id}/messages`, await token(), {
        method: "POST",
        body: { message: turn.message },
        idempotencyKey: turn.operationId,
        version: detail.data?.updatedAt,
      });
      if (!response.ok) {
        const data = await response.json();
        if (data.error?.code === "ASSISTANT_TURN_ACCEPTED") {
          pendingTurn.current = null;
          setText("");
          await detail.refresh(`${base}/${id}`);
          await conversations.refresh();
          setError(
            "This message was already accepted. Conversation history was reloaded; its actions will not run again.",
          );
          return;
        }
        throw new Error(data.error?.message ?? "Could not contact hAI.");
      }
      accepted = true;
      pendingTurn.current = null;
      setText("");
      if (!response.body)
        throw new Error("Streaming is unavailable. Try again on a supported native build.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (current !== generation.current) {
          await reader.cancel();
          break;
        }
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const event = parseStreamLine(line);
          if (!event) continue;
          if (event.type === "text-delta")
            setAnswer((previous) => previous + String(event.delta ?? event.textDelta ?? ""));
          if (
            event.type === "tool-output-available" &&
            event.output &&
            typeof event.output === "object"
          )
            setTools((previous) => [...previous, event.output as ToolResult]);
          if (event.type === "error")
            throw new Error(String(event.errorText ?? "hAI could not finish this response."));
        }
      }
      if (current === generation.current) {
        await detail.refresh(`${base}/${id}`);
        await conversations.refresh();
        setAnswer("");
      }
    } catch (cause) {
      setError(
        accepted
          ? "Your message was accepted, but the stream was interrupted. Reload the conversation before continuing."
          : cause instanceof Error
            ? cause.message
            : "Could not send. Your message is retained.",
      );
    } finally {
      setBusy(false);
    }
  };
  const patch = async (body: unknown) => {
    try {
      await request(`${base}/${selected}`, {
        method: "PATCH",
        body,
        version: detail.data?.updatedAt,
      });
      await detail.refresh();
      await conversations.refresh();
    } catch (cause) {
      setError(String(cause));
    }
  };
  return (
    <Screen>
      <Copy variant="title">hAI</Copy>
      <Copy muted>
        Your business assistant. Read live information, prepare drafts and keep the final say.
      </Copy>
      {!selected ? (
        <Group title="Conversations">
          <Action
            title="New conversation"
            busy={busy}
            onPress={() => {
              setBusy(true);
              void create()
                .catch((cause) => setError(String(cause)))
                .finally(() => setBusy(false));
            }}
          />
          {conversations.loading && !conversations.data ? (
            <Loading />
          ) : conversations.data?.items.length ? (
            conversations.data.items.map((conversation) => (
              <Row
                key={conversation.id}
                title={conversation.title}
                subtitle={new Date(conversation.updatedAt).toLocaleDateString()}
                onPress={() => setSelected(conversation.id)}
              />
            ))
          ) : (
            <Copy muted>Start a conversation below.</Copy>
          )}
        </Group>
      ) : (
        <>
          <Action
            title="All conversations"
            secondary
            onPress={() => {
              generation.current++;
              setSelected("");
              setAnswer("");
              setTools([]);
            }}
          />
          {detail.loading && !detail.data ? (
            <Loading />
          ) : (
            detail.data && (
              <>
                <Group title={detail.data.title}>
                  {detail.data.messages.length === 0 && !answer && (
                    <View style={{ gap: spacing.sm, paddingVertical: spacing.xs }}>
                      <Copy variant="caption" muted>
                        Quick starter questions:
                      </Copy>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
                        {[
                          "Summarize this month's revenue",
                          "Who has overdue invoices?",
                          "Draft a quote for customer",
                          "What is my mileage deduction?",
                        ].map((prompt) => (
                          <Pressable
                            key={prompt}
                            accessibilityRole="button"
                            accessibilityLabel={prompt}
                            onPress={() => setText(prompt)}
                            style={{
                              paddingHorizontal: spacing.md,
                              paddingVertical: spacing.xs + 2,
                              borderRadius: radius.pill,
                              backgroundColor: theme.surfaceSubtle,
                              borderWidth: 1,
                              borderColor: theme.line,
                            }}
                          >
                            <Text style={{ fontSize: 13, color: theme.text, fontWeight: "500" }}>
                              {prompt}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  )}
                  {detail.data.messages.map((message, index) => {
                    const isUser = message.role === "user";
                    return (
                      <View
                        key={index}
                        style={{
                          alignSelf: isUser ? "flex-end" : "flex-start",
                          maxWidth: "88%",
                          backgroundColor: isUser ? theme.tint : theme.surface,
                          borderColor: isUser ? theme.accent + "33" : theme.line,
                          borderWidth: 1,
                          borderRadius: radius.md,
                          padding: spacing.md,
                          gap: spacing.xs,
                        }}
                      >
                        <View
                          style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}
                        >
                          {!isUser && (
                            <View
                              style={{
                                width: 18,
                                height: 18,
                                borderRadius: 5,
                                backgroundColor: theme.primary,
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              <Text
                                style={{
                                  color: theme.primaryForeground,
                                  fontSize: 10,
                                  fontWeight: "800",
                                }}
                              >
                                h
                              </Text>
                            </View>
                          )}
                          <Text
                            style={{
                              fontSize: 11,
                              fontWeight: "700",
                              color: isUser ? theme.accent : theme.text,
                              textTransform: "uppercase",
                              letterSpacing: 0.5,
                            }}
                          >
                            {isUser ? "You" : "hAI"}
                          </Text>
                        </View>
                        <Copy>{message.content}</Copy>
                      </View>
                    );
                  })}
                  {answer ? (
                    <View
                      style={{
                        alignSelf: "flex-start",
                        maxWidth: "88%",
                        backgroundColor: theme.surface,
                        borderColor: theme.line,
                        borderWidth: 1,
                        borderRadius: radius.md,
                        padding: spacing.md,
                        gap: spacing.xs,
                      }}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
                        <View
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: 5,
                            backgroundColor: theme.primary,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Text
                            style={{
                              color: theme.primaryForeground,
                              fontSize: 10,
                              fontWeight: "800",
                            }}
                          >
                            h
                          </Text>
                        </View>
                        <Text
                          style={{
                            fontSize: 11,
                            fontWeight: "700",
                            color: theme.text,
                            textTransform: "uppercase",
                            letterSpacing: 0.5,
                          }}
                        >
                          hAI
                        </Text>
                      </View>
                      <Copy>{answer}</Copy>
                    </View>
                  ) : null}
                </Group>
                <Group title="Conversation settings">
                  <Toggle
                    label="Allow confirmed business actions"
                    value={detail.data.writeEnabled}
                    onChange={(value) => void patch({ writeEnabled: value })}
                  />
                  <Copy variant="caption" muted>
                    hAI asks for your confirmation before changing records or sending anything.
                  </Copy>
                  <Field
                    label="Conversation title"
                    value={rename}
                    placeholder={detail.data.title}
                    onChangeText={setRename}
                  />
                  <Action
                    title="Rename conversation"
                    disabled={!rename.trim()}
                    secondary
                    onPress={() => void patch({ title: rename.trim() })}
                  />
                  <Action
                    title="Delete conversation"
                    secondary
                    onPress={() => {
                      void request(`${base}/${selected}`, {
                        method: "DELETE",
                        version: detail.data?.updatedAt,
                      })
                        .then(() => {
                          setSelected("");
                          void conversations.refresh();
                        })
                        .catch((cause) => setError(String(cause)));
                    }}
                  />
                </Group>
              </>
            )
          )}
        </>
      )}
      {tools.map((tool, index) => (
        <ToolAction key={index} result={tool} />
      ))}
      <Group>
        <Field
          label="Message hAI"
          multiline
          value={text}
          editable={!busy}
          onChangeText={(value) => {
            setText(value);
            pendingTurn.current = null;
          }}
          placeholder="What would you like to do?"
        />
        <Action
          title="Send message"
          busy={busy}
          disabled={!text.trim()}
          onPress={() => void send()}
        />
      </Group>
      {(error || detail.error || conversations.error) && (
        <ErrorNotice message={error || detail.error || conversations.error!} />
      )}
    </Screen>
  );
}
function ToolAction({ result }: { result: ToolResult }) {
  if (result.ok === false && typeof result.error === "string")
    return <ErrorNotice message={result.error} />;
  if (result.directive && typeof result.directive === "object") {
    const directive = result.directive as Record<string, unknown>;
    if (typeof directive.workflow === "string") {
      const resources: Record<string, string> = {
        customer: "customers",
        invoice: "invoices",
        quote: "quotes",
        "books.transaction": "books/transactions",
        "drive.earning": "drive/earnings",
        "drive.trip": "drive/trips",
        "drive.expense": "drive/expenses",
        "drive.vehicle": "drive/vehicles",
        "settings.general": "settings",
        "settings.member-invite": "invitations",
        "drive.settings": "drive/settings",
      };
      const workflow = directive.workflow;
      if (workflow === "settings.account")
        return (
          <Action
            title={String(directive.label ?? "Review account details")}
            secondary
            onPress={() =>
              router.push({
                pathname: "/profile",
                params: {
                  fullName: String((directive.fields as Record<string, unknown>)?.fullName ?? ""),
                },
              } as never)
            }
          />
        );
      const resource = resources[workflow] ?? resources[workflow.replace(/\.(create|edit)$/, "")];
      if (!resource) return null;
      const fields = { ...((directive.fields as Record<string, unknown>) ?? {}) };
      if (fields.distanceKm !== undefined) fields.distanceMeters = Number(fields.distanceKm) * 1000;
      const entityId = workflow.endsWith(".edit")
        ? String(directive.href).match(/\/([0-9a-f-]{36})(?:\/|$)/i)?.[1]
        : undefined;
      return (
        <Action
          title={String(directive.label ?? "Review unsaved draft")}
          secondary
          onPress={() =>
            router.push({
              pathname: "/edit/[resource]/[id]",
              params: {
                resource,
                id: entityId ?? (resource.endsWith("settings") ? "settings" : "new"),
                prefill: JSON.stringify(fields),
              },
            } as never)
          }
        />
      );
    }
    if (typeof directive.href === "string")
      return (
        <Action
          title={String(directive.label ?? "Open workspace page")}
          secondary
          onPress={() => navigateBusiness(directive.href as string)}
        />
      );
  }
  if (typeof result.href === "string")
    return (
      <Action
        title={result.label ?? "Open record"}
        secondary
        onPress={() => navigateBusiness(result.href!)}
      />
    );
  if (result.resource && result.prefill)
    return (
      <Action
        title={result.label ?? "Review draft"}
        secondary
        onPress={() =>
          router.push({
            pathname: "/edit/[resource]/[id]",
            params: {
              resource: result.resource,
              id: "new",
              prefill: JSON.stringify(result.prefill),
            },
          } as never)
        }
      />
    );
  if (result.action && typeof result.action === "object")
    return <ToolAction result={result.action as ToolResult} />;
  return null;
}
