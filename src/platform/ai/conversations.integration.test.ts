import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { count, eq, inArray } from "drizzle-orm";
import { getDb } from "@/server/db";
import {
  aiConversations,
  aiMessages,
  auditLogs,
  users as usersTable,
  workspaces as workspacesTable,
  workspaceMembers,
} from "@/server/db/schema";
import { branded, type AiConversationId, type WorkspaceId } from "@/shared/types/ids";
import { createWorkspace } from "@/platform/workspaces";
import {
  appendMessage,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  renameConversation,
  setConversationWriteEnabled,
} from "@/platform/ai";

/**
 * Integration tests for the AI conversations service against a real Postgres.
 *
 * Runs ONLY when DATABASE_URL is set (local Supabase / throwaway test DB). Without
 * it, `pnpm test:ci` skips this file so the unit suite stays green anywhere.
 *
 *   DATABASE_URL="postgresql://..." pnpm test:ci
 *
 * Focus: CRUD + IDOR. Every service function filters `workspaceId = ? AND userId =
 * ?` — these tests prove a member can't read or mutate another member's chats
 * (cross-user AND cross-workspace), and that deleting a conversation cascades its
 * messages. The tests create their own users + workspaces and clean up in afterAll.
 */
const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("ai conversations integration (requires DATABASE_URL)", () => {
  // Distinct UUIDs from every other integration test file (they hardcode user ids too).
  const actor = branded<"UserId">("00000000-0000-4000-8000-0000000000c1");
  const otherActor = branded<"UserId">("00000000-0000-4000-8000-0000000000c2");
  let ws1: WorkspaceId;
  let ws2: WorkspaceId;
  const createdConversationIds: AiConversationId[] = [];

  beforeAll(async () => {
    const db = getDb();
    await db.insert(usersTable).values([
      { id: actor, email: "ai-actor@soletrade-test.local", fullName: "AI Actor" },
      { id: otherActor, email: "ai-other@soletrade-test.local", fullName: "AI Other" },
    ]);
    ws1 = await createWorkspace(actor, "AI Test One", `ai-test-one-${Date.now()}`);
    ws2 = await createWorkspace(otherActor, "AI Test Two", `ai-test-two-${Date.now()}`);
  });

  afterAll(async () => {
    const db = getDb();
    const workspaceIds = [ws1!, ws2!].filter(Boolean) as WorkspaceId[];
    if (workspaceIds.length === 0) return;
    // Messages cascade from conversations, but clean both explicitly for safety.
    await db.delete(aiMessages).where(inArray(aiMessages.conversationId, createdConversationIds));
    await db.delete(aiConversations).where(inArray(aiConversations.workspaceId, workspaceIds));
    await db.delete(auditLogs).where(inArray(auditLogs.workspaceId, workspaceIds));
    await db.delete(workspaceMembers).where(inArray(workspaceMembers.workspaceId, workspaceIds));
    await db.delete(workspacesTable).where(inArray(workspacesTable.id, workspaceIds));
    await db.delete(usersTable).where(inArray(usersTable.id, [actor, otherActor]));
  });

  it("creates a conversation with the default title and lists it", async () => {
    const id = await createConversation(ws1!, actor);
    createdConversationIds.push(id);
    const list = await listConversations(ws1!, actor);
    expect(list.some((c) => c.id === id)).toBe(true);
    const found = list.find((c) => c.id === id)!;
    expect(found.title).toBe("New conversation");
  });

  it("appends user + assistant messages and loads them oldest-first", async () => {
    const id = await createConversation(ws1!, actor, "Cash chat");
    createdConversationIds.push(id);
    await appendMessage(ws1!, actor, id, { role: "user", content: "What's my cash position?" });
    await appendMessage(ws1!, actor, id, {
      role: "assistant",
      content: "Your net cash this month is $1,234.56.",
    });
    const conv = await getConversation(ws1!, actor, id);
    expect(conv).not.toBeNull();
    expect(conv!.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(conv!.messages[0]!.content).toBe("What's my cash position?");
  });

  it("returns null from getConversation for a missing id (no leak)", async () => {
    const missing = branded<"AiConversationId">("00000000-0000-4000-8000-0000000000f0");
    expect(await getConversation(ws1!, actor, missing)).toBeNull();
  });

  it("isolates conversations across users (no IDOR) — list + get", async () => {
    const id = await createConversation(ws1!, actor, "Private actor chat");
    createdConversationIds.push(id);
    await appendMessage(ws1!, actor, id, { role: "user", content: "secret" });

    // otherActor (same workspace, different user) must not see actor's conversation.
    const otherList = await listConversations(ws1!, otherActor);
    expect(otherList.find((c) => c.id === id)).toBeUndefined();
    expect(await getConversation(ws1!, otherActor, id)).toBeNull();
  });

  it("isolates conversations across workspaces (no IDOR)", async () => {
    const id = await createConversation(ws1!, actor, "WS1 chat");
    createdConversationIds.push(id);
    // From ws2 (actor isn't even a member) the conversation must be invisible.
    expect(await getConversation(ws2!, actor, id)).toBeNull();
    const ws2List = await listConversations(ws2!, actor);
    expect(ws2List.find((c) => c.id === id)).toBeUndefined();
  });

  it("rejects appendMessage targeting another user's conversation (IDOR-safe)", async () => {
    const id = await createConversation(ws1!, actor, "Actor only");
    createdConversationIds.push(id);
    await expect(
      appendMessage(ws1!, otherActor, id, { role: "user", content: "hijack" }),
    ).rejects.toThrow(/not found/i);

    // And the original conversation is untouched.
    const conv = await getConversation(ws1!, actor, id);
    expect(conv!.messages.length).toBe(0);
  });

  it("deleteConversation by another user is a no-op (does not delete the owner's row)", async () => {
    const id = await createConversation(ws1!, actor, "Delete guard");
    createdConversationIds.push(id);
    await deleteConversation(ws1!, otherActor, id); // filtered out, no error.
    expect(await getConversation(ws1!, actor, id)).not.toBeNull();
  });

  it("hard-deletes a conversation and cascades its messages", async () => {
    const db = getDb();
    const id = await createConversation(ws1!, actor, "Cascade target");
    await appendMessage(ws1!, actor, id, { role: "user", content: "bye" });
    await appendMessage(ws1!, actor, id, { role: "assistant", content: "ok" });

    // Confirm the messages exist.
    const [before] = await db
      .select({ n: count() })
      .from(aiMessages)
      .where(eq(aiMessages.conversationId, id));
    expect(before?.n).toBe(2);

    await deleteConversation(ws1!, actor, id);
    expect(await getConversation(ws1!, actor, id)).toBeNull();

    // Cascade: the messages are gone with the conversation.
    const [after] = await db
      .select({ n: count() })
      .from(aiMessages)
      .where(eq(aiMessages.conversationId, id));
    expect(after?.n).toBe(0);
  });

  it("renameConversation updates the title (owner only)", async () => {
    const id = await createConversation(ws1!, actor, "Old title");
    createdConversationIds.push(id);
    await renameConversation(ws1!, actor, id, "New title");
    const conv = await getConversation(ws1!, actor, id);
    expect(conv!.title).toBe("New title");
    // A rename by another user is a filtered no-op (the owner's title is preserved).
    await renameConversation(ws1!, otherActor, id, "Hijacked");
    const conv2 = await getConversation(ws1!, actor, id);
    expect(conv2!.title).toBe("New title");
  });

  it("setConversationWriteEnabled toggles the flag (owner only, IDOR-safe)", async () => {
    const id = await createConversation(ws1!, actor, "Write chat");
    createdConversationIds.push(id);
    // New conversations default to writeEnabled = false.
    const before = await getConversation(ws1!, actor, id);
    expect(before!.writeEnabled).toBe(false);
    // Owner can opt in.
    await setConversationWriteEnabled(ws1!, actor, id, true);
    const after = await getConversation(ws1!, actor, id);
    expect(after!.writeEnabled).toBe(true);
    // A toggle by another user is a filtered no-op (the owner's flag is preserved).
    await setConversationWriteEnabled(ws1!, otherActor, id, false);
    const after2 = await getConversation(ws1!, actor, id);
    expect(after2!.writeEnabled).toBe(true);
    // Owner can opt back out.
    await setConversationWriteEnabled(ws1!, actor, id, false);
    expect((await getConversation(ws1!, actor, id))!.writeEnabled).toBe(false);
  });
});
