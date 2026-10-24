# Web server architecture

Server implementation stays inside the web application. Route handlers, Server Components,
and dedicated `"use server"` actions call these services; browser modules never import this
tree, including type-only imports. Public DTOs and pure calculations live in `src/lib/domain`.

| Layer            | Responsibility                                                                                                               | Allowed server dependencies               |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `infrastructure` | Database and provider adapters, environment, event bus, rendering and transport primitives                                   | Its own layer                             |
| `foundation`     | Shared customer, workspace, identity, billing, file, notification and conversation services                                  | Foundation and infrastructure             |
| `domains`        | Books, Drive, Invoices and Quotes operations and document definitions                                                        | Own domain, foundation and infrastructure |
| `application`    | Request context, authorization, assistant tools, mobile API orchestration, webhook dispatch, cron and cross-domain use cases | All server layers                         |

Server code never imports `src/app`, `src/features`, or browser application composition.
Foundation dependencies must remain acyclic. Product domains do not import sibling domains;
cross-domain orchestration belongs in `application`. Non-transactional side effects use the event
bus. Financial mirrors remain enforced by database transactions and triggers.

Resolve workspace identity and authorization on the server before mutations. Preserve
`server-only` boundaries, and expose client-callable actions only through dedicated
`"use server"` modules in their owning feature.
