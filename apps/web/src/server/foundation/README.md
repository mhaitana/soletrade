# Foundation services

Reusable backend services shared by product domains: identity, workspaces, membership,
customers, files, activity/audit, billing, module installations, notifications and conversations.

Import infrastructure, browser-safe domain contracts, and other foundation services through
explicit entrypoints. Do not import product domains, request/application orchestration, or UI.
Foundation-to-foundation dependencies must be acyclic.

Request cookies and redirects belong in `server/application/auth`. Provider-neutral billing
state belongs here so receipt extraction and native API responses share the same entitlement
source. Notification persistence belongs here; subscriptions, email delivery composition and
PDF attachment loading belong in `server/application/notifications`.
