import { notFound } from "next/navigation";
import { loadGeneralSettingsPage } from "@/features/workspaces/api/workspace";
import { GeneralSettingsForm } from "@/features/workspaces/components/general-form";

export const metadata = { title: "General settings" };

export default async function SettingsPage() {
  const data = await loadGeneralSettingsPage();
  if (!data) notFound();
  return <GeneralSettingsForm initial={data} />;
}
