import { requireWorkspaceContext } from "@/platform/context";
import { getWorkspace } from "@/platform/workspaces";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import Link from "next/link";

export const metadata = { title: "General settings" };

export default async function SettingsPage() {
  const ctx = await requireWorkspaceContext();
  const workspace = await getWorkspace(ctx.workspaceId);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">General</h1>
        <p className="text-sm text-muted-foreground">Workspace details and quick links.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{workspace?.name ?? "Workspace"}</CardTitle>
          <CardDescription>Slug: {workspace?.slug ?? "—"}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Your role</span>
            <Badge variant="secondary" className="capitalize">
              {ctx.role}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-3 pt-2">
            <Link href="/settings/modules" className="text-primary hover:underline">
              Manage modules
            </Link>
            <Link href="/settings/members" className="text-primary hover:underline">
              Manage members
            </Link>
            <Link href="/billing" className="text-primary hover:underline">
              Billing
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
