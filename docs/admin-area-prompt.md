# Implement Soletrade Admin Area

You are working in the `soletrade` repository for **Soletrade**, a multi-tenant SaaS platform by **Matt Haitana**.

Implement a secure internal administration area for managing:

- Users
- Workspaces
- Workspace members
- Module subscriptions
- Billing
- Stripe promotions
- Account credits
- Support requests
- Temporary support access
- Audit logs
- Platform operations
- Feature configuration
- System health

The admin area must be designed as a protected internal product, not as a set of loosely secured application pages.

The implementation must follow the existing workspace-first architecture and `bulletproof-react` principles.

---

# 1. Core Principles

The admin area must follow these rules:

1. Admin access is separate from normal workspace access.
2. Every admin action must be authorised server-side.
3. Admins must not automatically gain access to customer business data.
4. Customer content may only be viewed when the customer grants explicit, time-limited support access.
5. Every sensitive action must create an immutable audit event.
6. Billing changes must go through dedicated billing services.
7. Stripe coupons and workspace credits must be treated as separate concepts.
8. Destructive actions must require confirmation and, where appropriate, re-authentication.
9. The admin area must never expose passwords, secrets, payment card data, private tokens, or raw authentication credentials.
10. Production administration must be safe, traceable, and reversible where possible.

---

# 2. Product Terminology

Use the following terms consistently:

| Concept | Preferred term |
|---|---|
| Public product | Soletrade |
| Company | Matt Haitana |
| Customer account | Workspace |
| Customer user | Member |
| Internal product operator | Admin |
| Customer assistance operator | Support agent |
| Temporary customer-approved access | Support access session |
| Billable capability | Module |
| Subscription discount | Promotion |
| Monetary account adjustment | Workspace credit |

Do not call temporary support access “impersonation” in customer-facing copy.

---

# 3. Admin Area Route Structure

Create a protected route group.

Suggested structure:

```text
src/app/(admin)/
├── admin/
│   ├── page.tsx
│   ├── users/
│   │   ├── page.tsx
│   │   └── [userId]/
│   │       └── page.tsx
│   ├── workspaces/
│   │   ├── page.tsx
│   │   └── [workspaceId]/
│   │       ├── page.tsx
│   │       ├── members/
│   │       ├── subscription/
│   │       ├── credits/
│   │       ├── support-access/
│   │       ├── activity/
│   │       └── audit/
│   ├── subscriptions/
│   │   ├── page.tsx
│   │   └── [subscriptionId]/
│   │       └── page.tsx
│   ├── promotions/
│   │   ├── page.tsx
│   │   ├── new/
│   │   └── [promotionId]/
│   ├── credits/
│   │   └── page.tsx
│   ├── support/
│   │   ├── page.tsx
│   │   └── [ticketId]/
│   ├── access-requests/
│   │   └── page.tsx
│   ├── audit/
│   │   └── page.tsx
│   ├── feature-flags/
│   │   └── page.tsx
│   ├── webhooks/
│   │   └── page.tsx
│   ├── jobs/
│   │   └── page.tsx
│   ├── system/
│   │   └── page.tsx
│   └── settings/
│       └── page.tsx
```

Do not place admin-only components inside customer workspace feature modules unless they are reusable domain components.

---

# 4. Recommended Feature Structure

Use a dedicated platform feature.

```text
src/platform/admin/
├── api/
├── components/
├── hooks/
├── permissions/
├── schemas/
├── services/
├── types/
├── utils/
└── index.ts
```

Add related domain features where appropriate:

```text
src/platform/support/
src/platform/audit/
src/platform/promotions/
src/platform/credits/
```

The admin UI may depend on platform services.

Customer-facing modules must not depend on the admin feature.

---

# 5. Admin Roles and Permissions

Implement explicit internal roles.

```ts
type AdminRole =
  | 'super_admin'
  | 'operations_admin'
  | 'billing_admin'
  | 'support_manager'
  | 'support_agent'
  | 'security_auditor'
  | 'read_only_admin';
```

