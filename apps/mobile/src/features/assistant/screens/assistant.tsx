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
import {
  approvalBatch,
  approvalTitle,
  CAUTION_TEXT,
  type PendingApproval,
} from "@/features/assistant/lib/approvals";
import {
  prepareAssistantTurn,
  stoppedNotice,
  type AssistantTurn,
} from "@/features/assistant/lib/assistant-turn";
import { authenticatedFetch } from "@/lib/api";
import { navigateBusiness } from "@/lib/navigation/business";
import { useResource, useWorkspacePath } from "@/lib/resources";
import { token, useSession } from "@/lib/session";
import { radius, spacing, useTheme } from "@/theme/index";
import type { CollectionPage } from "@soletrade/contracts";
import * as Crypto from "expo-crypto";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";

type Conversation = {
  id: string;
  title: string;
  updatedAt: string;
  writeEnabled: boolean;
  messages: { id?: string; role: string; content: string }[];
  /** Changes hAI's last reply is waiting on (newer servers only). */
  pendingApprovals?: PendingApproval[];
};
type StreamResponse = Awaited<ReturnType<typeof authenticatedFetch>>;
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
  const [streaming, setStreaming] = useState(false);
  const [notice, setNotice] = useState("");
  const [toggleKey, setToggleKey] = useState(0);
  const [rename, setRename] = useState("");
  const [decisions, setDecisions] = useState<Record<string, boolean>>({});
  const generation = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const createOperation = useRef(Crypto.randomUUID());
  const pendingTurn = useRef<AssistantTurn | null>(null);
  // Workspace changes intentionally clear private conversation state before the next paint.
  useEffect(() => {
    generation.current++;
    abort.current?.abort();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Clear private state when workspace binding changes.
    setSelected("");
    setAnswer("");
    setTools([]);
    setText("");
    setDecisions({});
  }, [workspaceId]);
  // Leaving the screen ends any in-flight stream.
  useEffect(
    () => () => {
      generation.current++;
      abort.current?.abort();
    },
    [],
  );
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
  /** Show one streamed reply as it arrives: text live, tool results as actions. */
  const readStream = async (response: StreamResponse, current: number) => {
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
  };
  /**
   * Send the decisions on every change hAI is waiting on. Only yes or no goes up; what
   * the change is comes from the server's own record of hAI's request. The reply then
   * continues (the approved changes run, once) and streams like a normal answer.
   */
  const submitApprovals = async (batch: {
    approvals: { approvalId: string; approved: boolean }[];
  }) => {
    if (busy || !base || !selected) return;
    const id = selected;
    setBusy(true);
    setError("");
    setNotice("");
    setAnswer("");
    setTools([]);
    const current = ++generation.current;
    const controller = new AbortController();
    abort.current = controller;
    setStreaming(true);
    let accepted = false;
    try {
      const response = await authenticatedFetch(`${base}/${id}/approvals`, await token(), {
        method: "POST",
        body: batch,
        version: detail.data?.updatedAt,
        signal: controller.signal,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        if (data?.error?.code !== "ASSISTANT_TURN_ACCEPTED")
          throw new Error(data?.error?.message ?? "Could not send your decision.");
      } else {
        accepted = true;
        await readStream(response, current);
      }
      if (current === generation.current) {
        setDecisions({});
        await detail.refresh(`${base}/${id}`);
        await conversations.refresh();
        setAnswer("");
      }
    } catch (cause) {
      setDecisions({});
      if (controller.signal.aborted) {
        if (current === generation.current) {
          setAnswer("");
          setNotice(stoppedNotice(accepted));
          await detail.refresh(`${base}/${id}`).catch(() => undefined);
        }
        return;
      }
      await detail.refresh(`${base}/${id}`).catch(() => undefined);
      setError(
        accepted
          ? "Your decision was received, but the reply was interrupted. The conversation was reloaded."
          : cause instanceof Error
            ? cause.message
            : "Could not send your decision. Please try again.",
      );
    } finally {
      if (abort.current === controller) abort.current = null;
      setStreaming(false);
      setBusy(false);
    }
  };
  const decide = (approval: PendingApproval, approved: boolean) => {
    const next = { ...decisions, [approval.approvalId]: approved };
    setDecisions(next);
    const batch = approvalBatch(detail.data?.pendingApprovals ?? [], next);
    if (batch) void submitApprovals(batch);
  };
  const send = async () => {
    if (!text.trim() || busy || !base) return;
    setBusy(true);
    setError("");
    setNotice("");
    setAnswer("");
    setTools([]);
    const current = ++generation.current;
    const controller = new AbortController();
    abort.current = controller;
    setStreaming(true);
    let accepted = false;
    let activeId = selected;
    try {
      const id = selected || (await create());
      activeId = id;
      const turn = prepareAssistantTurn(pendingTurn.current, id, text, Crypto.randomUUID);
      pendingTurn.current = turn;
      const response = await authenticatedFetch(`${base}/${id}/messages`, await token(), {
        method: "POST",
        body: { message: turn.message },
        idempotencyKey: turn.operationId,
        version: detail.data?.updatedAt,
        signal: controller.signal,
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
      await readStream(response, current);
      if (current === generation.current) {
        await detail.refresh(`${base}/${id}`);
        await conversations.refresh();
        setAnswer("");
      }
    } catch (cause) {
      if (controller.signal.aborted) {
        // The user pressed Stop (or left). An accepted turn is reloaded; otherwise the same
        // operation id is reused on the next send, so nothing can run twice.
        if (current === generation.current) {
          setAnswer("");
          setNotice(stoppedNotice(accepted));
          if (accepted && base && activeId) {
            await detail.refresh(`${base}/${activeId}`).catch(() => undefined);
            await conversations.refresh().catch(() => undefined);
          }
        }
        return;
      }
      setError(
        accepted
          ? "Your message was accepted, but the stream was interrupted. Reload the conversation before continuing."
          : cause instanceof Error
            ? cause.message
            : "Could not send. Your message is retained.",
      );
    } finally {
      if (abort.current === controller) abort.current = null;
      setStreaming(false);
      setBusy(false);
    }
  };
  const confirmWrites = (value: boolean) => {
    if (!value) {
      void patch({ writeEnabled: false });
      return;
    }
    Alert.alert(
      "Allow business actions?",
      "hAI will be able to propose changes to your records, such as creating or updating invoices, quotes and transactions. Each change is shown to you first, and nothing is saved or sent until you approve it here.",
      [
        { text: "Cancel", style: "cancel", onPress: () => setToggleKey((key) => key + 1) },
        { text: "Allow", onPress: () => void patch({ writeEnabled: true }) },
      ],
      { cancelable: true, onDismiss: () => setToggleKey((key) => key + 1) },
    );
  };
  const confirmDelete = () =>
    Alert.alert(
      "Delete this conversation?",
      "The conversation and its messages will be permanently deleted.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void request(`${base}/${selected}`, {
              method: "DELETE",
              version: detail.data?.updatedAt,
            })
              .then(() => {
                setSelected("");
                void conversations.refresh();
              })
              .catch((cause) => setError(String(cause)));
          },
        },
      ],
    );
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
              abort.current?.abort();
              setSelected("");
              setAnswer("");
              setTools([]);
              setDecisions({});
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
                  {!streaming &&
                    (detail.data.pendingApprovals ?? []).map((approval) => (
                      <ApprovalCard
                        key={approval.approvalId}
                        approval={approval}
                        decision={decisions[approval.approvalId]}
                        disabled={busy}
                        onDecide={(approved) => decide(approval, approved)}
                      />
                    ))}
                </Group>
                <Group title="Conversation settings">
                  <Toggle
                    key={toggleKey}
                    label="Allow confirmed business actions"
                    value={detail.data.writeEnabled}
                    onChange={confirmWrites}
                  />
                  <Copy variant="caption" muted>
                    Each change hAI proposes waits for your approval before anything is saved or
                    sent.
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
                  <Action title="Delete conversation" secondary onPress={confirmDelete} />
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
        {streaming ? (
          <Action title="Stop" secondary onPress={() => abort.current?.abort()} />
        ) : (
          <Action
            title="Send message"
            busy={busy}
            disabled={!text.trim()}
            onPress={() => void send()}
          />
        )}
        {notice ? (
          <Copy variant="caption" muted>
            {notice}
          </Copy>
        ) : null}
      </Group>
      {(error || detail.error || conversations.error) && (
        <ErrorNotice message={error || detail.error || conversations.error!} />
      )}
    </Screen>
  );
}
function ApprovalCard({
  approval,
  decision,
  disabled,
  onDecide,
}: {
  approval: PendingApproval;
  decision: boolean | undefined;
  disabled: boolean;
  onDecide: (approved: boolean) => void;
}) {
  const theme = useTheme();
  const preview = approval.preview;
  const title = approvalTitle(approval);
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: theme.warning,
        backgroundColor: theme.warningTint,
        borderRadius: radius.md,
        padding: spacing.md,
        gap: spacing.xs,
      }}
    >
      <Copy variant="caption" muted>
        Needs your approval
      </Copy>
      <Copy variant="headline">{title}</Copy>
      {preview?.details.map((line, index) => (
        <Copy key={index} variant="caption">
          {line}
        </Copy>
      ))}
      {preview?.consequence ? <Copy>{preview.consequence}</Copy> : null}
      {preview?.caution ? (
        <Text style={{ fontSize: 14, fontWeight: "600", color: theme.text }}>
          {CAUTION_TEXT[preview.caution]}
        </Text>
      ) : null}
      {decision === undefined ? (
        <View style={{ gap: spacing.xs, paddingTop: spacing.xs }}>
          <Action title="Approve" disabled={disabled} onPress={() => onDecide(true)} />
          <Action title="Decline" secondary disabled={disabled} onPress={() => onDecide(false)} />
        </View>
      ) : (
        <Copy variant="caption" muted>
          {decision ? "Approved." : "Declined."} Decide the other changes to continue.
        </Copy>
      )}
    </View>
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
