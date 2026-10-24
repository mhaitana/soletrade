import "server-only";
import { z } from "zod";
import { getDataClient } from "@/server/infrastructure/db/client";
import type { Database } from "@/server/infrastructure/db/types";
import { unwrap, unwrapMaybe, unwrapVoid } from "@/server/infrastructure/db/helpers";
import { getMembershipRole, getWorkspace } from "@/server/foundation/workspaces";
import { can, type Permission } from "@/lib/domain/permissions";
import { getInstalledModules } from "@/server/foundation/module-installations";
import type { ModuleKey } from "@/config/modules";
import { branded } from "@/types/ids";
import { getMobilePreferences } from "@/server/application/mobile/account";

type Delivery = Database["public"]["Tables"]["mobile_push_deliveries"]["Row"];
type Job = Database["public"]["Tables"]["mobile_notification_outbox"]["Row"];
type Notification = Database["public"]["Tables"]["notifications"]["Row"];
type Device = Database["public"]["Tables"]["mobile_devices"]["Row"];
const SEND_URL = "https://exp.host/--/api/v2/push/send";
const RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const SEND_LIMIT = 100;
const MAX_SEND_ATTEMPTS = 8;
const MAX_RECEIPT_ATTEMPTS = 48;
const RECEIPT_DELAY = 15 * 60_000;
const RECEIPT_RETENTION = 24 * 3_600_000;
const STALE_WORKER = 5 * 60_000;
const tokenSchema = z
  .string()
  .max(250)
  .regex(/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/);
const resultSchema = z.object({
  status: z.enum(["ok", "error"]),
  id: z.string().min(1).max(200).optional(),
  details: z.object({ error: z.string().max(80).optional() }).optional(),
});
const receiptResponse = z.object({
  data: z.record(z.string(), resultSchema),
  errors: z.array(z.unknown()).optional(),
});