## Super Admin

Can:

- Manage internal staff
- Assign admin roles
- Configure platform-wide settings
- Manage emergency access
- Manage billing configuration
- Manage feature flags
- Review all audit activity

## Operations Admin

Can:

- Manage users and workspaces
- Suspend or restore accounts
- Manage module access
- Review jobs, webhooks, and system health
- Trigger approved operational retries

Cannot:

- View customer content without support approval
- Change internal staff roles
- Access secrets

## Billing Admin

Can:

- View subscription and invoice status
- Apply workspace credits
- Create promotions
- Update subscription modules
- Review refunds and payment failures
- Reconcile billing records

Cannot:

- View customer business content
- Access support sessions unless separately authorised

## Support Manager

Can:

- Manage support tickets
- Request customer-approved access
- Assign support agents
- Revoke active support access
- Review support audit history

## Support Agent

Can:

- Work assigned support tickets
- Request temporary support access
- Use customer-approved support sessions
- Add internal support notes

Cannot:

- Grant access to themselves
- Apply credits above a configured threshold
- Change subscription prices
- View unrelated workspaces

## Security Auditor

Can:

- Review audit logs
- Review access requests
- Review security events
- Export approved audit reports

Cannot mutate customer or billing data.

## Read-Only Admin

Can view non-sensitive operational metadata only.

---

# 6. Admin Authentication and Security

Admin access must require stronger controls than normal application access.

Implement:

- Dedicated admin authorisation middleware
- Server-side role checks
- Multi-factor authentication support
- Recent-login requirement for sensitive actions
- Session timeout
- Device/session visibility
- Admin session revocation
- IP and user-agent audit metadata
- Rate limiting
- CSRF protection where applicable
- Secure cookie configuration
- No admin role trust based only on client state

Never infer admin privileges from an email domain alone.

Store explicit internal staff records and role assignments.

Suggested tables:

```text
admin_users
admin_role_assignments
admin_sessions
admin_security_events
```

---

# 7. Admin Dashboard

Create an operational dashboard containing useful platform information.

Suggested cards:

- Total active workspaces
- Active paid workspaces
- Trial workspaces
- Monthly recurring revenue
- Annual recurring revenue
- Failed payments
- Past-due subscriptions
- Active support tickets
- Pending support access requests
- Active support access sessions
- Recent refunds
- Recent credits
- Failed Stripe webhooks
- Failed background jobs
- New users
- Module adoption
- Workspaces at risk of cancellation

Avoid vanity metrics that do not support operational decisions.

Add date filters and compare-period support where practical.

---

# 8. User Management

Create a searchable user list.

Search and filter by:

- Name
- Email
- User ID
- Workspace name
- Workspace ID
- Account state
- Signup date
- Last active date
- Subscription status
- Enabled modules
- Support ticket status

The user detail screen should show:

## Account information

- Name
- Email
- Account status
- Email verification status
- Created date
- Last active date
- Authentication providers
- User-owned workspaces
- Workspace memberships
- Internal notes
- Recent security events

## Allowed without support access

Admins may view operational account metadata required to manage the service, including:

- Identity and contact details
- Workspace membership
- Subscription state
- Enabled modules
- Usage totals
- Account status
- Support ticket history
- Billing identifiers
- Non-content technical logs

Admins must not view customer-created business content without explicit support access.

Restricted content includes:

- Customer records
- Quotes
- Invoices
- Receipts
- Bookkeeping entries
- Mileage entries
- Uploaded files
- Notes
- AI conversations
- Customer contact history
- Workspace business documents

## Account actions

Implement permission-controlled actions:

- Resend verification email
- Revoke user sessions
- Suspend user
- Restore user
- Remove user from a workspace
- Transfer workspace ownership
- Review workspace memberships
- Add an internal note
- Open a support request
- Request support access
- Initiate account deletion workflow
- Initiate data export workflow

Do not allow permanent deletion from a simple button.

