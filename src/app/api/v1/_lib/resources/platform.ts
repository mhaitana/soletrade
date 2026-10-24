import { z } from "zod";
import { branded } from "@/shared/types/ids";
import * as customers from "@/platform/customers";
import {
  checkVersion,
  createOnce,
  found,
  gate,
  id,
  keyset,
  keysetPage,
  missing,
  notes,
  offset,
  page,
  parse,
  splitBody,
  text,
  type Context,
  type Method,
  type Query,
} from "./common";
const customerSchema = z
  .object({
    name: text,
    email: z.email().max(320).nullable().optional(),
    phone: z.string().trim().max(60).nullable().optional(),
    company: z.string().trim().max(280).nullable().optional(),
    notes,
  })
  .strict();
const roles = z.enum(["admin", "manager", "accountant", "employee", "readonly"]);
export async function readPlatform(
  ctx: Context,
  p: string[],
  q: Query,
): Promise<unknown | Response> {
  const w = ctx.workspaceId;
  switch (p[0]) {
    case "customers": {
      await gate(ctx, "view:customer");
      if (p.length === 1)
        return page(
          await customers.listCustomers(w, {
            search: q.search,
            limit: q.limit + 1,
            offset: offset(q),
          }),
          q,
        );
      const customer = found(await customers.getCustomer(w, branded<"CustomerId">(id(p[1]))));
      if (p.length === 2) return customer;
      if (p.length === 3 && p[2] === "timeline")
        return (await import("./overview")).customerTimeline(ctx, customer, q);
      return missing();
    }
    case "files":
      return (await import("./files")).readFiles(ctx, p.slice(1), q);
    case "activity": {
      if (p.length !== 1) return missing();
      await gate(ctx, "view:activity");
      const svc = await import("@/platform/activity");
      const before = keyset(q);
      return keysetPage(
        await svc.listActivity(w, {
          limit: q.limit,
          before: before ? { ...before, id: branded<"ActivityEventId">(before.id) } : undefined,
          entityType: q.entityType,
          entityId: q.entityId,
          types: q.type ? [q.type] : undefined,
        }),
      );
    }
    case "audit": {
      if (p.length !== 1) return missing();
      await gate(ctx, "view:audit");
      const svc = await import("@/platform/audit");
      const before = keyset(q);
      return keysetPage(
        await svc.listAudit(w, {
          limit: q.limit,
          before: before ? { ...before, id: branded<"AuditLogId">(before.id) } : undefined,
          actionPrefix: q.actionPrefix,
          targetType: q.targetType,
        }),
      );
    }
    case "notifications": {
      await gate(ctx, "view:workspace");
      const svc = await import("@/platform/notifications/store");
      if (p.length === 2 && p[1] === "count")
        return { count: await svc.unreadCount(w, ctx.user.id) };
      if (p.length !== 1) return missing();
      const before = keyset(q);
      return keysetPage(
        await svc.listNotifications(w, ctx.user.id, {
          limit: q.limit,
          unreadOnly: q.unreadOnly === "true",
          before: before ? { ...before, id: branded<"NotificationId">(before.id) } : undefined,
        }),
      );
    }
    case "members": {
      await gate(ctx, "view:member");
      const svc = await import("@/platform/members");
      const rows = await svc.listMembers(w);
      if (p.length === 2) return found(rows.find((m) => m.userId === id(p[1])));
      if (p.length !== 1) return missing();
      return page(rows.slice(offset(q), offset(q) + q.limit + 1), q);
    }
    case "invitations": {
      await gate(ctx, "invite:member");
      if (p.length !== 1) return missing();
      const svc = await import("@/platform/members");
      return page(
        (await svc.listPendingInvitations(w)).slice(offset(q), offset(q) + q.limit + 1),
        q,
      );
    }
    case "settings": {
      if (p.length !== 1) return missing();
      await gate(ctx, "view:workspace");
      return found(await (await import("@/platform/workspaces")).getWorkspace(w));
    }
    case "dashboard": {
      if (p.length !== 1) return missing();
      await gate(ctx, "view:workspace");
      return (await import("./overview")).dashboard(ctx, q);
    }
    case "search": {
      if (p.length !== 1) return missing();
      await gate(ctx, "view:workspace");
      return (await import("./overview")).search(ctx, q);
    }
    case "assistant": {
      if (p[1] !== "conversations") return missing();
      await gate(ctx, "view:workspace");
      const svc = await import("@/platform/ai/conversations");
      if (p.length === 2) {
        const rows = await svc.listConversations(w, ctx.user.id, {
          limit: q.limit + 1,
          offset: offset(q),
        });
        return page(rows, q);
      }
      if (p.length === 3)
        return found(
          await svc.getConversation(w, ctx.user.id, branded<"AiConversationId">(id(p[2]))),
        );
      return missing();
    }
    default:
      return missing();
  }
}
export async function writePlatform(
  ctx: Context,
  p: string[],
  method: Method,
  body: unknown,
): Promise<unknown | Response> {
  const { data, expectedVersion } = splitBody(body);
  const w = ctx.workspaceId;
  switch (p[0]) {
    case "customers": {
      await gate(
        ctx,
        method === "POST" && p.length === 1
          ? "create:customer"
          : method === "DELETE"
            ? "delete:customer"
            : "update:customer",
      );
      if (p.length === 1 && method === "POST") {
        const input = parse(customerSchema, data);
        return createOnce(
          ctx,
          (v) => customers.getCustomer(w, branded<"CustomerId">(v)),
          (v) =>
            customers.createCustomer(
              w,
              input,
              ctx.user.id,
              v ? branded<"CustomerId">(v) : undefined,
            ),
        );
      }
      if (p.length !== 2) return missing();
      const key = branded<"CustomerId">(id(p[1]));
      checkVersion(found(await customers.getCustomer(w, key)), expectedVersion);
      if (method === "PATCH") {
        const input = parse(customerSchema.partial(), data);
        await customers.updateCustomer(w, key, input, ctx.user.id, expectedVersion);
        return found(await customers.getCustomer(w, key));
      }
      if (method === "DELETE") {
        parse(z.object({}).strict(), data);
        await customers.deleteCustomer(w, key, ctx.user.id);
        return { deleted: true };
      }
      return missing();
    }
    case "files":
      return (await import("./files")).writeFiles(ctx, p.slice(1), method, data);
    case "notifications": {
      await gate(ctx, "view:workspace");
      parse(z.object({}).strict(), data);
      const svc = await import("@/platform/notifications/store");
      if (method !== "POST") return missing();
      if (p.length === 2 && p[1] === "read-all")
        return { count: await svc.markAllRead(w, ctx.user.id) };
      if (p.length === 3 && p[2] === "read") {
        if (!(await svc.markRead(w, ctx.user.id, branded<"NotificationId">(id(p[1])))))
          return missing();
        return { read: true };
      }
      return missing();
    }
    case "members": {
      await gate(ctx, "manage:member");
      if (p.length !== 2) return missing();
      const svc = await import("@/platform/members");
      const key = branded<"UserId">(id(p[1]));
      if (method === "DELETE") {
        parse(z.object({}).strict(), data);
        if (key === ctx.user.id)
          throw new (await import("@/platform/mobile/http")).MobileApiError(
            "conflict",
            "You cannot remove yourself.",
            409,
          );
        await svc.removeMember(w, key, ctx.user.id);
        return { deleted: true };
      }
      if (method === "PATCH") {
        const input = parse(z.object({ role: roles }).strict(), data);
        await svc.updateMemberRole(w, key, input.role, ctx.user.id);
        return found((await svc.listMembers(w)).find((m) => m.userId === key));
      }
      return missing();
    }
    case "invitations": {
      await gate(ctx, p.length === 1 ? "invite:member" : "manage:member");
      const svc = await import("@/platform/members");
      if (p.length === 1 && method === "POST") {
        const input = parse(z.object({ email: z.email().max(320), role: roles }).strict(), data);
        return svc.inviteMember(
          w,
          input.email,
          input.role,
          ctx.user.id,
          ctx.operationId ? branded<"WorkspaceInvitationId">(id(ctx.operationId)) : undefined,
        );
      }
      const key = branded<"WorkspaceInvitationId">(id(p[1]));
      parse(z.object({}).strict(), data);
      if (p.length === 2 && method === "DELETE") {
        await svc.revokeInvitation(w, key, ctx.user.id);
        return { deleted: true };
      }
      if (p.length === 3 && p[2] === "resend" && method === "POST")
        return found(await svc.resendInvitation(w, key, ctx.user.id));
      return missing();
    }
    case "settings": {
      await gate(ctx, "update:workspace");
      if (p.length !== 1 || method !== "PATCH") return missing();
      const svc = await import("@/platform/workspaces");
      const row = found(await svc.getWorkspace(w));
      checkVersion(row, expectedVersion);
      const { paymentMethodsSchema } = await import("@/shared/types/payment-methods");
      const input = parse(
        z
          .object({
            name: z.string().trim().min(1).max(120),
            defaultCurrency: z.string().regex(/^[A-Z]{3}$/),
            invoicePrefix: z
              .string()
              .trim()
              .min(1)
              .max(20)
              .regex(/^[A-Za-z0-9-]+$/),
            quotePrefix: z
              .string()
              .trim()
              .min(1)
              .max(20)
              .regex(/^[A-Za-z0-9-]+$/),
            timezone: z
              .string()
              .max(100)
              .refine((v) => {
                try {
                  Intl.DateTimeFormat("en", { timeZone: v });
                  return true;
                } catch {
                  return false;
                }
              }),
            fyStartMonth: z.number().int().min(1).max(12),
            paymentMethods: paymentMethodsSchema,
          })
          .partial()
          .strict(),
        data,
      );
      return found(
        await svc.updateWorkspace(
          w,
          {
            name: row.name,
            defaultCurrency: row.defaultCurrency,
            invoicePrefix: row.invoicePrefix,
            quotePrefix: row.quotePrefix,
            timezone: row.timezone,
            fyStartMonth: row.fyStartMonth,
            paymentMethods: row.paymentMethods,
            ...input,
          },
          ctx.user.id,
        ),
      );
    }
    case "assistant":
      return (await import("./assistant")).writeAssistant(ctx, p.slice(1), method, {
        ...data,
        ...(expectedVersion ? { expectedVersion } : {}),
      });
    default:
      return missing();
  }
}
