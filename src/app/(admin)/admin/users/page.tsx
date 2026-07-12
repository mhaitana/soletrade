import "server-only";
import * as React from "react";
import Link from "next/link";
import { Users, ArrowUpRight } from "lucide-react";
import { requireAdminContext } from "@/platform/admin/services/admin-auth";
import { searchPlatformUsers } from "@/platform/admin/services/admin-users";

export default async function AdminUsersPage() {
  await requireAdminContext("view:users");
  const users = await searchPlatformUsers();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
            <Users className="w-5 h-5 text-rose-400" />
            User Management
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Search and inspect platform accounts (operational metadata only; Principle #3).
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-900 border-b border-slate-800 text-slate-400 uppercase font-mono text-[11px]">
            <tr>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Full Name</th>
              <th className="px-4 py-3">User ID</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-slate-800/40 transition-colors">
                <td className="px-4 py-3 font-medium text-slate-200">{u.email}</td>
                <td className="px-4 py-3 text-slate-300">{u.fullName ?? "—"}</td>
                <td className="px-4 py-3 font-mono text-[11px] text-slate-400">{u.id}</td>
                <td className="px-4 py-3">
                  {u.isSuspended ? (
                    <span className="px-2 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30 text-[10px] font-semibold uppercase">
                      Suspended
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px] font-semibold uppercase">
                      Active
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-400">
                  {u.createdAt.toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/admin/users/${u.id}`}
                    className="inline-flex items-center gap-1 text-rose-400 hover:text-rose-300 font-medium"
                  >
                    Inspect <ArrowUpRight className="w-3.5 h-3.5" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