---

# 9. Workspace Management

The workspace detail screen should show:

- Workspace name
- Workspace ID
- Owner
- Members
- Member roles
- Account status
- Enabled modules
- Subscription
- Billing interval
- Renewal date
- Stripe customer ID
- Stripe subscription ID
- Current balance
- Credit ledger
- Promotion history
- Invoice history
- Support tickets
- Active access grants
- Recent activity
- Audit history
- Usage summaries
- Storage usage
- Notification delivery status
- Integration status

Allowed workspace actions:

- Suspend workspace
- Restore workspace
- Add or remove modules
- Schedule module cancellation
- Correct subscription state after Stripe reconciliation
- Apply workspace credit
- Attach a promotion
- Remove a promotion where allowed
- Resend billing communications
- Start data export
- Start account closure workflow
- Request customer-approved support access

Every mutation must require:

- Admin permission
- Reason
- Confirmation
- Audit event

---

# 10. Subscription Management

Create a unified subscription administration area.

Show:

- Workspace
- Stripe customer
- Stripe subscription
- Subscription status
- Billing interval
- Billing anchor
- Enabled modules
- Anchor module
- Add-on modules
- Price per item
- Discounts
- Credits
- Tax status
- Renewal date
- Cancellation state
- Payment failures
- Recent invoices
- Recent refunds

Actions:

- Add module
- Remove module
- Schedule module removal
- Change billing interval
- Preview proration
- Retry failed payment
- Resend invoice
- Open Stripe-hosted invoice
- Apply promotion
- Remove promotion
- Apply credit
- Issue refund
- Correct subscription metadata
- Re-sync from Stripe

Do not directly mutate local subscription state without corresponding Stripe reconciliation.

Stripe remains the external billing source of truth.

The local database remains the application access and audit source of truth.

---

# 11. Promotions and Stripe Coupons

Create a promotion management area.

Important distinction:

- Use Stripe coupons and promotion codes for discounts.
- Use workspace credit for monetary account adjustments.
- Do not misuse coupons as an account credit system.

## Supported promotion types

- Percentage discount
- Fixed amount discount
- First payment discount
- Repeating discount
- Forever discount
- Module-specific discount
- Billing-interval-specific discount
- New-customer-only discount
- Limited redemption promotion
- Expiring promotion

## Promotion fields

```ts
type Promotion = {
  id: string;
  name: string;
  internalDescription?: string;
  publicCode?: string;
  stripeCouponId: string;
  stripePromotionCodeId?: string;
  discountType: 'percentage' | 'fixed_amount';
  percentOff?: number;
  amountOffCents?: number;
  currency?: string;
  duration: 'once' | 'repeating' | 'forever';
  durationInMonths?: number;
  maxRedemptions?: number;
  redeemBy?: Date;
  appliesToModules?: ModuleKey[];
  appliesToIntervals?: Array<'month' | 'year'>;
  newCustomersOnly: boolean;
  active: boolean;
};
```

Admin capabilities:

- Create Stripe coupon
- Create optional public promotion code
- Disable promotion code
- Set redemption limits
- Set expiry
- Restrict eligible modules
- Restrict billing intervals
- Restrict to new customers
- Assign promotion directly to a workspace
- View redemption history
- View estimated revenue impact
- Duplicate an existing promotion

Require preview and confirmation before Stripe creation.

After a Stripe coupon is created, treat immutable Stripe fields as immutable in the UI.

Where fields cannot safely be edited, require creating a replacement promotion.

---

# 12. Workspace Credits

Build credits as a ledger, not a mutable balance field.

Suggested ledger entry types:

```ts
type CreditLedgerEntryType =
  | 'support_adjustment'
  | 'service_interruption'
  | 'billing_correction'
  | 'retention_credit'
  | 'promotional_credit'
  | 'refund_conversion'
  | 'manual_adjustment'
  | 'credit_applied'
  | 'credit_reversed'
  | 'credit_expired';
```

Each credit entry must contain:

