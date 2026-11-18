import type { ModuleKey } from "@/config/modules";

export interface SetupStep {
  id: "workspace" | "module" | "customer" | "send";
  label: string;
  complete: boolean;
  /** Where the user completes this step; null when the step is already complete. */
  href: string | null;
  /** Link text for an incomplete step. */
  actionLabel: string | null;
}

export interface SetupChecklist {
  steps: SetupStep[];
  completed: number;
  total: number;
}

export interface SetupFlags {
  installedModules: readonly ModuleKey[];
  customerCount: number;
  /** Invoices + quotes that have left draft (sent, viewed, paid, accepted, ...). */
  sentDocumentCount: number;
}

/**
 * Build the dashboard's getting-started checklist from real workspace data. Returns `null`
 * once every step is complete so the dashboard can hide the card.
 */
export function buildSetupChecklist(flags: SetupFlags): SetupChecklist | null {
  const { installedModules } = flags;
  const hasModule = installedModules.length > 0;
  // Send the first document from whichever document module is on; otherwise enabling a module
  // is the prerequisite.
  const sendHref = installedModules.includes("invoices")
    ? "/invoices/new"
    : installedModules.includes("quotes")
      ? "/quotes/new"
      : "/settings/modules";

  // Customers and sending a document only apply to workspaces that bill people. A workspace
  // that runs just Books or Drive (a gig driver tracking earnings, say) would otherwise carry
  // two steps it can never tick, and the card would never go away. Before any module is
  // chosen the full list is shown, since the workspace has not decided what it is yet.
  const billsCustomers =
    !hasModule || installedModules.includes("invoices") || installedModules.includes("quotes");

  const steps: SetupStep[] = [
    {
      id: "workspace",
      label: "Create your workspace",
      complete: true,
      href: null,
      actionLabel: null,
    },
    {
      id: "module",
      label: "Enable your first module",
      complete: hasModule,
      href: hasModule ? null : "/settings/modules",
      actionLabel: hasModule ? null : "Enable a module",
    },
  ];
  if (billsCustomers) {
    steps.push(
      {
        id: "customer",
        label: "Add a customer",
        complete: flags.customerCount > 0,
        href: flags.customerCount > 0 ? null : "/customers/new",
        actionLabel: flags.customerCount > 0 ? null : "Add customer",
      },
      {
        id: "send",
        label: "Send your first invoice or quote",
        complete: flags.sentDocumentCount > 0,
        href: flags.sentDocumentCount > 0 ? null : sendHref,
        actionLabel: flags.sentDocumentCount > 0 ? null : "Get started",
      },
    );
  }
  const completed = steps.filter((s) => s.complete).length;
  if (completed === steps.length) return null;
  return { steps, completed, total: steps.length };
}
