import { notFound } from "next/navigation";
import { loadGeneralSettingsPage } from "@/app/(app)/actions/workspace";
import { GeneralSettingsForm } from "./general-form";

export const metadata = { title: "General settings" };

export default async function SettingsPage() {
  const data = await loadGeneralSettingsPage();
  if (!data) notFound();
  return <GeneralSettingsForm initial={data} />;
}
