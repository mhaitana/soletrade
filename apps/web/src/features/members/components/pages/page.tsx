import { loadMembersPage } from "@/features/members/api/members";
import { MembersManager } from "@/features/members/components/members-manager";

export const metadata = { title: "Members" };

export default async function MembersPage() {
  const data = await loadMembersPage();
  return <MembersManager initial={data} />;
}
