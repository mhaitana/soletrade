import { z } from "zod";

export const moduleKeySchema = z.enum(["invoices", "books", "drive", "quotes"]);
export type MobileModule = z.infer<typeof moduleKeySchema>;
export const workspaceRoleSchema = z.enum([
  "owner",
  "admin",
  "manager",
  "accountant",
  "employee",
  "readonly",
]);
export type MobileRole = z.infer<typeof workspaceRoleSchema>;

export interface ApiErrorBody {
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
  requestId?: string;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  idempotencyKey?: string;
  version?: string;
}

export type MobileRequest = <T = unknown>(path: string, options?: RequestOptions) => Promise<T>;

export interface MobileWorkspace {
  workspaceId: string;
  name: string;
  slug: string;
  role: MobileRole;
}

export interface MobileBilling {
  provider: "stripe" | "apple" | "google" | null;
  status: string;
  paidThrough: string | null;
  interval?: "monthly" | "annual" | null;
  renews?: boolean;
  pendingModules?: MobileModule[] | null;
  pendingInterval?: "monthly" | "annual" | null;
}

export interface MobileBootstrap {
  user: { id: string; email: string; fullName: string | null };
  workspaces: MobileWorkspace[];
  activeWorkspace: null | {
    id: string;
    name: string;
    role: MobileRole;
    modules: MobileModule[];
    capabilities: string[];
    settings: Record<string, unknown>;
    billing: MobileBilling;
    unreadCount: number;
  };
  preferences: MobilePreferences;
}

export interface MobilePreferences {
  routeSyncEnabled: boolean;
  quietHoursStart: number;
  quietHoursEnd: number;
  notificationCategories: string[];
}

export interface CollectionPage<T> {
  items: T[];
  nextCursor?: string | null;
}

export interface MobileFeatureProps {
  userId: string;
  workspaceId: string;
  request: MobileRequest;
  onSaved?: () => void;
}

export const DEFAULT_MOBILE_PREFERENCES: MobilePreferences = {
  routeSyncEnabled: false,
  quietHoursStart: 22,
  quietHoursEnd: 7,
  notificationCategories: ["payments", "quotes", "receipts", "reminders"],
};

export const mobilePreferencesSchema = z.object({
  routeSyncEnabled: z.boolean(),
  quietHoursStart: z.number().int().min(0).max(23),
  quietHoursEnd: z.number().int().min(0).max(23),
  notificationCategories: z.array(z.enum(["payments", "quotes", "receipts", "reminders"])).max(4),
});

export const uuidSchema = z.uuid();
export const dateSchema = z.iso.datetime({ offset: true });
export const centsSchema = z.number().int().safe();
export const distanceSchema = z.number().int().nonnegative().safe();

export const mobileStoreIntentSchema = z
  .object({
    workspaceId: uuidSchema,
    provider: z.enum(["apple", "google"]),
    offerKey: z.string().min(1).max(200),
    operationId: uuidSchema,
  })
  .strict();
export const mobileStoreIntentCancelSchema = z
  .object({ workspaceId: uuidSchema, intentId: uuidSchema })
  .strict();
export interface MobileStoreIntent {
  intentId: string;
}

export const mobileHealthReportSchema = z
  .object({
    events: z
      .array(
        z
          .object({
            eventId: uuidSchema,
            kind: z.enum(["sync_failure", "recording_interruption"]),
            reason: z.enum(["retryable", "blocked", "interrupted", "permission"]),
            platform: z.enum(["ios", "android"]),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();
export type MobileHealthEvent = z.infer<typeof mobileHealthReportSchema>["events"][number];
