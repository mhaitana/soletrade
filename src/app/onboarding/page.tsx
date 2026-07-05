import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";

// Auth-scoped page — never statically prerendered.
export const dynamic = "force-dynamic";
import { listUserWorkspaces } from "@/platform/workspaces";
import { Logo } from "@/shared/components/logo";
import { CreateWorkspaceForm } from "./create-workspace-form";

export const metadata = { title: "Create your workspace" };

export default async function OnboardingPage() {
  const user = await requireUser();
  const workspaces = await listUserWorkspaces(user.id);
  if (workspaces.length > 0) redirect("/dashboard");

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <h1 className="text-center text-2xl font-semibold tracking-tight">Create your workspace</h1>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          A workspace holds your customers, modules, and billing. You can rename it later.
        </p>
        <div className="mt-6">
          <CreateWorkspaceForm />
        </div>
      </div>
    </div>
  );
}