/** Quiet hours use the device's current IANA timezone, including daylight savings. */
export function inQuietHours(
  start: number,
  end: number,
  timezone: string,
  now = new Date(),
): boolean {
  if (start === end) return false;
  return quietHour(
    start,
    end,
    Number(
      new Intl.DateTimeFormat("en-AU", {
        timeZone: timezone,
        hour: "numeric",
        hourCycle: "h23",
      }).format(now),
    ),
  );
}
function quietHour(start: number, end: number, hour: number) {
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}
function afterQuietHours(start: number, end: number, timezone: string, now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-AU", {
    timeZone: timezone,
    hour: "numeric",
    hourCycle: "h23",
  });
  // Search real instants rather than adding local hours, which is wrong over DST changes.
  for (
    let time = Math.ceil(now.getTime() / 60_000) * 60_000;
    time <= now.getTime() + 27 * 3_600_000;
    time += 60_000
  ) {
    if (!quietHour(start, end, Number(formatter.format(new Date(time)))))
      return new Date(time).toISOString();
  }
  throw new Error("Unable to resolve device quiet hours");
}
function backoff(attempt: number, base = 30_000) {
  return Math.min(3_600_000, base * 2 ** Math.min(Math.max(attempt - 1, 0), 10));
}
function later(delay: number) {
  return new Date(Date.now() + delay).toISOString();
}
function headers() {
  return {
    "content-type": "application/json",
    accept: "application/json",
    ...(process.env.EXPO_ACCESS_TOKEN
      ? { authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` }
      : {}),
  };
}
function pathFor(notification: Notification) {
  if (notification.type.startsWith("workspace.transfer.") || notification.type.startsWith("legal."))
    return "/legal";
  if (notification.entity_id && z.uuid().safeParse(notification.entity_id).success) {
    if (notification.entity_type === "invoice")
      return `/resource/invoices/${notification.entity_id}`;
    if (notification.entity_type === "quote") return `/resource/quotes/${notification.entity_id}`;
  }
  return "/resource/notifications";
}
function requiredAccess(
  notification: Notification,
): { permission: Permission; module?: ModuleKey }[] {
  const type = notification.type.toLowerCase();
  const entity = notification.entity_type?.toLowerCase() ?? "";
  const access: { permission: Permission; module?: ModuleKey }[] = [
    { permission: "view:workspace" },
  ];
  if (type.startsWith("invoice") || entity === "invoice")
    access.push({ permission: "view:invoice", module: "invoices" });
  if (type.startsWith("quote") || entity === "quote")
    access.push({ permission: "view:quote", module: "quotes" });
  if (
    /^(books|receipt)/.test(type) ||
    ["book_transaction", "transaction", "receipt_extraction", "receipt"].includes(entity)
  )
    access.push({ permission: "view:books", module: "books" });
  if (
    /^(drive|mileage|vehicle)/.test(type) ||
    ["drive_earning", "drive_expense", "drive_trip", "vehicle_expense", "trip", "vehicle"].includes(
      entity,
    )
  )
    access.push({ permission: "view:drive", module: "drive" });
  if (
    /^(billing|credit|refund|subscription)/.test(type) ||
    ["billing", "credit", "subscription"].includes(entity)
  )
    access.push({ permission: "view:billing" });
  if (entity === "customer") access.push({ permission: "view:customer" });
  if (entity === "audit") access.push({ permission: "view:audit" });
  return access;
}
async function activeDevices(userId: string): Promise<Device[]> {
  const rows: Device[] = [];
  for (let offset = 0; offset <= 1000; offset += 100) {
    const page = await unwrap(
      getDataClient()
        .from("mobile_devices")
        .select("*")
        .eq("user_id", userId)
        .eq("enabled", true)
        .order("id")
        .range(offset, offset + 99),
    );
    rows.push(...page);
    if (page.length < 100) return rows;
  }
  throw new Error("Device registration limit exceeded");
}
async function context(job: Job) {
  const db = getDataClient(),
    userId = branded<"UserId">(job.user_id),
    workspaceId = branded<"WorkspaceId">(job.workspace_id);
  const [role, workspace, prefs, notification, profile, modules, devices] = await Promise.all([
    getMembershipRole(workspaceId, userId),
    getWorkspace(workspaceId),
    getMobilePreferences(userId),
    unwrapMaybe(
      db
        .from("notifications")
        .select("*")
        .eq("id", job.notification_id)
        .eq("user_id", userId)
        .eq("workspace_id", workspaceId)
        .maybeSingle(),
    ),
    unwrapMaybe(db.from("users").select("id,deleted_at").eq("id", userId).maybeSingle()),
    getInstalledModules(workspaceId),
    activeDevices(userId),
  ]);
  if (
    !role ||
    !workspace ||
    workspace.deletedAt ||
    !profile ||
    profile.deleted_at ||
    !notification ||
    notification.read_at ||
    !prefs.notificationCategories.includes(job.category)
  )
    return null;
  if (
    requiredAccess(notification).some(
      (access) =>
        !can(role, access.permission) || (access.module && !modules.includes(access.module)),
    )
  )
    return null;
  if (notification.type.startsWith("workspace.transfer.")) {
    if (!notification.entity_id) return null;
    const transfer = await unwrapMaybe(
      db
        .from("workspace_ownership_transfers")
        .select("id")
        .eq("id", notification.entity_id)
        .eq("workspace_id", workspaceId)
        .eq("to_user_id", userId)
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString())
        .maybeSingle(),
    );
    if (!transfer) return null;
  }
  return { notification, prefs, devices };
}
async function save(row: Delivery, patch: Partial<Delivery>) {
  await unwrapVoid(
    getDataClient()
      .from("mobile_push_deliveries")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", row.id),
  );
}
async function invalidateRegistration(row: Delivery) {
  // The row ID alone is insufficient: logout/login and token rotation can reuse it.
  await unwrapVoid(
    getDataClient()
      .from("mobile_devices")
      .update({ enabled: false, updated_at: new Date().toISOString() })
      .eq("id", row.device_id)
      .eq("user_id", row.user_id)
      .eq("token", row.token)
      .eq("updated_at", row.registration_updated_at),
  );
}
async function finishJob(outboxId: string, ownsClaim = false) {
  const db = getDataClient();
  const rows = await unwrap(
    db.from("mobile_push_deliveries").select("*").eq("outbox_id", outboxId),
  );
  if (rows.some((r) => r.status === "sending")) return;
  const pending = rows.filter((r) => r.status === "pending" || r.status === "deferred");
  const status = pending.length
    ? "pending"
    : rows.some((r) => r.status === "uncertain")
      ? "uncertain"
      : rows.some((r) => r.status === "failed")
        ? "failed"
        : rows.some((r) => r.status === "accepted" || r.status === "delivered")
          ? "complete"
          : "skipped";
  const next = pending.map((r) => r.next_attempt_at).sort()[0];
  let update = db
    .from("mobile_notification_outbox")
    .update({
      status,
      ...(next ? { next_attempt_at: next } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", outboxId);
  if (!ownsClaim) update = update.neq("status", "sending");
  await unwrapVoid(update);
}
async function skipJob(job: Job, code: string) {
  const db = getDataClient();
  await unwrapVoid(
    db
      .from("mobile_push_deliveries")
      .update({ status: "skipped", error_code: code, updated_at: new Date().toISOString() })
      .eq("outbox_id", job.id)
      .in("status", ["pending", "deferred"]),
  );
  await unwrapVoid(
    db
      .from("mobile_notification_outbox")
      .update({ status: "skipped", error_code: code, updated_at: new Date().toISOString() })
      .eq("id", job.id),
  );
}
async function retrySend(row: Delivery, code: string, delay?: number) {
  await save(row, {
    status: row.attempts >= MAX_SEND_ATTEMPTS ? "failed" : "pending",
    error_code: code,
    next_attempt_at: later(delay ?? backoff(row.attempts)),
  });
}
function retryAfter(response: Response, attempt: number) {
  const raw = response.headers.get("retry-after");
  let delay = raw
    ? /^\d+$/.test(raw)
      ? Number(raw) * 1000
      : new Date(raw).getTime() - Date.now()
    : 0;
  if (!Number.isFinite(delay)) delay = 0;
  return Math.max(backoff(attempt), Math.min(3_600_000, delay));
}

async function send(rows: Delivery[], job: Job, notification: Notification) {
  const latest = await context(job);
  if (!latest) {
    for (const row of rows)
      await save(row, { status: "skipped", error_code: "RECIPIENT_NO_LONGER_ELIGIBLE" });
    return 0;
  }
  const eligible: Delivery[] = [];
  for (const row of rows) {
    const device = latest.devices.find(
      (device) =>
        device.id === row.device_id &&
        device.token === row.token &&
        device.updated_at === row.registration_updated_at,
    );
    if (!device) {
      await save(row, { status: "skipped", error_code: "DEVICE_REGISTRATION_CHANGED" });
      continue;
    }
    if (inQuietHours(latest.prefs.quietHoursStart, latest.prefs.quietHoursEnd, device.timezone)) {
      await save(row, {
        status: "deferred",
        attempts: Math.max(0, row.attempts - 1),
        next_attempt_at: afterQuietHours(
          latest.prefs.quietHoursStart,
          latest.prefs.quietHoursEnd,
          device.timezone,
        ),
      });
      continue;
    }
    eligible.push(row);
  }
  rows = eligible;
  if (!rows.length) return 0;
  notification = latest.notification;
  let response: Response;
  try {
    response = await fetch(SEND_URL, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(
        rows.map((row) => ({
          to: row.token,
          title: "Soletrade",
          body: "There is an update in your business workspace.",
          sound: "default",
          channelId: "important",
          collapseId: notification.id,
          tag: notification.id,
          data: {
            notificationId: notification.id,
            workspaceId: job.workspace_id,
            category: job.category,
            path: pathFor(notification),
          },
        })),
      ),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    // Expo has no request idempotency key. A lost response may already be accepted.
    for (const row of rows)
      await save(row, { status: "uncertain", error_code: "SEND_OUTCOME_UNKNOWN" });
    return 0;
  }
  if (!response.ok) {
    for (const row of rows) {
      if (response.status === 429 || response.status >= 500)
        await retrySend(row, `HTTP_${response.status}`, retryAfter(response, row.attempts));
      else await save(row, { status: "failed", error_code: `HTTP_${response.status}` });
    }
    return 0;
  }
  let tickets: unknown[];
  try {
    const raw = (await response.json()) as { data?: unknown };
    if (!Array.isArray(raw?.data)) throw new Error();
    tickets = raw.data;
  } catch {
    for (const row of rows)
      await save(row, { status: "uncertain", error_code: "INVALID_TICKET_RESPONSE" });
    return 0;
  }
  const ids = tickets.flatMap((ticket) => {
    const parsed = resultSchema.safeParse(ticket);
    return parsed.success && parsed.data.status === "ok" && parsed.data.id ? [parsed.data.id] : [];
  });
  let accepted = 0;
  for (const [index, row] of rows.entries()) {
    const parsed = resultSchema.safeParse(tickets[index]);
    if (!parsed.success) {
      await save(row, { status: "uncertain", error_code: "INVALID_TICKET_RESPONSE" });
      continue;
    }
    const ticket = parsed.data;
    if (ticket.status === "ok") {
      if (!ticket.id || ids.filter((id) => id === ticket.id).length !== 1) {
        await save(row, { status: "uncertain", error_code: "INVALID_TICKET_ID" });
        continue;
      }
      await save(row, {
        status: "accepted",
        ticket_id: ticket.id,
        accepted_at: new Date().toISOString(),
        receipt_status: "pending",
        receipt_poll_after: later(RECEIPT_DELAY),
        error_code: null,
      });
      accepted++;
      continue;
    }
    const code = ticket.details?.error ?? "PUSH_REJECTED";
    if (code === "DeviceNotRegistered") await invalidateRegistration(row);
    if (code === "MessageRateExceeded") await retrySend(row, code);
    else await save(row, { status: "failed", error_code: code });
  }
  return accepted;
}
async function pollReceipts() {
  const db = getDataClient(),
    now = new Date().toISOString();
  let checked = 0,
    confirmed = 0;
  const due = await unwrap(
    db
      .from("mobile_push_deliveries")
      .select("*")
      .eq("status", "accepted")
      .eq("receipt_status", "pending")
      .lte("receipt_poll_after", now)
      .order("receipt_poll_after")
      .limit(100),
  );
  const claimed: Delivery[] = [];
  for (const row of due) {
    if (
      !row.accepted_at ||
      Date.now() - new Date(row.accepted_at).getTime() >= RECEIPT_RETENTION ||
      row.receipt_attempts >= MAX_RECEIPT_ATTEMPTS
    ) {
      await save(row, {
        status: "uncertain",
        receipt_status: "unknown",
        error_code: "RECEIPT_UNAVAILABLE",
      });
      continue;
    }
    const changed = await unwrap(
      db
        .from("mobile_push_deliveries")
        .update({
          receipt_status: "polling",
          receipt_attempts: row.receipt_attempts + 1,
          updated_at: now,
        })
        .eq("id", row.id)
        .eq("receipt_status", "pending")
        .eq("status", "accepted")
        .select("*"),
    );
    if (changed[0]) claimed.push(changed[0]);
  }
  if (!claimed.length) {
    for (const outboxId of new Set(due.map((r) => r.outbox_id))) await finishJob(outboxId);
    return { checked, confirmed };
  }
  let records: Record<string, z.infer<typeof resultSchema>> | null = null;
  let failure = "RECEIPT_PROVIDER_UNAVAILABLE";
  let permanent = false;
  try {
    const response = await fetch(RECEIPTS_URL, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ ids: claimed.map((r) => r.ticket_id) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) {
      const parsed = receiptResponse.safeParse(await response.json());
      if (parsed.success && !parsed.data.errors?.length) records = parsed.data.data;
      else failure = "INVALID_RECEIPT_RESPONSE";
    } else {
      failure = `RECEIPT_HTTP_${response.status}`;
      permanent = response.status !== 429 && response.status < 500;
    }
  } catch {
    /* Safe to retry receipt reads; this never re-sends the notification. */
  }
  for (const row of claimed) {
    checked++;
    const receipt = row.ticket_id ? records?.[row.ticket_id] : undefined;
    if (receipt?.status === "ok") {
      await save(row, { status: "delivered", receipt_status: "ok", error_code: null });
      confirmed++;
    } else if (receipt?.status === "error") {
      const code = receipt.details?.error ?? "PUSH_RECEIPT_ERROR";
      if (code === "DeviceNotRegistered") await invalidateRegistration(row);
      await save(row, { status: "failed", receipt_status: "error", error_code: code });
    } else if (permanent) {
      await save(row, { status: "uncertain", receipt_status: "unknown", error_code: failure });
    } else {
      await save(row, {
        receipt_status: "pending",
        receipt_poll_after: later(backoff(row.receipt_attempts, 60_000)),
        error_code: records ? "RECEIPT_NOT_READY" : failure,
      });
    }
  }
  for (const outboxId of new Set(due.map((r) => r.outbox_id))) await finishJob(outboxId);
  return { checked, confirmed };
}

/** Best effort provider acceptance + durable receipt reconciliation; receipts do not prove device display. */
export async function deliverMobilePush() {
  const db = getDataClient(),
    now = new Date().toISOString(),
    stale = new Date(Date.now() - STALE_WORKER).toISOString();
  // A terminated send may have reached Expo. Do not turn it into an automatic duplicate.
  await unwrapVoid(
    db
      .from("mobile_push_deliveries")
      .update({ status: "uncertain", error_code: "WORKER_SEND_OUTCOME_UNKNOWN", updated_at: now })
      .eq("status", "sending")
      .lt("updated_at", stale),
  );
  await unwrapVoid(
    db
      .from("mobile_push_deliveries")
      .update({ receipt_status: "pending", updated_at: now })
      .eq("status", "accepted")
      .eq("receipt_status", "polling")
      .lt("updated_at", stale),
  );
  await unwrapVoid(
    db
      .from("mobile_notification_outbox")
      .update({ status: "pending", updated_at: now })
      .eq("status", "sending")
      .lt("updated_at", stale),
  );
  const receipts = await pollReceipts();
  const jobs = await unwrap(
    db
      .from("mobile_notification_outbox")
      .select("*")
      .eq("status", "pending")
      .lte("next_attempt_at", now)
      .order("created_at")
      .limit(25),
  );
  let accepted = 0,
    budget = SEND_LIMIT;
  for (const job of jobs) {
    const claimed = await unwrap(
      db
        .from("mobile_notification_outbox")
        .update({ status: "sending", updated_at: now })
        .eq("id", job.id)
        .eq("status", "pending")
        .select("id"),
    );
    if (!claimed.length) continue;
    try {
      const initial = await context(job);
      if (!initial) {
        await skipJob(job, "RECIPIENT_NO_LONGER_ELIGIBLE");
        continue;
      }
      if (!initial.devices.length) {
        await skipJob(job, "NO_REGISTERED_DEVICES");
        continue;
      }
      await unwrapVoid(
        db.from("mobile_push_deliveries").upsert(
          initial.devices.map((device) => ({
            outbox_id: job.id,
            user_id: job.user_id,
            device_id: device.id,
            token: device.token,
            registration_updated_at: device.updated_at,
            status: "pending" as const,
            next_attempt_at: now,
          })),
          { onConflict: "outbox_id,device_id", ignoreDuplicates: true },
        ),
      );
      // Re-read the inbox and authorization just before delivery. A queued notification
      // is not a durable grant to data after read, membership or module revocation.
      const current = await context(job);
      if (!current) {
        await skipJob(job, "RECIPIENT_NO_LONGER_ELIGIBLE");
        continue;
      }
      const candidates = await unwrap(
        db
          .from("mobile_push_deliveries")
          .select("*")
          .eq("outbox_id", job.id)
          .in("status", ["pending", "deferred"])
          .lte("next_attempt_at", new Date().toISOString())
          .order("created_at")
          .limit(100),
      );
      const batch: Delivery[] = [];
      for (const row of candidates) {
        const device = current.devices.find((d) => d.id === row.device_id);
        if (!device) {
          await save(row, { status: "skipped", error_code: "DEVICE_UNREGISTERED" });
          continue;
        }
        if (!tokenSchema.safeParse(device.token).success) {
          await save(row, { status: "failed", error_code: "INVALID_PUSH_TOKEN" });
          continue;
        }
        try {
          if (
            inQuietHours(
              current.prefs.quietHoursStart,
              current.prefs.quietHoursEnd,
              device.timezone,
            )
          ) {
            await save(row, {
              status: "deferred",
              next_attempt_at: afterQuietHours(
                current.prefs.quietHoursStart,
                current.prefs.quietHoursEnd,
                device.timezone,
              ),
              error_code: null,
            });
            continue;
          }
        } catch {
          await save(row, { status: "failed", error_code: "INVALID_TIMEZONE" });
          continue;
        }
        if (row.attempts >= MAX_SEND_ATTEMPTS) {
          await save(row, { status: "failed", error_code: "SEND_RETRIES_EXHAUSTED" });
          continue;
        }
        if (budget <= 0) {
          await save(row, { next_attempt_at: later(60_000) });
          continue;
        }
        const changed = await unwrap(
          db
            .from("mobile_push_deliveries")
            .update({
              status: "sending",
              attempts: row.attempts + 1,
              token: device.token,
              registration_updated_at: device.updated_at,
              updated_at: new Date().toISOString(),
            })
            .eq("id", row.id)
            .in("status", ["pending", "deferred"])
            .select("*"),
        );
        if (changed[0]) {
          batch.push(changed[0]);
          budget--;
        }
      }
      if (batch.length) accepted += await send(batch, job, current.notification);
      await finishJob(job.id, true);
    } catch {
      // Persisted sending rows remain uncertain on stale-worker recovery. Pending and
      // deferred rows can safely resume after an infrastructure failure.
      const attempts = job.attempts + 1;
      await unwrapVoid(
        db
          .from("mobile_notification_outbox")
          .update({
            status: attempts >= MAX_SEND_ATTEMPTS ? "failed" : "pending",
            attempts,
            error_code: "DELIVERY_WORKER_FAILED",
            next_attempt_at: later(backoff(attempts)),
            updated_at: new Date().toISOString(),
          })
          .eq("id", job.id),
      );
    }
  }
  return { accepted, delivered: receipts.confirmed, receiptsChecked: receipts.checked };
}
