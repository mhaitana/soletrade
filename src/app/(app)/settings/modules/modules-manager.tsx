"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { MODULES, MODULE_KEYS, type ModuleKey } from "@/shared/constants/modules";
import {
  disableModuleAction,
  enableModuleAction,
  type ModulesPageData,
} from "@/app/(app)/actions/module-installations";

export function ModulesManager({ initial }: { initial: ModulesPageData }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function toggle(key: ModuleKey, enable: boolean) {
    setError(null);
    startTransition(async () => {
      const res = enable ? await enableModuleAction(key) : await disableModuleAction(key);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Modules</h1>
        <p className="text-sm text-muted-foreground">
          Enable or disable modules for this workspace. Billing is wired in Phase 3.
        </p>
      </div>

      {!initial.canManage ? (
        <p className="rounded-md border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
          Only owners and admins can manage modules.
        </p>
      ) : null}

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {MODULE_KEYS.map((key) => {
          const meta = MODULES[key];
          const enabled = initial.installed.includes(key);
          const Icon = meta.icon;
          return (
            <Card key={key}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="grid size-9 place-items-center rounded-md bg-muted">
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <div>
                      <CardTitle className="text-base">{meta.name}</CardTitle>
                      <CardDescription>{meta.description}</CardDescription>
                    </div>
                  </div>
                  {enabled ? <Badge>Enabled</Badge> : <Badge variant="outline">Disabled</Badge>}
                </div>
              </CardHeader>
              <CardContent>
                <Button
                  variant={enabled ? "outline" : "default"}
                  disabled={!initial.canManage || isPending}
                  onClick={() => void toggle(key, !enabled)}
                  aria-label={enabled ? `Disable ${meta.name}` : `Enable ${meta.name}`}
                >
                  {enabled ? "Disable" : "Enable"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
