import "server-only";
import * as React from "react";
import { Flag } from "lucide-react";
import { requireAdminContext } from "@/platform/admin/services/admin-auth";
import { listFeatureFlags } from "@/platform/admin/services/admin-operations";
import {
  AdminPageHeader,
  StatusBadge,
  AdminTable,
  AdminTh,
  AdminTd,
  AdminTr,
  EmptyRow,
  Mono,
} from "@/platform/admin/components/admin-ui";
import { UpdateFlagDialog } from "./update-flag-dialog";

export default async function AdminFeatureFlagsPage() {
  await requireAdminContext("view:feature_flags");
  const flags = await listFeatureFlags();

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={Flag}
        title="Platform Feature Flags"
        subtitle="Global rollout toggles and tenant allowlists/blocklists (Phase 7)."
      />

      <AdminTable caption="Feature flags">
        <thead>
          <tr>
            <AdminTh>Flag Key</AdminTh>
            <AdminTh>Name</AdminTh>
            <AdminTh>Rollout %</AdminTh>
            <AdminTh>Allowlisted Workspaces</AdminTh>
            <AdminTh>Status</AdminTh>
            <AdminTh className="text-right">Actions</AdminTh>
          </tr>
        </thead>
        <tbody>
          {flags.length === 0 ? (
            <EmptyRow colSpan={6}>No feature flags configured.</EmptyRow>
          ) : (
            flags.map((flag) => (
              <AdminTr key={flag.id}>
                <AdminTd>
                  <Mono className="text-foreground">{flag.key}</Mono>
                </AdminTd>
                <AdminTd className="font-medium text-foreground">{flag.name}</AdminTd>
                <AdminTd>
                  <Mono className="tabular-nums text-muted-foreground">
                    {flag.rolloutPercentage}%
                  </Mono>
                </AdminTd>
                <AdminTd className="text-muted-foreground">
                  {flag.workspaceAllowlist.length > 0
                    ? flag.workspaceAllowlist.join(", ")
                    : "Global"}
                </AdminTd>
                <AdminTd>
                  <StatusBadge status={flag.enabled ? "active" : "disabled"} />
                </AdminTd>
                <AdminTd className="text-right">
                  <UpdateFlagDialog
                    flagId={flag.id}
                    flagKey={flag.key}
                    currentEnabled={flag.enabled}
                  />
                </AdminTd>
              </AdminTr>
            ))
          )}
        </tbody>
      </AdminTable>
    </div>
  );
}