```ts
type CreditLedgerEntry = {
  id: string;
  workspaceId: string;
  amountCents: number;
  currency: string;
  type: CreditLedgerEntryType;
  reason: string;
  internalNote?: string;
  relatedTicketId?: string;
  relatedInvoiceId?: string;
  stripeReference?: string;
  createdByAdminId: string;
  createdAt: Date;
  expiresAt?: Date;
  reversedEntryId?: string;
};
```

Credit workflow:

1. Admin selects workspace.
2. Admin enters amount.
3. Admin selects reason.
4. Admin adds internal explanation.
5. System previews resulting balance.
6. System warns about currency mismatch.
7. Higher-value credits require elevated approval.
8. Credit is applied through the billing service.
9. Local ledger entry is created.
10. Stripe customer balance or equivalent invoice credit is updated.
11. Workspace owner receives notification where appropriate.
12. Audit event is created.

Do not silently edit or delete credit entries.

Corrections must use reversing ledger entries.

Suggested approval thresholds should be configurable.

Example:

```text
Support agent: up to $25
Support manager: up to $100
Billing admin: up to $500
Super admin: above $500
```

Do not hard-code these values. Store them in configuration.

---

# 13. Support Ticket Management

Implement a basic support system or integration-ready abstraction.

Support ticket fields:

```ts
type SupportTicket = {
  id: string;
  workspaceId?: string;
  requesterUserId: string;
  assignedAdminId?: string;
  subject: string;
  description: string;
  category:
    | 'account'
    | 'billing'
    | 'invoices'
    | 'books'
    | 'drive'
    | 'quotes'
    | 'technical'
    | 'security'
    | 'other';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status:
    | 'open'
    | 'waiting_for_support'
    | 'waiting_for_customer'
    | 'resolved'
    | 'closed';
  createdAt: Date;
  updatedAt: Date;
  resolvedAt?: Date;
};
```

Support features:

- Assign ticket
- Add internal notes
- Add customer-visible replies
- Request logs
- Request screenshots
- Request support access
- Link billing adjustments
- Link credit entries
- Link refunds
- Link audit events
- Track resolution time
- Add tags
- Escalate to billing, engineering, or security

---

# 14. Customer-Approved Support Access

Implement explicit, scoped, time-limited support access.

By default, admins and support agents must not be able to view workspace content.

## Support access request

A support agent must provide:

- Support ticket
- Workspace
- Reason for access
- Requested data scope
- Requested access level
- Requested duration
- Specific support agent or support team
- Optional customer-facing explanation

Suggested scopes:

```ts
type SupportAccessScope =
  | 'workspace_settings'
  | 'customers'
  | 'invoices'
  | 'quotes'
  | 'books'
  | 'drive'
  | 'files'
  | 'activity'
  | 'integrations'
  | 'technical_logs';
```

Suggested access levels:

```ts
type SupportAccessLevel =
  | 'metadata_only'
  | 'read_only'
  | 'guided_write';
```

Default to `read_only`.

`guided_write` must require a second, explicit approval and must be limited to the exact support action required.

## Customer approval flow

The workspace owner receives:

- In-app notification
- Email notification
- Name or support identity of the requester
- Support ticket reference
- Reason
- Requested scopes
- Requested duration
- Exact expiry
- Whether the access is read-only
- Approve action
- Reject action
- Adjust duration option
- Adjust scope option

Suggested durations:

- 15 minutes
- 30 minutes
- 1 hour
- 4 hours
- 8 hours
- 24 hours

Allow a custom duration subject to a configurable maximum.

The user must be able to:

- Approve
- Reject
- Reduce scope
- Reduce duration
- Revoke access immediately
- View active support sessions
- View past support sessions
- View what records were accessed

## Support access session

Suggested schema:

