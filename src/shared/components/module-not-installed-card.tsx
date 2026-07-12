import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { MODULES, type ModuleKey } from "@/shared/constants/modules";

/**
 * Empty-state card shown when a user navigates to a module route that isn't
 * installed in their workspace. Pure (no `server-only`, no app imports) so it
 * respects the `@/shared/*` boundary - it only reads the static module catalog.
 * Reused by the books / drive / quotes modules.
 */
export function ModuleNotInstalledCard({ moduleKey }: { moduleKey: ModuleKey }) {
  const mod = MODULES[moduleKey];
  return (
    <div className="mx-auto max-w-lg">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <mod.icon className="size-5 text-muted-foreground" aria-hidden />
            {mod.name} is not enabled
          </CardTitle>
          <CardDescription>
            {mod.description} Enable it in Settings to add it to your workspace.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/settings/modules">
              Enable {mod.shortName}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
