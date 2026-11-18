import "server-only";
import { env } from "@/server/infrastructure/config/env";
import { sendEmail } from "@/server/infrastructure/email";
import { forEachSettled } from "@/server/infrastructure/for-each-settled";
import { getWorkspace } from "@/server/foundation/workspaces/index";
import { getInstalledModules } from "@/server/foundation/module-installations/index";
import { createNotification } from "@/server/foundation/notifications/store";
import {
  claimDueDigests,
  releaseDigestClaim,
  type DigestClaim,
} from "@/server/foundation/notifications/digest-preferences";
import { collectInsightFacts } from "@/server/application/insights/facts";
import { briefingDigestEmail } from "@/server/application/notifications/templates";
import { composeBriefing } from "@/lib/domain/insights/briefing";
import type { WorkspaceId } from "@/types/ids";

/**
 * Briefing digest job runner. Pure runner - no HTTP - so it's unit-testable directly. The
 * cron route (`/api/cron/assistant-digest`) calls this every hour after verifying the
 * CRON_SECRET.
 *
 * Each run claims members who turned the digest on and are owed one: it is 07:00 or later
 * in their workspace's timezone and they have not been picked yet today (daily) or this
 * Monday (weekly). The claim marks them in the database before anything is sent, so a
 * repeated or overlapping run finds nobody left to send to. For each claimed member it
 * reads that member's own facts, sends nothing if there is nothing to report, and otherwise
 * adds an in-app notification and then emails the same facts. No model is called.
 */

/** Members claimed per database call, and how many of them are handled at once. */
const DIGEST_BATCH = 25;
const DIGEST_CONCURRENCY = 5;
/** The most calls one run makes: up to 200 members an hour; the rest wait for the next. */
const DIGEST_MAX_BATCHES = 8;
/**
 * A run stops claiming after this long. A member is marked before they are sent to, so a
 * run cut off by the platform's time limit would lose that batch's digests for the period.
 */
const DIGEST_TIME_BUDGET_MS = 40_000;

export interface DigestRunResult {
  /** Members picked for this period. */
  claimed: number;
  /** Members who got an in-app notification. */
  sent: number;
  /** Of those, how many were also emailed. */
  emailed: number;
  /** Members with nothing to report, who were sent nothing. */
  skipped: number;
  /** Members whose digest could not be built or saved. */
  failed: number;
}

type DigestWorkspace = {
  workspace: Awaited<ReturnType<typeof getWorkspace>>;
  installedModules: Awaited<ReturnType<typeof getInstalledModules>>;
};

export async function runAssistantDigestJob(now: Date = new Date()): Promise<DigestRunResult> {
  const result: DigestRunResult = { claimed: 0, sent: 0, emailed: 0, skipped: 0, failed: 0 };
  const startedAt = Date.now();
  // Several members of one workspace share its settings and modules: read them once a run.
  const workspaces = new Map<WorkspaceId, Promise<DigestWorkspace>>();
  const loadWorkspace = (workspaceId: WorkspaceId): Promise<DigestWorkspace> => {
    let loading = workspaces.get(workspaceId);
    if (!loading) {
      loading = Promise.all([getWorkspace(workspaceId), getInstalledModules(workspaceId)]).then(
        ([workspace, installedModules]) => ({ workspace, installedModules }),
      );
      workspaces.set(workspaceId, loading);
    }
    return loading;
  };

  for (let batch = 0; batch < DIGEST_MAX_BATCHES; batch += 1) {
    const claims = await claimDueDigests(now, DIGEST_BATCH);
    result.claimed += claims.length;
    // One member's failure must not cost the others their digest.
    const handled = await forEachSettled(
      claims,
      DIGEST_CONCURRENCY,
      "assistant.digest",
      async (claim) => {
        const outcome = await deliverDigest(claim, now, loadWorkspace);
        if (outcome === "skipped") result.skipped += 1;
        else {
          result.sent += 1;
          if (outcome === "emailed") result.emailed += 1;
        }
      },
    );
    result.failed += claims.length - handled;
    if (claims.length < DIGEST_BATCH) break;
    if (Date.now() - startedAt > DIGEST_TIME_BUDGET_MS) break;
  }
  return result;
}

/**
 * Build and send one member's digest. Returns what happened; throws when it could not be
 * built or the notification could not be saved.
 */
async function deliverDigest(
  claim: DigestClaim,
  now: Date,
  loadWorkspace: (workspaceId: WorkspaceId) => Promise<DigestWorkspace>,
): Promise<"skipped" | "notified" | "emailed"> {
  let workspaceName: string;
  let facts: Awaited<ReturnType<typeof collectInsightFacts>>;
  try {
    const { workspace, installedModules } = await loadWorkspace(claim.workspaceId);
    if (!workspace) throw new Error("Workspace not found.");
    workspaceName = workspace.name;
    // The facts are this member's own: their role decides which areas are included.
    facts = await collectInsightFacts(
      { workspaceId: claim.workspaceId, role: claim.role },
      { now, workspace, installedModules },
    );
  } catch (error) {
    // Nothing has been sent, so hand the claim back and let the next hourly run retry.
    await releaseDigestClaim(claim).catch((releaseError: unknown) => {
      console.error("[assistant.digest] could not release claim", releaseError);
    });
    throw error;
  }

  const briefing = composeBriefing(facts);
  if (briefing.empty) return "skipped";

  // From here the claim is kept even on failure: a notification that may have been saved
  // must not be followed by a second one on the next run.
  await createNotification({
    workspaceId: claim.workspaceId,
    userId: claim.userId,
    type: "assistant.digest",
    title: `Your ${claim.frequency} briefing`,
    body: briefing.headline,
  });

  // Email is best-effort. It never blocks the notification above or other members, and
  // when email is not configured the in-app notification is the whole digest.
  try {
    const email = briefingDigestEmail(
      { workspaceName, frequency: claim.frequency, facts },
      env.NEXT_PUBLIC_APP_URL,
    );
    const sent = await sendEmail({ to: claim.email, ...email });
    return sent.ok ? "emailed" : "notified";
  } catch (error) {
    console.warn("[assistant.digest] email failed", error);
    return "notified";
  }
}