```ts
type SupportAccessSession = {
  id: string;
  requestId: string;
  workspaceId: string;
  ticketId: string;
  approvedByUserId: string;
  adminUserId: string;
  scopes: SupportAccessScope[];
  accessLevel: SupportAccessLevel;
  reason: string;
  startsAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
  revokedByUserId?: string;
  status:
    | 'pending'
    | 'approved'
    | 'active'
    | 'expired'
    | 'revoked'
    | 'rejected';
};
```

## Enforcement rules

- Access must be enforced server-side on every request.
- Access expires automatically.
- Expired sessions must not be refreshable without new approval.
- A support agent may only use sessions assigned to them.
- Support access does not grant billing-admin permissions.
- Support access does not expose authentication secrets.
- Support access does not expose full card details.
- Support access does not expose API secrets or OAuth tokens.
- File downloads must be individually logged.
- Exporting bulk customer data must remain blocked.
- Access from support sessions must be visually indicated.
- The support agent must see a persistent countdown timer.
- The customer must be able to revoke the session at any time.

## Audit requirements

Record:

- Request created
- Request delivered
- Request approved
- Request rejected
- Scope modified
- Duration modified
- Session started
- Page viewed
- Sensitive entity viewed
- File opened
- Approved mutation performed
- Session revoked
- Session expired

Provide a customer-visible access history.

---

# 15. Support Session UI

When a support agent enters an approved workspace:

Show a persistent banner:

```text
Temporary support access

You are viewing this workspace with customer-approved access.
Read-only access expires in 42 minutes.
```

Include:

- Ticket reference
- Approved scopes
- Expiry countdown
- Exit session action
- Link to access policy
- Clear read-only indicators

Use a visually distinct admin shell.

Never make the session indistinguishable from the customer’s normal workspace.

Do not use the customer’s personal identity as though the admin were logged in as them.

---

# 16. Emergency Access

Add an optional break-glass process for genuine security or platform emergencies.

This must not be part of normal support work.

Requirements:

- Restricted to designated senior roles
- Requires written reason
- Requires re-authentication
- Requires secondary approval where technically possible
- Very short duration
- Limited scope
- Immediate security notification
- Customer notification unless prohibited by an active security investigation or platform policy
- Complete audit trail
- Mandatory post-access review

Do not implement an unrestricted “View as user” button.

---

# 17. Audit Log

Create an immutable admin audit log.

Suggested event structure:

```ts
type AdminAuditEvent = {
  id: string;
  actorAdminId: string;
  actorRole: AdminRole;
  action: string;
  targetType: string;
  targetId: string;
  workspaceId?: string;
  userId?: string;
  ticketId?: string;
  reason?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
};
```

Audit these actions:

- User suspension
- User restoration
- Session revocation
- Workspace suspension
- Workspace restoration
- Ownership transfer
- Subscription change
- Module change
- Promotion creation
- Promotion assignment
- Credit creation
- Credit reversal
- Refund
- Support access request
- Support access approval
- Support data access
- Feature flag change
- Webhook replay
- Background job retry
- Admin role change
- Export request
- Account deletion action

Audit logs must:

- Be append-only
- Be searchable
- Be filterable
- Support export for authorised roles
- Redact secrets
- Preserve meaningful before/after state
- Not be editable through the UI

---

# 18. Feature Flags and Module Controls

Add feature flag management.

Support:

- Global flags
- Environment-specific flags
- Percentage rollout
- Workspace allowlist
- Workspace blocklist
- User allowlist
- Module-specific flags
- Beta flags
- Emergency kill switches

Suggested use cases:

- New invoice editor
- AI receipt scanning
- Drive CSV import
- Quote templates
- New billing experience
- Experimental reports

Every production flag change must be audited.

High-impact flags should require confirmation.

---

# 19. Stripe Webhook Operations

Add a Stripe webhook operations screen.

Show:

- Event type
- Stripe event ID
- Received time
- Processing state
- Attempts
- Error
- Related workspace
- Related subscription
- Related invoice
- Processed time

Actions:

- View sanitised payload
- Retry processing
- Reconcile related subscription
- Mark investigated
- Link support ticket

