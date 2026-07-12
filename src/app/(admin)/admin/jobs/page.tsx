import "server-only";
import * as React from "react";
import { Workflow } from "lucide-react";
import { requireAdminContext } from "@/platform/admin/services/admin-auth";
import { listBackgroundJobs } from "@/platform/admin/services/admin-operations";
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

export default async function AdminBackgroundJobsPage() {
  await requireAdminContext("view:operations");
  const jobs = await listBackgroundJobs();

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={Workflow}
        title="Background Job Execution Queue"
        subtitle="Monitor worker queues, failures, and execution duration."
      />

      <AdminTable caption="Background jobs">
        <thead>
          <tr>
            <AdminTh>Queued At</AdminTh>
            <AdminTh>Job Name</AdminTh>
            <AdminTh>Queue</AdminTh>
            <AdminTh>Duration (ms)</AdminTh>
            <AdminTh>Attempts</AdminTh>
            <AdminTh>Status</AdminTh>
          </tr>
        </thead>
        <tbody>
          {jobs.length === 0 ? (
            <EmptyRow colSpan={6}>No background jobs recorded.</EmptyRow>
          ) : (
            jobs.map((job) => (
              <AdminTr key={job.id}>
                <AdminTd className="text-muted-foreground">
                  {job.createdAt.toLocaleString()}
                </AdminTd>
                <AdminTd className="font-medium text-foreground">{job.name}</AdminTd>
                <AdminTd>
                  <Mono className="text-muted-foreground">{job.queue}</Mono>
                </AdminTd>
                <AdminTd>
                  <Mono className="text-muted-foreground">
                    {job.runTimeMs ? `${job.runTimeMs}ms` : "—"}
                  </Mono>
                </AdminTd>
                <AdminTd className="tabular-nums text-muted-foreground">{job.attempts}</AdminTd>
                <AdminTd>
                  <StatusBadge status={job.status} />
                </AdminTd>
              </AdminTr>
            ))
          )}
        </tbody>
      </AdminTable>
    </div>
  );
}
