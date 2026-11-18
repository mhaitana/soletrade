import { brand } from "@/config/brand";
import { loadDigestSettings } from "@/features/assistant/api/digest";
import { DigestCard } from "@/features/assistant/components/digest-card";
import { UsageCard } from "@/features/assistant/components/usage-card";

export const metadata = { title: brand.assistantName };

/**
 * Assistant settings. Each section is its own card component, added below the header:
 * what the workspace has used this month, and the signed-in person's briefing digest.
 */
export default async function AssistantSettingsPage() {
  const digest = await loadDigestSettings();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{brand.assistantName}</h1>
        <p className="text-sm text-muted-foreground">
          Usage and briefings for {brand.assistantName} in this workspace.
        </p>
      </div>
      <UsageCard />
      <DigestCard initial={digest} />
    </div>
  );
}