Do not permit arbitrary payload editing.

Webhook retries must be idempotent.

---

# 20. Background Jobs

Add a background job operations area.

Include:

- Job name
- Queue
- Status
- Attempts
- Run time
- Error
- Workspace
- Related entity
- Created time
- Completed time

Actions:

- Retry safe job
- Cancel pending job
- View sanitised input
- View error
- Link support ticket

Jobs that may create duplicate financial transactions must not be blindly retried.

Require idempotency keys and domain-specific retry protection.

---

# 21. Platform Health

Add a system health page.

Suggested checks:

- Database connectivity
- Redis connectivity
- Stripe connectivity
- Email provider
- SMS provider
- Object storage
- AI providers
- Background job processor
- Webhook queue
- Scheduled jobs
- Error rate
- API latency
- Failed login rate
- Storage usage
- Database migration version

Do not display secrets or complete provider credentials.

---

# 22. Notification and Email Operations

Add an email and notification operations page.

Show:

- Delivery status
- Template
- Recipient
- Workspace
- Provider ID
- Attempt count
- Error
- Sent date
- Delivered date
- Open or click state where available and appropriate

Actions:

- Retry failed message
- Preview template
- Send test message
- Disable problematic template
- Link support ticket

Add central template management only if templates are already designed to be safely editable.

Do not allow arbitrary executable template code.

---

# 23. Data Export and Deletion Operations

Add controlled workflows for:

- Workspace data export
- User data export
- Workspace closure
- User account deletion
- Retention hold
- Deletion cancellation
- Deletion completion

Require:

- Identity verification
- Reason
- Confirmation
- Audit entry
- Background job
- Download expiry
- Notification
- Failure handling

Do not expose direct database deletion controls.

---

# 24. Internal Notes

Allow authorised admins to add internal notes to:

- Users
- Workspaces
- Subscriptions
- Support tickets
- Billing adjustments

Internal notes must:

- Be clearly marked as internal
- Record author and timestamp
- Be auditable
- Not be visible to customers
- Avoid unnecessary sensitive information
- Support correction through an appended note, not silent editing

---

# 25. Additional Recommended Admin Features

Implement or prepare architecture for the following.

## Platform analytics

- Module adoption
- Trial conversion
- Module conversion funnel
- Subscription upgrades
- Subscription downgrades
- Churn
- Failed payments
- Promotion performance
- Credit usage
- Quote-to-invoice conversion
- Receipt processing success
- Active usage by module

## Risk and abuse monitoring

- Suspicious login patterns
- Repeated payment failures
- Excessive public invoice requests
- Excessive file uploads
- Unusual support access activity
- Repeated failed permissions
- High-volume email or SMS usage
- Potential promotion abuse

## Configuration management

- Module availability
- Default module settings
- Country availability
- Currency availability
- Tax settings
- Upload limits
- Support access maximum duration
- Credit approval thresholds
- Email sender settings
- SMS limits
- AI usage limits

## Customer communication

- Targeted in-app announcements
- Maintenance notices
- Product update messages
- Module-specific announcements
- Trial ending messages
- Service incident communication

Announcements should support workspace targeting and scheduling.

## Integration status

- Stripe
- Email
- SMS
- Storage
- AI
- OAuth integrations
- Accounting integrations
- Calendar integrations

## Release visibility

- Current application version
- Latest deployment
- Migration status
- Active feature flags
- Known incident banner
- Rollback reference

---

# 26. Database Tables

Create or extend tables similar to:

```text
admin_users
admin_role_assignments
admin_sessions
admin_security_events
admin_audit_events
admin_internal_notes

support_tickets
support_ticket_messages
support_ticket_assignments
support_access_requests
support_access_sessions
support_access_events

promotions
promotion_assignments
promotion_redemptions

billing_credit_ledger
billing_adjustment_approvals

feature_flags
feature_flag_rules
feature_flag_audit_events

webhook_events
background_jobs
platform_incidents
admin_announcements
```

