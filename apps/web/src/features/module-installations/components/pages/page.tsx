import { loadModulesPage } from "@/features/module-installations/api/module-installations";
import { ModulesManager } from "@/features/module-installations/components/modules-manager";

export const metadata = { title: "Modules" };

export default async function ModulesPage() {
  const data = await loadModulesPage();
  return <ModulesManager initial={data} />;
}
