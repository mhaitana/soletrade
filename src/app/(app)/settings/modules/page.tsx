import { loadModulesPage } from "@/app/(app)/actions/module-installations";
import { ModulesManager } from "./modules-manager";

export const metadata = { title: "Modules" };

export default async function ModulesPage() {
  const data = await loadModulesPage();
  return <ModulesManager initial={data} />;
}