Every applicable table should include:

```text
id
created_at
updated_at
created_by
```

Use soft deletion only where it does not undermine audit integrity.

Audit, credit, and support-access history should not be soft-deleted through normal application flows.

---

# 27. API and Service Boundaries

Create dedicated services.

Suggested functions:

```ts
requestSupportAccess();
approveSupportAccess();
rejectSupportAccess();
revokeSupportAccess();
validateSupportAccessSession();

createPromotion();
createStripeCoupon();
createStripePromotionCode();
assignPromotionToWorkspace();
disablePromotion();

issueWorkspaceCredit();
reverseWorkspaceCredit();
calculateWorkspaceCreditBalance();

updateWorkspaceSubscription();
previewSubscriptionChange();
reconcileSubscriptionFromStripe();

suspendUser();
restoreUser();
suspendWorkspace();
restoreWorkspace();

writeAdminAuditEvent();
```

Do not place billing, support-access, or permission logic directly inside React components.

---

# 28. Event System

Emit typed platform events.

Examples:

```text
AdminUserSuspended
AdminUserRestored
AdminWorkspaceSuspended
AdminWorkspaceRestored
AdminSubscriptionChanged
PromotionCreated
PromotionAssigned
WorkspaceCreditIssued
WorkspaceCreditReversed
SupportTicketCreated
SupportAccessRequested
SupportAccessApproved
SupportAccessRejected
SupportAccessStarted
SupportAccessRevoked
SupportAccessExpired
FeatureFlagChanged
WebhookRetried
BackgroundJobRetried
```

Events should feed:

- Audit logs
- Activity history
- Notifications
- Operational analytics
- Security monitoring

---

# 29. UI and UX Requirements

The admin area should be:

- Clean
- Dense enough for operational work
- Searchable
- Keyboard accessible
- Responsive
- Clearly distinct from the customer app
- Safe for high-impact actions
- Consistent with Soletrade branding

Required patterns:

- Confirmation modals
- Reason fields
- Before/after previews
- Read-only defaults
- Risk labels
- Status badges
- Empty states
- Loading states
- Error states
- Pagination
- Filtering
- Sortable tables
- Saved filters where practical
- Copyable IDs
- Links to related entities

Sensitive actions should not rely on colour alone.

---

# 30. Security Requirements

Implement and test:

- Server-side admin permission checks
- Workspace isolation
- Support session scope enforcement
- Support session expiry
- Support session revocation
- Audit log integrity
- Rate limiting
- Re-authentication for sensitive actions
- No secret exposure
- No raw payment data
- No unrestricted impersonation
- No cross-workspace support access
- No bulk export through support sessions
- Idempotent Stripe operations
- Idempotent webhook retry
- Credit approval thresholds
- Promotion validation
- Sanitised logs and payloads

Use Zod validation on every mutation boundary.

---

# 31. Implementation Phases

## Phase 1 — Admin Foundation

Implement:

- Admin route group
- Admin authentication
- Internal roles
- Permission helpers
- Admin shell
- Admin dashboard
- Audit service
- Basic user and workspace search

Acceptance criteria:

- Only authorised internal users can access `/admin`.
- Permissions are enforced server-side.
- Admin actions create audit events.
- Customer users cannot access admin routes.

## Phase 2 — Users and Workspaces

Implement:

- User list and detail
- Workspace list and detail
- Member visibility
- Suspension and restoration
- Internal notes
- Session revocation
- Workspace ownership tools

Acceptance criteria:

- Admins can manage account metadata.
- Restricted customer content remains inaccessible.
- Sensitive actions require a reason and confirmation.

## Phase 3 — Billing and Subscriptions

Implement:

- Subscription list
- Subscription detail
- Module management
- Proration preview
- Stripe reconciliation
- Invoice visibility
- Refund workflow

Acceptance criteria:

- Subscription changes use the billing service.
- Stripe and local state remain reconciled.
- All billing changes are audited.

## Phase 4 — Promotions and Credits

