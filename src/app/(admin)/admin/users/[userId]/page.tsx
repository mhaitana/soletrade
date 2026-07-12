import "server-only";
import * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, User, ShieldAlert, Lock } from "lucide-react";
import { requireAdminContext } from "@/platform/admin/services/admin-auth";
import { searchPlatformUsers } from "@/platform/admin/services/admin-users";

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  await requireAdminContext("view:users");

  const users = await searchPlatformUsers();
  const user = users.find((u) => u.id === userId);

  if (!user) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 border-b border-slate-800 pb-4">
        <Link
          href="/admin/users"
          className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
            <User className="w-5 h-5 text-rose-400" />
            {user.fullName || user.email}
          </h1>
          <p className="text-xs text-slate-400 font-mono mt-0.5">User ID: {user.id}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/50 space-y-4">
            <h2 className="text-sm font-semibold text-slate-200">Account Operational Metadata</h2>
            <dl className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <dt className="text-slate-400">Email Address</dt>
                <dd className="text-slate-200 font-medium mt-1">{user.email}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Account Status</dt>
                <dd className="mt-1">
                  {user.isSuspended ? (
                    <span className="px-2 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30 font-semibold uppercase text-[10px]">
                      Suspended
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-semibold uppercase text-[10px]">
                      Active
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">Registration Date</dt>
                <dd className="text-slate-200 mt-1">{user.createdAt.toLocaleString()}</dd>
              </div>
            </dl>
          </div>

          {/* Principle #3 / #4 Customer Content Isolation Banner */}
          <div className="p-5 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-200 text-xs space-y-2">
            <div className="flex items-center gap-2 font-semibold text-amber-300">
              <Lock className="w-4 h-4" />
              Customer Business Content Protected
            </div>
            <p className="text-amber-200/80 leading-relaxed">
              In accordance with Soletrade Workspace Principle #3 and #4, customer invoices, quotes, accounting transactions, files, and AI conversations are inaccessible from this view. To inspect business content, the customer must grant an explicit time-limited Support Access Session.
            </p>
          </div>
        </div>

        <div className="space-y-6">
          <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/50 space-y-4">
            <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-400" />
              Permissioned Account Actions
            </h2>
            <div className="space-y-2 text-xs">
              <button
                type="button"
                className="w-full py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium border border-slate-700 text-left transition-colors"
              >
                Revoke User Sessions
              </button>
              <button
                type="button"
                className="w-full py-2 px-3 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 font-medium border border-rose-500/30 text-left transition-colors"
              >
                {user.isSuspended ? "Restore Account..." : "Suspend Account..."}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