Implement:

- Stripe coupon management
- Promotion code management
- Promotion assignment
- Credit ledger
- Credit approval thresholds
- Credit reversal

Acceptance criteria:

- Coupons and credits are separate systems.
- Credit balances derive from ledger entries.
- High-value credits require elevated approval.
- All Stripe mutations are traceable.

## Phase 5 — Support Tickets

Implement:

- Ticket list
- Ticket detail
- Assignment
- Customer-visible replies
- Internal notes
- Ticket linking

Acceptance criteria:

- Support work is tied to a ticket.
- Billing adjustments and access requests can reference a ticket.

## Phase 6 — Temporary Support Access

Implement:

- Access request flow
- Customer approval UI
- Scope and duration selection
- Read-only support session
- Countdown banner
- Automatic expiry
- Immediate revocation
- Customer-visible history
- Access audit events

Acceptance criteria:

- Admins cannot view customer content without approval.
- Approved access is scoped and time limited.
- The customer can revoke access instantly.
- Every accessed sensitive entity is logged.
- Expired access cannot be reused.

## Phase 7 — Operations

Implement:

- Webhook operations
- Background job operations
- Platform health
- Notification delivery
- Feature flags

Acceptance criteria:

- Safe jobs and webhooks can be retried.
- Financial operations remain idempotent.
- Feature flag changes are audited.

## Phase 8 — Hardening

Implement:

- MFA enforcement
- Re-authentication
- Rate limiting
- Security-event monitoring
- Permission tests
- Support-access tests
- Stripe integration tests
- Playwright admin tests
- Accessibility review

Acceptance criteria:

- No known admin privilege escalation path.
- No unrestricted customer-content access.
- Sensitive actions are fully audited.
- Critical flows have automated tests.

---

# 32. Testing Requirements

Add unit tests for:

- Admin permissions
- Role inheritance
- Credit balance calculation
- Credit approval thresholds
- Promotion validation
- Support access expiry
- Support access scope checks
- Support access revocation
- Subscription preview
- Stripe reconciliation
- Webhook idempotency

Add integration tests for:

- User suspension
- Workspace suspension
- Credit issuance
- Credit reversal
- Promotion creation
- Subscription change
- Support access approval
- Support access expiry
- Support access rejection
- Support access revocation

Add Playwright tests for:

- Admin login
- User search
- Workspace search
- Subscription management
- Credit application
- Promotion creation
- Support access request
- Customer approval
- Read-only support session
- Customer revocation
- Audit history

---

# 33. Acceptance Criteria

The admin area is complete when:

1. Internal staff have explicit admin roles.
2. Admin routes are protected server-side.
3. Users and workspaces can be searched and managed.
4. Subscription and module states can be reviewed.
5. Stripe coupons and promotion codes can be created safely.
6. Workspace credit uses an append-only ledger.
7. Credit and promotion systems are separate.
8. Support agents cannot view customer business data by default.
9. Customers can approve scoped, time-limited support access.
10. Customers can reduce scope and duration.
11. Customers can revoke active support access immediately.
12. Support sessions expire automatically.
13. Sensitive access is logged.
14. Customers can view support access history.
15. Billing changes are reconciled with Stripe.
16. Sensitive admin actions require reasons.
17. Audit records are immutable.
18. Feature flag changes are audited.
19. Safe webhook and job retries are supported.
20. TypeScript, linting, unit tests, integration tests, and Playwright tests pass.

---

# 34. Deliverables

After implementation, provide:

1. Summary of the admin architecture
2. Database migrations
3. Admin roles and permission matrix
4. Routes added
5. Services added
6. Stripe changes
7. Support access design
8. Credit ledger design
9. Tests added
10. Security controls
11. Manual setup requirements
12. Environment variables
13. Known limitations
14. Recommended next implementation phase

Do not implement a simple unrestricted admin panel.

Build a secure operations platform with explicit permissions, customer-approved support access, auditable billing controls, and safe production workflows.
